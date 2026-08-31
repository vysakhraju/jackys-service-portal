import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeAmcContract } from '../../test/fixtures';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/amcApi', () => ({
  getExpiringAmcContracts: vi.fn(),
  sendAmcRenewalReminder: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
import { getExpiringAmcContracts, sendAmcRenewalReminder } from '../../lib/amcApi';
import { ExpiringContractsPage } from './ExpiringContractsPage';

function mockUser(roleName: string) {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'u1', firstName: 'T', lastName: 'U', email: 't@jackys.com', employeeId: 'E1', status: 'ACTIVE', lastLoginAt: null, role: { id: 'r1', name: roleName, displayName: roleName } },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
  } as any);
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
    mockUser('SERVICE_HEAD');
    vi.mocked(getExpiringAmcContracts).mockResolvedValue([makeAmcContract({ id: 'contract-1', contractNumber: 'AMC-0001' })]);
    renderPage();

    const link = await screen.findByRole('link', { name: 'View' });
    expect(link).toHaveAttribute('href', '/amc/contracts?contractId=contract-1');
    expect(screen.getByRole('button', { name: 'Send reminder' })).toBeInTheDocument();
  });

  it('hides "Send reminder" for a technician (view-only, not AMC_MANAGEMENT_ROLES)', async () => {
    mockUser('TECHNICIAN_FIELD');
    vi.mocked(getExpiringAmcContracts).mockResolvedValue([makeAmcContract({ id: 'contract-1' })]);
    renderPage();

    await screen.findByRole('link', { name: 'View' });
    expect(screen.queryByRole('button', { name: 'Send reminder' })).not.toBeInTheDocument();
  });

  it('sends the reminder for the clicked contract and shows the delivered channels', async () => {
    mockUser('SERVICE_HEAD');
    vi.mocked(getExpiringAmcContracts).mockResolvedValue([makeAmcContract({ id: 'contract-1' })]);
    vi.mocked(sendAmcRenewalReminder).mockResolvedValue({ attempted: ['WHATSAPP', 'EMAIL'], delivered: ['EMAIL'] });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Send reminder' }));
    expect(sendAmcRenewalReminder).toHaveBeenCalledWith('contract-1');
    expect(await screen.findByText(/Sent via WHATSAPP, EMAIL/)).toBeInTheDocument();
  });

  it('refetches with a custom withinDays value', async () => {
    mockUser('SERVICE_HEAD');
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
