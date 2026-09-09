import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  api: { get: vi.fn() },
}));

import { api } from './api';
import { getGanttBoard } from './technicianScheduleApi';

beforeEach(() => {
  vi.mocked(api.get).mockReset();
});

describe('technicianScheduleApi', () => {
  it('getGanttBoard fetches GET /technician-schedule/gantt with the date as a query param', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { date: '2026-09-09', rows: [] } });
    await getGanttBoard('2026-09-09');
    expect(api.get).toHaveBeenCalledWith('/technician-schedule/gantt', { params: { date: '2026-09-09' } });
  });
});
