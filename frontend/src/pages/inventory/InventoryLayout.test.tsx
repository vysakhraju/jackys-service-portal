import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/inventoryApi', () => ({
  confirmAllReturnsForJobCard: vi.fn(),
  confirmReturn: vi.fn(),
  getReturnPendingByJobCard: vi.fn(),
  getStaleReservations: vi.fn(),
  getStock: vi.fn(),
  grn: vi.fn(),
  reviewReservation: vi.fn(),
  getPendingNeedSpareRequests: vi.fn(),
  reviewNeedSpare: vi.fn(),
}));
vi.mock('../../lib/masterDataApi', () => ({
  listSpareParts: vi.fn(),
}));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { getStaleReservations, getPendingNeedSpareRequests } from '../../lib/inventoryApi';
import { InventoryLayout } from './InventoryLayout';
import { InventoryPage } from './InventoryPage';
import { NeedSpareReviewPage } from './NeedSpareReviewPage';

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
  vi.mocked(getStaleReservations).mockReset().mockResolvedValue([]);
  vi.mocked(getPendingNeedSpareRequests).mockReset().mockResolvedValue([]);
});

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/inventory" element={<InventoryLayout />}>
            <Route path="stock" element={<InventoryPage />} />
            <Route path="need-spare" element={<NeedSpareReviewPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Modification Request (2026-09-15): Inventory & Stock and Need Spare Requests split out
// of the old "Workshop & Inventory" combo into their own top-level "Inventory" section -
// see InventoryLayout.tsx's own comment. Same per-tab-capability pattern as FinanceLayout.
describe('InventoryLayout - capability gating', () => {
  it('shows a restricted notice and never mounts any child route for a caller with none of the 4 inventory capabilities', async () => {
    mockCapabilities([]);
    renderAt('/inventory/stock');
    expect(await screen.findByText("You don't have access to Inventory yet.")).toBeInTheDocument();
    expect(getStaleReservations).not.toHaveBeenCalled();
  });

  it('renders the tab nav and Inventory & Stock for a caller holding INVENTORY_VIEW', async () => {
    mockCapabilities(['INVENTORY_VIEW']);
    renderAt('/inventory/stock');
    expect(await screen.findByText('Stock lookup')).toBeInTheDocument();
    expect(getStaleReservations).toHaveBeenCalled();
  });

  it('shows both tabs for a caller holding only INVENTORY_REVIEW, since it gates a real action on each (reviewing a stale reservation, reviewing a Need Spare request)', async () => {
    mockCapabilities(['INVENTORY_REVIEW']);
    renderAt('/inventory/need-spare');
    expect(await screen.findByText('Inventory & Stock')).toBeInTheDocument();
    expect(screen.getByText('Need Spare Requests')).toBeInTheDocument();
  });

  it('shows only the Inventory & Stock tab, hiding Need Spare Requests, for a caller holding only INVENTORY_STAFF', async () => {
    mockCapabilities(['INVENTORY_STAFF']);
    renderAt('/inventory/stock');
    expect(await screen.findByText('Inventory & Stock')).toBeInTheDocument();
    expect(screen.queryByText('Need Spare Requests')).not.toBeInTheDocument();
  });

  it('blocks direct URL navigation to Need Spare Requests for a caller who only holds INVENTORY_STAFF, without mounting NeedSpareReviewPage', async () => {
    mockCapabilities(['INVENTORY_STAFF']);
    renderAt('/inventory/need-spare');
    expect(await screen.findByText(/this Inventory tab/i)).toBeInTheDocument();
    expect(getPendingNeedSpareRequests).not.toHaveBeenCalled();
    // The tab nav itself still renders (canViewSection is true, via Inventory & Stock).
    expect(screen.getByText('Inventory & Stock')).toBeInTheDocument();
    expect(screen.queryByText('Need Spare Requests')).not.toBeInTheDocument();
  });

  it('renders for full-access callers (SUPER_ADMIN/SERVICE_HEAD bypass)', async () => {
    mockCapabilities([], true);
    renderAt('/inventory/stock');
    expect(await screen.findByText('Stock lookup')).toBeInTheDocument();
    expect(screen.getByText('Need Spare Requests')).toBeInTheDocument();
  });
});
