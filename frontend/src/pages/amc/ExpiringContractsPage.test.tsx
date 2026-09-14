import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeAmcContract } from '../../test/fixtures';

vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/amcApi', () => ({
  getExpiringAmcContracts: vi.fn(),
  sendAmcRenewalReminder: vi.fn(),
}));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { getExpiringAmcContracts, sendAmcRenewalReminder } from '../../lib/amcApi';
import { ExpiringContractsPage } from './ExpiringContractsPage';

// 2026-09-14: ExpiringContractsPage now gates on the real capability (useMyCapabilities)
// rather than a hardcoded role array - see amcTypes.ts's own comment. mockCapabilities
// replaces the old mockUser(roleName) role-array helper.
function mockCapabilities(capabilities: string[], fullAccess = false) {
  vi.mocked(useMyCapabilities).mockReturnValue({
    loading: false,
    error: null,
    fullAccess,
    capabilities,
    has: (key: string) => fullAccess || capabilities.includes(key),
    hasAny: (keys: string[]) => fullAccess || keys.some((k) => capabilities.includes(k)),
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ExpiringContractsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getExpiringAmcContracts).mockReset();
  vi.mocked(sendAmcRenewalReminder).mockReset();
});

describe('ExpiringContractsPage', () => {
  it('shows a "View" link into the contract detail and a "Send reminder" button for a manager', async () => {
    mockCapabilities([], true);
    vi.mocked(getExpiringAmcContracts).mockResolvedValue([makeAmcContract({ id: 'contract-1', contractNumber: 'AMC-0001' })]);
    renderPage();

    const link = await screen.findByRole('link', { name: 'View' });
    expect(link).toHaveAttribute('href', '/amc/contracts?contractId=contract-1');
    expect(screen.getByRole('button', { name: 'Send reminder' })).toBeInTheDocument();
  });

  it('hides "Send reminder" for a caller holding only AMC_VIEW + AMC_TECHNICIAN_VISIT (view-only, no AMC_MANAGE)', async () => {
    mockCapabilities(['AMC_VIEW', 'AMC_TECHNICIAN_VISIT']);
    vi.mocked(getExpiringAmcContracts).mockResolvedValue([makeAmcContract({ id: 'contract-1' })]);
    renderPage();

    await screen.findByRole('link', { name: 'View' });
    expect(screen.queryByRole('button', { name: 'Send reminder' })).not.toBeInTheDocument();
  });

  it('shows "Send reminder" for a role granted AMC_MANAGE via Designation access, not just a default role', async () => {
    // The whole point of this round's fix: a role with no default membership in
    // AMC_MANAGE sees the button once Super Admin ticks the capability for them - proven
    // here by mocking the capability directly, independent of role name.
    mockCapabilities(['AMC_VIEW', 'AMC_MANAGE']);
    vi.mocked(getExpiringAmcContracts).mockResolvedValue([makeAmcContract({ id: 'contract-1' })]);
    renderPage();

    expect(await screen.findByRole('button', { name: 'Send reminder' })).toBeInTheDocument();
  });

  it('sends the reminder for the clicked contract and shows the delivered channels', async () => {
    mockCapabilities([], true);
    vi.mocked(getExpiringAmcContracts).mockResolvedValue([makeAmcContract({ id: 'contract-1' })]);
    vi.mocked(sendAmcRenewalReminder).mockResolvedValue({ attempted: ['WHATSAPP', 'EMAIL'], delivered: ['EMAIL'] });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Send reminder' }));
    expect(sendAmcRenewalReminder).toHaveBeenCalledWith('contract-1');
    expect(await screen.findByText(/Sent via WHATSAPP, EMAIL/)).toBeInTheDocument();
  });

  it('refetches with a custom withinDays value', async () => {
    mockCapabilities([], true);
    vi.mocked(getExpiringAmcContracts).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/No ACTIVE contracts expiring within 30 days/);

    const input = screen.getByLabelText(/Within days/i);
    await user.clear(input);
    await user.type(input, '60');
    expect(await screen.findByText(/No ACTIVE contracts expiring within 60 days/)).toBeInTheDocument();
    expect(getExpiringAmcContracts).toHaveBeenLastCalledWith(60);
  });
});
