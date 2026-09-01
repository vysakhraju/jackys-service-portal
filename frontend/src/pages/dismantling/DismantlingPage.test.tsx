import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeDismantlingRecord, makeHarvestedComponent } from '../../test/fixtures';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/dismantlingApi', () => ({
  createDismantlingRecord: vi.fn(),
  listDismantlingRecords: vi.fn(),
  listDismantlingRecordsBySerial: vi.fn(),
  getDismantlingRecord: vi.fn(),
  harvestDismantlingComponents: vi.fn(),
  verifyDismantlingRecord: vi.fn(),
  priceAndPostDismantlingRecord: vi.fn(),
  cancelDismantlingRecord: vi.fn(),
}));
vi.mock('../../lib/masterDataApi', () => ({ listYieldByModel: vi.fn() }));

import { useAuth } from '../../lib/auth';
import { createDismantlingRecord, getDismantlingRecord, listDismantlingRecords, verifyDismantlingRecord } from '../../lib/dismantlingApi';
import { listYieldByModel } from '../../lib/masterDataApi';
import { DismantlingPage } from './DismantlingPage';

function mockUser(roleName: string, id = 'u1') {
  vi.mocked(useAuth).mockReturnValue({
    user: { id, firstName: 'T', lastName: 'U', email: 't@jackys.com', employeeId: 'E1', status: 'ACTIVE', lastLoginAt: null, role: { id: 'r1', name: roleName, displayName: roleName } },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
  } as any);
}

function renderPage(initialEntry = '/dismantling') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <DismantlingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(createDismantlingRecord).mockReset();
  vi.mocked(listDismantlingRecords).mockReset();
  vi.mocked(getDismantlingRecord).mockReset();
  vi.mocked(verifyDismantlingRecord).mockReset();
  vi.mocked(listYieldByModel).mockReset().mockResolvedValue([]);
  mockUser('SERVICE_HEAD');
});

describe('DismantlingPage - list + filters', () => {
  it('lists records with no status filter by default', async () => {
    vi.mocked(listDismantlingRecords).mockResolvedValue([makeDismantlingRecord()]);
    renderPage();
    expect(await screen.findByText('DISM-0001')).toBeInTheDocument();
    expect(listDismantlingRecords).toHaveBeenCalledWith(undefined);
  });

  it('refetches with the status filter when a status button is clicked', async () => {
    vi.mocked(listDismantlingRecords).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No dismantling records match this filter.');
    await user.click(screen.getByRole('button', { name: 'VERIFIED' }));
    await waitFor(() => expect(listDismantlingRecords).toHaveBeenLastCalledWith('VERIFIED'));
  });

  it('shows "+ New Record" only for a role with canHarvest', async () => {
    vi.mocked(listDismantlingRecords).mockResolvedValue([]);
    renderPage();
    await screen.findByText('No dismantling records match this filter.');
    expect(screen.getByRole('button', { name: '+ New Record' })).toBeInTheDocument();
  });

  it('hides "+ New Record" for a view-only role (ACCOUNTANT)', async () => {
    mockUser('ACCOUNTANT');
    vi.mocked(listDismantlingRecords).mockResolvedValue([]);
    renderPage();
    await screen.findByText('No dismantling records match this filter.');
    expect(screen.queryByRole('button', { name: '+ New Record' })).not.toBeInTheDocument();
  });
});

