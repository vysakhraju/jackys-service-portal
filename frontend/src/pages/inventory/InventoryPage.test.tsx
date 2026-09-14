import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeReservation } from '../../test/fixtures';

vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/inventoryApi', () => ({
  confirmAllReturnsForJobCard: vi.fn(),
  confirmReturn: vi.fn(),
  getReturnPendingByJobCard: vi.fn(),
  getStaleReservations: vi.fn(),
  getStock: vi.fn(),
  grn: vi.fn(),
  reviewReservation: vi.fn(),
}));
vi.mock('../../lib/masterDataApi', () => ({
  listSpareParts: vi.fn(),
}));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import {
  confirmAllReturnsForJobCard,
  getReturnPendingByJobCard,
  getStaleReservations,
  getStock,
  reviewReservation,
} from '../../lib/inventoryApi';
import { listSpareParts } from '../../lib/masterDataApi';
import { InventoryPage } from './InventoryPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <InventoryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// 2026-09-14: InventoryPage now gates on the real capability (useMyCapabilities) rather
// than a hardcoded role array - see InventoryPage.tsx's own comment. mockCapabilities
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

beforeEach(() => {
  vi.mocked(getStaleReservations).mockReset();
  vi.mocked(getStaleReservations).mockResolvedValue([]);
  vi.mocked(listSpareParts).mockReset();
  vi.mocked(listSpareParts).mockResolvedValue([]);
  vi.mocked(getStock).mockReset();
  vi.mocked(reviewReservation).mockReset();
  vi.mocked(getReturnPendingByJobCard).mockReset();
  vi.mocked(getReturnPendingByJobCard).mockResolvedValue([]);
  vi.mocked(confirmAllReturnsForJobCard).mockReset();
});

describe('InventoryPage - capability gating (2026-09-14: converted from a hardcoded role array)', () => {
  it('shows GRN and Confirm Return to anyone holding INVENTORY_STAFF, whatever their role', async () => {
    mockCapabilities(['INVENTORY_STAFF']);
    renderPage();
    expect(await screen.findByText('Goods Received Note (GRN)')).toBeInTheDocument();
    expect(screen.getByText('Confirm a physical return')).toBeInTheDocument();
  });

  it('shows GRN/Confirm Return/the returns dashboard to a role granted INVENTORY_STAFF via Designation access, not just Warehouse Clerk by default', async () => {
    // The whole point of this round's fix: a role with no default membership in
    // INVENTORY_STAFF (e.g. CCE) sees these once Super Admin ticks the capability for
    // them - proven here by mocking the capability directly, independent of role name.
    mockCapabilities(['INVENTORY_STAFF']);
    renderPage();
    expect(await screen.findByText('Goods Received Note (GRN)')).toBeInTheDocument();
    expect(screen.getByText(/Job cards with parts pending return/)).toBeInTheDocument();
  });

  it('hides GRN and Confirm Return from a caller with no INVENTORY_STAFF capability', async () => {
    mockCapabilities([]);
    renderPage();
    await screen.findByText('Stock lookup');
    expect(screen.queryByText('Goods Received Note (GRN)')).not.toBeInTheDocument();
    expect(screen.queryByText('Confirm a physical return')).not.toBeInTheDocument();
    expect(screen.queryByText(/Job cards with parts pending return/)).not.toBeInTheDocument();
  });

  it('shows the review buttons on a stale reservation only with INVENTORY_REVIEW', async () => {
    mockCapabilities(['INVENTORY_REVIEW']);
    vi.mocked(getStaleReservations).mockResolvedValue([makeReservation()]);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Approve reallocation' })).toBeInTheDocument();
  });

  it('hides the review buttons on a stale reservation without INVENTORY_REVIEW', async () => {
    mockCapabilities([]);
    vi.mocked(getStaleReservations).mockResolvedValue([makeReservation()]);
    renderPage();
    await screen.findByText(/held 30h/i);
    expect(screen.queryByRole('button', { name: 'Approve reallocation' })).not.toBeInTheDocument();
  });
});

describe('InventoryPage - stock lookup "never received" is distinct from a real zero', () => {
  it('flags a synthesized zero-stock result (no id) as never received via GRN', async () => {
    // A caller who can view stock (INVENTORY_VIEW) but can't GRN (no INVENTORY_STAFF) -
    // picked deliberately so only one "Spare part" select renders (Stock lookup's), not two.
    mockCapabilities(['INVENTORY_VIEW']);
    vi.mocked(listSpareParts).mockResolvedValue([
      { id: 'sp-1', code: 'SP-1', name: 'Drum Motor', category: 'MOTOR', brand: null, description: null, unitCost: 0, unitPriceB2B: 0, unitPriceB2C: 0, minStockLevel: 0, vanStockLevel: 0, isActive: true, attributes: null, createdAt: '', updatedAt: '' },
    ]);
    vi.mocked(getStock).mockResolvedValue({ sparePartId: 'sp-1', location: 'MAIN_STORE', quantityOnHand: 0, quantityReserved: 0 });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Stock lookup');
    await screen.findByRole('option', { name: /Drum Motor/i });
    await user.selectOptions(screen.getByLabelText('Spare part', { selector: 'select' }), 'sp-1');
    await user.click(screen.getByRole('button', { name: 'Look up' }));

    expect(await screen.findByText(/No stock row exists yet/i)).toBeInTheDocument();
  });
});

