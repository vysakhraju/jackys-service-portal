import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('./masterDataApi', () => ({
  listSparePartModels: vi.fn(),
}));

import { listSparePartModels } from './masterDataApi';
import { useSparePartModelOptions } from './useSparePartModelOptions';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.mocked(listSparePartModels).mockReset();
});

describe('useSparePartModelOptions', () => {
  it('maps each model to {id: modelId (the business key, not the uuid), name}', async () => {
    vi.mocked(listSparePartModels).mockResolvedValue([
      { id: 'uuid-1', modelId: 'WA80J5710', brand: 'Samsung', modelName: 'WashMaster 8kg', attributes: {}, createdAt: '', updatedAt: '' },
    ] as any);

    const { result } = renderHook(() => useSparePartModelOptions(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.options).toEqual([{ id: 'WA80J5710', name: 'Samsung WashMaster 8kg' }]);
  });

  it('returns an empty option list while loading / with no models', async () => {
    vi.mocked(listSparePartModels).mockResolvedValue([]);
    const { result } = renderHook(() => useSparePartModelOptions(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.options).toEqual([]);
  });
});
