import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('./rolePermissionsApi', () => ({
  getMyCapabilities: vi.fn(),
}));

import { getMyCapabilities } from './rolePermissionsApi';
import { useMyCapabilities } from './useMyCapabilities';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.mocked(getMyCapabilities).mockReset();
});

describe('useMyCapabilities', () => {
  it('starts loading, then exposes fullAccess and the raw capability list once the request resolves', async () => {
    vi.mocked(getMyCapabilities).mockResolvedValue({ fullAccess: false, capabilities: ['MASTER_DATA_VIEW'] });
    const { result } = renderHook(() => useMyCapabilities(), { wrapper });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.fullAccess).toBe(false);
    expect(result.current.capabilities).toEqual(['MASTER_DATA_VIEW']);
  });

  it('has() is true only for a capability actually present in the list', async () => {
    vi.mocked(getMyCapabilities).mockResolvedValue({ fullAccess: false, capabilities: ['MASTER_DATA_VIEW'] });
    const { result } = renderHook(() => useMyCapabilities(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.has('MASTER_DATA_VIEW')).toBe(true);
    expect(result.current.has('MASTER_DATA_SERVICE_CENTRE_CREATE')).toBe(false);
  });

  it('has() and hasAny() are true for everything when fullAccess is true, regardless of the capability list', async () => {
    vi.mocked(getMyCapabilities).mockResolvedValue({ fullAccess: true, capabilities: [] });
    const { result } = renderHook(() => useMyCapabilities(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.has('ANYTHING_AT_ALL')).toBe(true);
    expect(result.current.hasAny(['ANYTHING_AT_ALL', 'SOMETHING_ELSE'])).toBe(true);
  });

  it('hasAny() is true if the user holds at least one of the given keys, false if none match', async () => {
    vi.mocked(getMyCapabilities).mockResolvedValue({ fullAccess: false, capabilities: ['MASTER_DATA_SPARE_PARTS_MANAGE'] });
    const { result } = renderHook(() => useMyCapabilities(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.hasAny(['MASTER_DATA_VIEW', 'MASTER_DATA_SPARE_PARTS_MANAGE'])).toBe(true);
    expect(result.current.hasAny(['MASTER_DATA_VIEW', 'MASTER_DATA_PRICE_LIST_MANAGE'])).toBe(false);
  });

  it('defaults to no access (fullAccess false, empty capabilities, has/hasAny false) before the query resolves', () => {
    vi.mocked(getMyCapabilities).mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useMyCapabilities(), { wrapper });

    expect(result.current.loading).toBe(true);
    expect(result.current.fullAccess).toBe(false);
    expect(result.current.capabilities).toEqual([]);
    expect(result.current.has('MASTER_DATA_VIEW')).toBe(false);
    expect(result.current.hasAny(['MASTER_DATA_VIEW'])).toBe(false);
  });

  it('surfaces a fetch failure via error, without throwing and without granting access', async () => {
    vi.mocked(getMyCapabilities).mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useMyCapabilities(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.fullAccess).toBe(false);
    expect(result.current.has('MASTER_DATA_VIEW')).toBe(false);
  });
});
