import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));

import { api } from './api';
import {
  getFieldSchedule,
  getGanttBoard,
  getWorkshopQueue,
  reorderFieldSchedule,
  setWorkshopCapacity,
} from './technicianScheduleApi';

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.post).mockReset();
});

describe('technicianScheduleApi', () => {
  it('getGanttBoard fetches GET /technician-schedule/gantt with the date as a query param', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { date: '2026-09-09', rows: [] } });
    await getGanttBoard('2026-09-09');
    expect(api.get).toHaveBeenCalledWith('/technician-schedule/gantt', { params: { date: '2026-09-09' } });
  });

  // Field/workshop scheduling split (2026-09-10)

  it('getWorkshopQueue fetches GET /technician-schedule/workshop-queue with no params', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { technicians: [], unassignedJobCards: [] } });
    await getWorkshopQueue();
    expect(api.get).toHaveBeenCalledWith('/technician-schedule/workshop-queue');
  });

  it('setWorkshopCapacity PATCHes the technician-scoped capacity endpoint with the new capacity', async () => {
    (api.patch as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'tech-1', workshopDailyCapacity: 10 } });
    await setWorkshopCapacity('tech-1', 10);
    expect(api.patch).toHaveBeenCalledWith('/technician-schedule/workshop-queue/technicians/tech-1/capacity', {
      capacity: 10,
    });
  });

  it('getFieldSchedule fetches GET /technician-schedule/field-schedule with the date as a query param', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { date: '2026-09-09', technicians: [], unassignedAppointments: [] } });
    await getFieldSchedule('2026-09-09');
    expect(api.get).toHaveBeenCalledWith('/technician-schedule/field-schedule', { params: { date: '2026-09-09' } });
  });

  it('reorderFieldSchedule POSTs the technicianId and full ordered id list', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await reorderFieldSchedule('tech-1', ['a', 'b', 'c']);
    expect(api.post).toHaveBeenCalledWith('/technician-schedule/field/reorder', {
      technicianId: 'tech-1',
      orderedAppointmentIds: ['a', 'b', 'c'],
    });
  });
});
