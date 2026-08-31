import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeReservation } from '../../test/fixtures';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/inventoryApi', () => ({
  confirmReturn: vi.fn(),
  getStaleReservations: vi.fn(),
  getStock: vi.fn(),
  grn: vi.fn(),
  reviewReservation: vi.fn(),
}));
vi.mock('../../lib/masterDataApi', () => ({
  listSpareParts: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
import { getStaleReservations, getStock, reviewReservation } from '../../lib/inventoryApi';
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

function mockUser(roleName: string) {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      id: 'user-1',
      firstName: 'Test',
      lastName: 'User',
      email: 't@example.com',
      employeeId: 'E1',
      status: 'ACTIVE',
      lastLoginAt: null,
      role: { id: 'r1', name: roleName, displayName: roleName },
    },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
  } as any);
}

beforeEach(() => {
  vi.mocked(getStaleReservations).mockReset();
  vi.mocked(getStaleReservations).mockResolvedValue([]);
  vi.mocked(listSpareParts).mockReset();
  vi.mocked(listSpareParts).mockResolvedValue([]);
  vi.mocked(getStock).mockReset();
  vi.mocked(reviewReservation).mockReset();
});

describe('InventoryPage - role gating', () => {
  it('shows GRN and Confirm Return to a Warehouse Clerk', async () => {
    mockUser('WAREHOUSE_CLERK');
    renderPage();
    expect(await screen.findByText('Goods Received Note (GRN)')).toBeInTheDocument();
    expect(screen.getByText('Confirm a physical return')).toBeInTheDocument();
  });

  it('hides GRN and Confirm Return from a role with no inventory-staff grant', async () => {
    mockUser('TECHNICIAN_FIELD');
    renderPage();
    await screen.findByText('Stock lookup');
    expect(screen.queryByText('Goods Received Note (GRN)')).not.toBeInTheDocument();
    expect(screen.queryByText('Confirm a physical return')).not.toBeInTheDocument();
  });

  it('shows the review buttons on a stale reservation only to a Team Leader+', async () => {
    mockUser('TECHNICAL_TEAM_LEADER');
    vi.mocked(getStaleReservations).mockResolvedValue([makeReservation()]);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Approve reallocation' })).toBeInTheDocument();
  });

  it('hides the review buttons on a stale reservation from a plain technician', async () => {
    mockUser('TECHNICIAN_WORKSHOP');
    vi.mocked(getStaleReservations).mockResolvedValue([makeReservation()]);
    renderPage();
    await screen.findByText(/held 30h/i);
    expect(screen.queryByRole('button', { name: 'Approve reallocation' })).not.toBeInTheDocument();
  });
});

describe('InventoryPage - stock lookup "never received" is distinct from a real zero', () => {
  it('flags a synthesized zero-stock result (no id) as never received via GRN', async () => {
    // CCE can view stock (READ_ROLES) but can't GRN (INVENTORY_STAFF_ROLES only) - picked
    // deliberately so only one "Spare part" select renders (Stock lookup's), not two.
    mockUser('CCE');
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
    mockUser('TECHNICAL_TEAM_LEADER');
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
