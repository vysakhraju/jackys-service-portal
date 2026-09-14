import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/masterDataApi', () => ({
  createComponentYield: vi.fn(),
  listYieldByCategory: vi.fn(),
  listYieldByModel: vi.fn(),
  listSparePartModels: vi.fn(),
}));

import { createComponentYield, listYieldByCategory, listYieldByModel, listSparePartModels } from '../../lib/masterDataApi';
import { ComponentYieldPage } from './ComponentYieldPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ComponentYieldPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listYieldByCategory).mockReset().mockResolvedValue([]);
  vi.mocked(listYieldByModel).mockReset().mockResolvedValue([]);
  vi.mocked(createComponentYield).mockReset();
  vi.mocked(listSparePartModels).mockReset().mockResolvedValue([
    { id: 'uuid-1', modelId: 'WA80J5710', brand: 'Samsung', modelName: 'WashMaster 8kg', attributes: {}, createdAt: '', updatedAt: '' },
  ] as any);
});

// #218: the "By model" search field and the create form's "Model" field are now NamePickers
// backed by GET /master-data/spare-part-models, driving the query/submission by the model's
// business-key modelId string, never its uuid.
describe('ComponentYieldPage - #218 model name pickers', () => {
  it('picking a model in "By model" mode searches yield rules by its modelId string', async () => {
    renderPage();
    await waitFor(() => expect(listYieldByCategory).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'By model' }));

    fireEvent.focus(screen.getByTestId('name-picker-input'));
    fireEvent.click(await screen.findByText('Samsung WashMaster 8kg'));

    await waitFor(() => {
      expect(vi.mocked(listYieldByModel)).toHaveBeenCalledWith('WA80J5710');
    });
  });

  it('creates a yield rule with the picked model id, not its uuid', async () => {
    vi.mocked(createComponentYield).mockResolvedValue({} as any);
    renderPage();
    await waitFor(() => expect(listYieldByCategory).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '+ New Yield Rule' }));
    fireEvent.focus(screen.getByTestId('name-picker-input'));
    fireEvent.click(await screen.findByText('Samsung WashMaster 8kg'));

    fireEvent.change(screen.getByPlaceholderText('BOM-4471'), { target: { value: 'BOM-9001' } });
    fireEvent.change(screen.getByPlaceholderText('Drum Motor Assembly'), { target: { value: 'Drum Bearing' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(vi.mocked(createComponentYield)).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'WA80J5710' }));
    });
  });

  it('blocks creation with no model picked (required validation still active)', async () => {
    renderPage();
    await waitFor(() => expect(listYieldByCategory).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '+ New Yield Rule' }));
    fireEvent.change(screen.getByPlaceholderText('BOM-4471'), { target: { value: 'BOM-9001' } });
    fireEvent.change(screen.getByPlaceholderText('Drum Motor Assembly'), { target: { value: 'Drum Bearing' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(screen.getByText('Required')).toBeInTheDocument();
    });
    expect(createComponentYield).not.toHaveBeenCalled();
  });
});
