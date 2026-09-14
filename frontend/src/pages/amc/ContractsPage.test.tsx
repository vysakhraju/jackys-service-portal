import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeAmcContract, makeAmcScheduleVisit } from '../../test/fixtures';

vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
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
// #218: Service centre/Technician create-form fields are now NamePickers backed by these.
vi.mock('../../lib/masterDataApi', () => ({
  listServiceCentres: vi.fn(),
}));
vi.mock('../../lib/technicianScheduleApi', () => ({
  getGanttBoard: vi.fn(),
}));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import {
  createAmcContract,
  getAmcBillingInvoicesForContract,
  getAmcContract,
  getAmcSchedule,
  listAmcContracts,
} from '../../lib/amcApi';
import { listServiceCentres } from '../../lib/masterDataApi';
import { getGanttBoard } from '../../lib/technicianScheduleApi';
import { ContractsPage } from './ContractsPage';

// 2026-09-14: ContractsPage now gates on the real capability (useMyCapabilities) rather
// than four hardcoded role arrays - see amcTypes.ts's own comment. mockCapabilities
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
  vi.mocked(listServiceCentres).mockReset().mockResolvedValue([{ id: 'sc-1', name: 'Dubai Service Centre' }] as any);
  vi.mocked(getGanttBoard).mockReset().mockResolvedValue({
    date: '2026-09-14',
    rows: [{ technicianId: 'tech-1', technicianName: 'Ahmed Al Farsi', role: 'TECHNICIAN_FIELD', blocks: [], hasConflict: false }],
    unassignedAppointments: [],
    unassignedJobCards: [],
  } as any);
  mockCapabilities([], true);
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

  // #218: Service centre + Assigned technician are now name-based NamePickers, not
  // pasted uuids.
  it('picks the service centre and technician by name, and submits their real ids', async () => {
    vi.mocked(listAmcContracts).mockResolvedValue([]);
    vi.mocked(createAmcContract).mockResolvedValue(makeAmcContract({ id: 'contract-9' }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No AMC contracts match this filter.');
    await user.click(screen.getByRole('button', { name: '+ New Contract' }));

    await user.type(screen.getByLabelText('Customer name'), 'Jane Doe');
    await user.type(screen.getByLabelText(/Customer phone/), '+971509998888');

    const [serviceCentrePicker, technicianPicker] = screen.getAllByTestId('name-picker-input');
    await user.click(serviceCentrePicker);
    await user.click(await screen.findByText('Dubai Service Centre'));
    await user.click(technicianPicker);
    await user.click(await screen.findByText('Ahmed Al Farsi'));

    await user.type(screen.getByPlaceholderText('SN-000123, SN-000124'), 'SN-000123');
    await user.type(screen.getByLabelText('Start date'), '2026-09-01');
    await user.type(screen.getByLabelText('End date'), '2027-09-01');
    await user.type(screen.getByLabelText('Total amount (AED)', { exact: false }), '1200');

    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(vi.mocked(createAmcContract)).toHaveBeenCalledWith(
        expect.objectContaining({ serviceCentreId: 'sc-1', assignedTechnicianId: 'tech-1' }),
      );
    });
  });

  it('falls back to a raw-paste technician input when the technician name list 403s (e.g. CCE)', async () => {
    vi.mocked(getGanttBoard).mockRejectedValue(new Error('Forbidden'));
    vi.mocked(listAmcContracts).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No AMC contracts match this filter.');
    await user.click(screen.getByRole('button', { name: '+ New Contract' }));

    await screen.findByText(/name list needs Team Leader access/);
    expect(screen.getAllByTestId('name-picker-input')).toHaveLength(1); // service centre only
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

  it('hides all management actions for a caller holding only AMC_VIEW + AMC_TECHNICIAN_VISIT (not AMC_MANAGE)', async () => {
    mockCapabilities(['AMC_VIEW', 'AMC_TECHNICIAN_VISIT']);
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
