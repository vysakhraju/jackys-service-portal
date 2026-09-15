import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../lib/inventoryApi', () => ({ getStock: vi.fn() }));
vi.mock('../lib/masterDataApi', () => ({ listSpareParts: vi.fn() }));

import { useMyCapabilities } from '../lib/useMyCapabilities';
import { listSpareParts } from '../lib/masterDataApi';
import { StockLookupPanel } from './StockLookupPanel';

function mockCapabilities(capabilities: string[]) {
  vi.mocked(useMyCapabilities).mockReturnValue({
    loading: false,
    error: null,
    fullAccess: false,
    capabilities,
    has: (key: string) => capabilities.includes(key),
    hasAny: (keys: string[]) => keys.some((k) => capabilities.includes(k)),
  });
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <StockLookupPanel />
    </QueryClientProvider>,
  );
}

// Direct unit coverage for the branch neither of StockLookupPanel's two real call sites
// (InventoryPage's Inventory & Stock tab, WorkshopPage's pill) ever exercises in practice -
// both already hide the panel entirely before it would render without INVENTORY_VIEW. This
// is the defense-in-depth self-gate itself (see the component's own comment).
describe('StockLookupPanel - self-gates on INVENTORY_VIEW', () => {
  it('shows the access-denied notice, not the form, without INVENTORY_VIEW - and never queries spare parts', () => {
    mockCapabilities([]);
    renderPanel();

    expect(screen.getByText("You don't have access to stock levels yet.")).toBeInTheDocument();
    expect(screen.queryByText('Stock lookup')).not.toBeInTheDocument();
    expect(listSpareParts).not.toHaveBeenCalled();
  });

  it('renders the form for a caller holding INVENTORY_VIEW', async () => {
    mockCapabilities(['INVENTORY_VIEW']);
    vi.mocked(listSpareParts).mockResolvedValue([]);
    renderPanel();

    expect(await screen.findByText('Stock lookup')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Look up' })).toBeInTheDocument();
  });
});