describe('DismantlingPage - create form', () => {
  it('creates a record and navigates ?recordId= to the new record', async () => {
    vi.mocked(listDismantlingRecords).mockResolvedValue([]);
    vi.mocked(createDismantlingRecord).mockResolvedValue(makeDismantlingRecord({ id: 'new-1', recordNumber: 'DISM-0099' }));
    vi.mocked(getDismantlingRecord).mockResolvedValue(makeDismantlingRecord({ id: 'new-1', recordNumber: 'DISM-0099' }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No dismantling records match this filter.');

    await user.click(screen.getByRole('button', { name: '+ New Record' }));
    await user.type(screen.getByLabelText('Appliance serial number'), 'SN-000999');
    // Regex, not exact - the field has a hint span, so its accessible label text is the
    // label + hint concatenated (same reason ContractsPage.test.tsx matches "Customer
    // phone" with a regex rather than an exact string).
    await user.type(screen.getByLabelText(/Model ID/), 'M200');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(createDismantlingRecord).toHaveBeenCalledWith(
      expect.objectContaining({ applianceSerialNumber: 'SN-000999', modelId: 'M200' }),
    );
    // Detail panel mounts for the newly-created record's id.
    await waitFor(() => expect(getDismantlingRecord).toHaveBeenCalledWith('new-1'));
    expect(await screen.findByText('DISM-0099')).toBeInTheDocument();
  });
});

describe('DismantlingPage - detail: status-gated actions', () => {
  it('shows Log Harvest (not Verify) on a PENDING_HARVEST record', async () => {
    vi.mocked(listDismantlingRecords).mockResolvedValue([]);
    vi.mocked(getDismantlingRecord).mockResolvedValue(makeDismantlingRecord({ id: 'r1', status: 'PENDING_HARVEST' }));
    renderPage('/dismantling?recordId=r1');

    await screen.findByText('DISM-0001');
    expect(screen.getByRole('button', { name: 'Log Harvest' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Price & Post/ })).not.toBeInTheDocument();
  });

  it('shows Verify (not Log Harvest) on a COMPONENTS_LOGGED record', async () => {
    vi.mocked(listDismantlingRecords).mockResolvedValue([]);
    vi.mocked(getDismantlingRecord).mockResolvedValue(
      makeDismantlingRecord({ id: 'r1', status: 'COMPONENTS_LOGGED', harvestedByUserId: 'tech-1' }),
    );
    renderPage('/dismantling?recordId=r1');

    await screen.findByText('DISM-0001');
    expect(screen.queryByRole('button', { name: 'Log Harvest' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument();
  });

  it('disables Verify with an AC-31 explanation when the current user is the harvester', async () => {
    mockUser('SERVICE_HEAD', 'tech-1');
    vi.mocked(listDismantlingRecords).mockResolvedValue([]);
    vi.mocked(getDismantlingRecord).mockResolvedValue(
      makeDismantlingRecord({ id: 'r1', status: 'COMPONENTS_LOGGED', harvestedByUserId: 'tech-1' }),
    );
    renderPage('/dismantling?recordId=r1');

    await screen.findByText('DISM-0001');
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
    expect(screen.getByText(/You harvested this record — a different person must verify it/)).toBeInTheDocument();
  });

  it('enables Verify for a different, permitted person', async () => {
    mockUser('SERVICE_HEAD', 'lead-1');
    vi.mocked(listDismantlingRecords).mockResolvedValue([]);
    vi.mocked(getDismantlingRecord).mockResolvedValue(
      makeDismantlingRecord({ id: 'r1', status: 'COMPONENTS_LOGGED', harvestedByUserId: 'tech-1' }),
    );
    renderPage('/dismantling?recordId=r1');

    await screen.findByText('DISM-0001');
    expect(screen.getByRole('button', { name: 'Verify' })).not.toBeDisabled();
    expect(screen.queryByText(/a different person must verify it/)).not.toBeInTheDocument();
  });

  it('disables Price & Post with an AC-31 explanation when the current user is the verifier', async () => {
    mockUser('SERVICE_HEAD', 'lead-1');
    vi.mocked(listDismantlingRecords).mockResolvedValue([]);
    vi.mocked(getDismantlingRecord).mockResolvedValue(
      makeDismantlingRecord({ id: 'r1', status: 'VERIFIED', harvestedByUserId: 'tech-1', verifiedByUserId: 'lead-1' }),
    );
    renderPage('/dismantling?recordId=r1');

    await screen.findByText('DISM-0001');
    expect(screen.getByRole('button', { name: /Price & Post/ })).toBeDisabled();
    expect(screen.getByText(/a third, different person must price and post it/)).toBeInTheDocument();
  });

  it('enables Price & Post for a third, distinct person', async () => {
    mockUser('SERVICE_HEAD', 'mgr-1');
    vi.mocked(listDismantlingRecords).mockResolvedValue([]);
    vi.mocked(getDismantlingRecord).mockResolvedValue(
      makeDismantlingRecord({ id: 'r1', status: 'VERIFIED', harvestedByUserId: 'tech-1', verifiedByUserId: 'lead-1' }),
    );
    renderPage('/dismantling?recordId=r1');

    await screen.findByText('DISM-0001');
    expect(screen.getByRole('button', { name: /Price & Post/ })).not.toBeDisabled();
  });

  it('offers Cancel on PENDING_HARVEST and COMPONENTS_LOGGED but not on VERIFIED', async () => {
    vi.mocked(listDismantlingRecords).mockResolvedValue([]);
    vi.mocked(getDismantlingRecord).mockResolvedValue(makeDismantlingRecord({ id: 'r1', status: 'VERIFIED' }));
    renderPage('/dismantling?recordId=r1');

    await screen.findByText('DISM-0001');
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });
});

describe('DismantlingPage - harvested components table', () => {
  it('flags a component with category===null distinctly, and does not flag a genuine CONSUMABLE/SCRAP component', async () => {
    vi.mocked(listDismantlingRecords).mockResolvedValue([]);
    vi.mocked(getDismantlingRecord).mockResolvedValue(
      makeDismantlingRecord({
        id: 'r1',
        status: 'COMPONENTS_LOGGED',
        harvestedComponents: [
          makeHarvestedComponent({ originalBomItemCode: 'TYPO-CODE-01', category: null, itemName: null, convertedSparePartCode: null, eligibleForConversion: false }),
          makeHarvestedComponent({ originalBomItemCode: 'COMP-GASKET-01', category: 'CONSUMABLE', eligibleForConversion: false }),
        ],
      }),
    );
    renderPage('/dismantling?recordId=r1');

    await screen.findByText('DISM-0001');
    expect(screen.getByText('⚠ not in yield matrix')).toBeInTheDocument();
    expect(screen.getByText('CONSUMABLE')).toBeInTheDocument();
    // Only one warning badge - the CONSUMABLE row must not also render it.
    expect(screen.getAllByText('⚠ not in yield matrix')).toHaveLength(1);
  });
});
