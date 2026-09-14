import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('./technicianScheduleApi', () => ({
  getGanttBoard: vi.fn(),
}));

import { getGanttBoard } from './technicianScheduleApi';
import { useTechnicianOptions } from './useTechnicianOptions';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.mocked(getGanttBoard).mockReset();
});

describe('useTechnicianOptions', () => {
  it('maps gantt board rows to {id, name} options', async () => {
    vi.mocked(getGanttBoard).mockResolvedValue({
      date: '2026-09-14',
      rows: [
        { technicianId: 'ft-1', technicianName: 'Ahmed Al Farsi', role: 'TECHNICIAN_FIELD', blocks: [], hasConflict: false },
        { technicianId: 'wt-1', technicianName: 'Sanjay Rao', role: 'TECHNICIAN_WORKSHOP', blocks: [], hasConflict: false },
      ],
      unassignedAppointments: [],
      unassignedJobCards: [],
    } as any);

    const { result } = renderHook(() => useTechnicianOptions(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.accessible).toBe(true);
    expect(result.current.options).toEqual([
      { id: 'ft-1', name: 'Ahmed Al Farsi' },
      { id: 'wt-1', name: 'Sanjay Rao' },
    ]);
  });

  it('filters down to only the requested technician role', async () => {
    vi.mocked(getGanttBoard).mockResolvedValue({
      date: '2026-09-14',
      rows: [
        { technicianId: 'ft-1', technicianName: 'Ahmed Al Farsi', role: 'TECHNICIAN_FIELD', blocks: [], hasConflict: false },
        { technicianId: 'wt-1', technicianName: 'Sanjay Rao', role: 'TECHNICIAN_WORKSHOP', blocks: [], hasConflict: false },
      ],
      unassignedAppointments: [],
      unassignedJobCards: [],
    } as any);

    const { result } = renderHook(() => useTechnicianOptions('TECHNICIAN_WORKSHOP'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.options).toEqual([{ id: 'wt-1', name: 'Sanjay Rao' }]);
  });

  it('reports accessible=false when the gantt board request fails (e.g. 403 for a non-TL role)', async () => {
    vi.mocked(getGanttBoard).mockRejectedValue(new Error('Forbidden'));

    const { result } = renderHook(() => useTechnicianOptions(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.accessible).toBe(false);
    expect(result.current.options).toEqual([]);
  });
});
