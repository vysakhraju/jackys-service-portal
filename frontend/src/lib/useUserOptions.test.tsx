import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('./usersApi', () => ({
  listUsers: vi.fn(),
}));

import { listUsers } from './usersApi';
import { useUserOptions } from './useUserOptions';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.mocked(listUsers).mockReset();
});

describe('useUserOptions', () => {
  it('maps each user to a name-picker option with role and email folded into the searchable name', async () => {
    vi.mocked(listUsers).mockResolvedValue([
      {
        id: 'user-1',
        firstName: 'Noor',
        lastName: 'Hassan',
        email: 'noor@jackys.com',
        employeeId: 'E1',
        phone: null,
        status: 'ACTIVE',
        role: { id: 'r-qc', name: 'QC_OFFICER', displayName: 'QC Officer' },
        lastLoginAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ] as any);

    const { result } = renderHook(() => useUserOptions(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.options).toEqual([
      { id: 'user-1', name: 'Noor Hassan — QC Officer (noor@jackys.com)' },
    ]);
  });

  it('returns an empty option list while loading / with no users', async () => {
    vi.mocked(listUsers).mockResolvedValue([]);
    const { result } = renderHook(() => useUserOptions(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.options).toEqual([]);
  });
});
