import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/masterDataApi', () => ({
  getPriceList: vi.fn(),
  createPriceList: vi.fn(),
  listSparePartModels: vi.fn(),
}));

import { getPriceList, createPriceList, listSparePartModels } from '../../lib/masterDataApi';
import { PriceListsPage } from './PriceListsPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PriceListsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getPriceList).mockReset().mockResolvedValue([]);
  vi.mocked(createPriceList).mockReset();
  vi.mocked(listSparePartModels).mockReset().mockResolvedValue([
    { id: 'uuid-1', modelId: 'WA80J5710', brand: 'Samsung', modelName: 'WashMaster 8kg', attributes: {}, createdAt: '', updatedAt: '' },
  ] as any);
});

// #218: the "Model ID" list filter and the create form's model field are now NamePickers
// backed by GET /master-data/spare-part-models, submitting the model's business-key
// modelId string, never its uuid.
describe('PriceListsPage - #218 model name pickers', () => {
  it('filters the price list by picking a model by name, submitting its modelId string', async () => {
    renderPage();
    await waitFor(() => expect(getPriceList).toHaveBeenCalled());

    fireEvent.focus(screen.getByTestId('name-picker-input'));
    fireEvent.click(await screen.findByText('Samsung WashMaster 8kg'));

    await waitFor(() => {
      expect(vi.mocked(getPriceList)).toHaveBeenLastCalledWith(expect.any(String), 'WA80J5710');
    });
  });

  it('creates a price row with the picked model id, not its uuid', async () => {
    vi.mocked(createPriceList).mockResolvedValue({} as any);
    renderPage();
    await waitFor(() => expect(getPriceList).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '+ New Price Row' }));
    const modelPickers = await screen.findAllByTestId('name-picker-input');
    // Second NamePicker on the page is the create-form's Model field (first is the filter).
    fireEvent.focus(modelPickers[1]);
    fireEvent.click(await screen.findByText('Samsung WashMaster 8kg'));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(vi.mocked(createPriceList)).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'WA80J5710' }));
    });
  });
});