describe('InventoryPage - review then confirm-return handoff (the-fool: RETURN_PENDING is otherwise a dead end)', () => {
  it('after Approve reallocation, tells the viewer the reservation is now RETURN_PENDING', async () => {
    mockCapabilities(['INVENTORY_REVIEW']);
    vi.mocked(getStaleReservations).mockResolvedValue([makeReservation()]);
    vi.mocked(reviewReservation).mockResolvedValue(makeReservation({ status: 'RETURN_PENDING' }) as any);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Approve reallocation' }));

    await waitFor(() => {
      expect(screen.getByText(/now RETURN_PENDING/i)).toBeInTheDocument();
    });
  });
});

describe('InventoryPage - returns dashboard (2026-09-14: no reservation id required)', () => {
  const group = {
    jobCardId: 'jc-1',
    jobCardNumber: 'JC-0042',
    totalQuantityPending: 5,
    reservations: [
      makeReservation({
        id: 'res-1',
        status: 'RETURN_PENDING',
        quantityReserved: 2,
        sparePart: { id: 'sp-1', code: 'SP-1', name: 'Drum Motor' },
        custodian: { id: 'tech-1', firstName: 'Rahim', lastName: 'K', email: 't@example.com' },
      }),
      makeReservation({
        id: 'res-2',
        status: 'RETURN_PENDING',
        quantityReserved: 3,
        sparePart: { id: 'sp-2', code: 'SP-2', name: 'PCB Board' },
        custodian: { id: 'tech-1', firstName: 'Rahim', lastName: 'K', email: 't@example.com' },
      }),
    ],
  } as any;

  it('shows the dashboard to a Warehouse Clerk, with the job card and its total pending qty', async () => {
    mockCapabilities(['INVENTORY_STAFF']);
    vi.mocked(getReturnPendingByJobCard).mockResolvedValue([group]);
    renderPage();

    expect(await screen.findByText('Job cards with parts pending return (1)')).toBeInTheDocument();
    expect(screen.getByText('JC-0042')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('hides the dashboard from a caller with no INVENTORY_STAFF capability', async () => {
    mockCapabilities([]);
    vi.mocked(getReturnPendingByJobCard).mockResolvedValue([group]);
    renderPage();

    await screen.findByText('Stock lookup');
    expect(screen.queryByText(/Job cards with parts pending return/)).not.toBeInTheDocument();
  });

  it('shows an empty state when nothing is pending return', async () => {
    mockCapabilities(['INVENTORY_STAFF']);
    vi.mocked(getReturnPendingByJobCard).mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('Nothing pending return right now.')).toBeInTheDocument();
  });

  it('expands a job card row on click to show each part and its custodian', async () => {
    mockCapabilities(['INVENTORY_STAFF']);
    vi.mocked(getReturnPendingByJobCard).mockResolvedValue([group]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('JC-0042'));

    expect(await screen.findByText(/SP-1 — Drum Motor/)).toBeInTheDocument();
    expect(screen.getByText(/SP-2 — PCB Board/)).toBeInTheDocument();
    expect(screen.getAllByText(/from Rahim K/).length).toBe(2);
  });

  it('confirms all returns for the job card in one click and reports success', async () => {
    mockCapabilities(['INVENTORY_STAFF']);
    vi.mocked(getReturnPendingByJobCard).mockResolvedValue([group]);
    vi.mocked(confirmAllReturnsForJobCard).mockResolvedValue(
      group.reservations.map((r: any) => ({ ...r, status: 'RETURNED', quantityReturned: r.quantityReserved })),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('JC-0042'));
    await user.click(await screen.findByRole('button', { name: 'Confirm all returned' }));

    expect(confirmAllReturnsForJobCard).toHaveBeenCalledWith('jc-1');
    expect(await screen.findByText(/All 2 part\(s\) confirmed back on Main Store/i)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Confirmed' })).toBeDisabled();
  });

  it("confirming all doesn't require knowing any reservation id - only the job card's own id is sent", async () => {
    mockCapabilities(['INVENTORY_STAFF']);
    vi.mocked(getReturnPendingByJobCard).mockResolvedValue([group]);
    vi.mocked(confirmAllReturnsForJobCard).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('JC-0042'));
    await user.click(await screen.findByRole('button', { name: 'Confirm all returned' }));

    expect(confirmAllReturnsForJobCard).toHaveBeenCalledTimes(1);
    expect(confirmAllReturnsForJobCard).toHaveBeenCalledWith(group.jobCardId);
    expect(vi.mocked(confirmAllReturnsForJobCard).mock.calls[0]).toHaveLength(1);
  });
});
