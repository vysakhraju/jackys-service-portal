import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeAmcContract, makeAmcScheduleVisit } from '../../test/fixtures';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/amcApi', () => ({
  createAmcContract: vi.fn(),
  listAmcContracts: vi.fn(),
  getAmcContract: vi.fn(),
  getAmcSchedule: vi.fn(),
  getAmcVisitCompletion: vi.fn(),
  renewAmcContract: vi.fn(),
  cancelAmcContract: vi.fn(),
  sendAmcRenewalReminder: vi.fn(),
  getAmcBillingInvoicesForContract: vi.fn(),
  generateAmcBillingInvoice: vi.fn(),
  recordAmcBillingPayment: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
import {
  createAmcContract,
  getAmcBillingInvoicesForContract,
  getAmcContract,
  getAmcSchedule,
  listAmcContracts,
} from '../../lib/amcApi';
import { ContractsPage } from './ContractsPage';

function mockUser(roleName: string) {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'u1', firstName: 'T', lastName: 'U', email: 't@jackys.com', employeeId: 'E1', status: 'ACTIVE', lastLoginAt: null, role: { id: 'r1', name: roleName, displayName: roleName } },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
  } as any);
}

function renderPage(initialEntry = '/amc/contracts') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ContractsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(createAmcContract).mockReset();
  vi.mocked(listAmcContracts).mockReset();
  vi.mocked(getAmcContract).mockReset();
  vi.mocked(getAmcSchedule).mockReset();
  vi.mocked(getAmcBillingInvoicesForContract).mockReset().mockResolvedValue([]);
  mockUser('SERVICE_HEAD');
});

describe('ContractsPage - list + filters', () => {
  it('lists contracts with no status filter by default', async () => {
    vi.mocked(listAmcContracts).mockResolvedValue([makeAmcContract()]);
    renderPage();
    expect(await screen.findByText('AMC-0001')).toBeInTheDocument();
    expect(listAmcContracts).toHaveBeenCalledWith(undefined);
  });

  it('refetches with the status filter when a status button is clicked', async () => {
    vi.mocked(listAmcContracts).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No AMC contracts match this filter.');
    await user.click(screen.getByRole('button', { name: 'Expired' }));
    await waitFor(() => expect(listAmcContracts).toHaveBeenLastCalledWith('EXPIRED'));
  });
});

describe('ContractsPage - create form', () => {
  it('shows a live visit-count estimate that updates with the date range and frequency', async () => {
    vi.mocked(listAmcContracts).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No AMC contracts match this filter.');
    await user.click(screen.getByRole('button', { name: '+ New Contract' }));

    const startInput = screen.getByLabelText('Start date');
    const endInput = screen.getByLabelText('End date');
    await user.type(startInput, '2026-09-01');
    await user.type(endInput, '2027-09-01');

    // Default frequency is QUARTERLY -> 5 visits over 12 months.
    expect(await screen.findByText(/This will generate/)).toHaveTextContent('5');
  });

  it('disables submit once the estimate exceeds the 60-visit safety cap', async () => {
    vi.mocked(listAmcContracts).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No AMC contracts match this filter.');
    await user.click(screen.getByRole('button', { name: '+ New Contract' }));

    await user.selectOptions(screen.getByLabelText('Visit frequency'), 'MONTHLY');
    await user.type(screen.getByLabelText('Start date'), '2020-01-01');
    await user.type(screen.getByLabelText('End date'), '2027-01-01');

    expect(await screen.findByText(/above the 60-visit safety cap/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('auto-opens the create modal pre-filled from ?prefillName=&prefillPhone= (from the Upsell tab)', async () => {
    vi.mocked(listAmcContracts).mockResolvedValue([]);
    renderPage('/amc/contracts?prefillName=Jane%20Doe&prefillPhone=%2B971509998888');
    await screen.findByText('No AMC contracts match this filter.');

    expect(await screen.findByText('New AMC Contract')).toBeInTheDocument();
    expect(screen.getByLabelText('Customer name')).toHaveValue('Jane Doe');
    expect(screen.getByLabelText(/Customer phone/)).toHaveValue('+971509998888');
  });
});

describe('ContractsPage - contract detail', () => {
  it('shows Renew/Cancel/Send-reminder for an ACTIVE contract when canManage', async () => {
    vi.mocked(listAmcContracts).mockResolvedValue([makeAmcContract({ id: 'contract-1', status: 'ACTIVE' })]);
    vi.mocked(getAmcContract).mockResolvedValue(makeAmcContract({ id: 'contract-1', status: 'ACTIVE' }));
    vi.mocked(getAmcSchedule).mockResolvedValue([]);
    renderPage('/amc/contracts?contractId=contract-1');

    expect(await screen.findByRole('button', { name: 'Renew' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send renewal reminder' })).toBeInTheDocument();
  });

  it('hides Renew/Cancel/Send-reminder for a CANCELLED contract, even when canManage', async () => {
    vi.mocked(listAmcContracts).mockResolvedValue([makeAmcContract({ id: 'contract-1', status: 'CANCELLED' })]);
    vi.mocked(getAmcContract).mockResolvedValue(makeAmcContract({ id: 'contract-1', status: 'CANCELLED', cancellationReason: 'Customer moved' }));
    vi.mocked(getAmcSchedule).mockResolvedValue([]);
    renderPage('/amc/contracts?contractId=contract-1');

    await screen.findByText('AMC-0001');
    expect(screen.queryByRole('button', { name: 'Renew' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('hides all management actions for a technician (view + complete-visits only, not canManage)', async () => {
    mockUser('TECHNICIAN_FIELD');
    vi.mocked(listAmcContracts).mockResolvedValue([makeAmcContract({ id: 'contract-1', status: 'ACTIVE' })]);
    vi.mocked(getAmcContract).mockResolvedValue(makeAmcContract({ id: 'contract-1', status: 'ACTIVE' }));
    vi.mocked(getAmcSchedule).mockResolvedValue([makeAmcScheduleVisit({ status: 'SCHEDULED' })]);
    renderPage('/amc/contracts?contractId=contract-1');

    await screen.findByText('AMC-0001');
    expect(screen.queryByRole('button', { name: 'Renew' })).not.toBeInTheDocument();
    // But a technician CAN complete a scheduled PM visit.
    expect(screen.getByRole('button', { name: 'Complete' })).toBeInTheDocument();
  });

  it('only shows the "Complete" action on a SCHEDULED visit row, not a COMPLETED one', async () => {
    vi.mocked(listAmcContracts).mockResolvedValue([makeAmcContract({ id: 'contract-1', status: 'ACTIVE' })]);
    vi.mocked(getAmcContract).mockResolvedValue(makeAmcContract({ id: 'contract-1', status: 'ACTIVE' }));
    vi.mocked(getAmcSchedule).mockResolvedValue([
      makeAmcScheduleVisit({ id: 'apt-1', status: 'SCHEDULED' }),
      makeAmcScheduleVisit({ id: 'apt-2', status: 'COMPLETED' }),
    ]);
    renderPage('/amc/contracts?contractId=contract-1');

    await screen.findByText('AMC-0001');
    expect(screen.getAllByRole('button', { name: 'Complete' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'View completion' })).toHaveLength(1);
  });
});
