import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from './api';
import {
  addCrewHelper,
  assignWorkshopTechnician,
  completeWorkshop,
  getWorkshopState,
  listCrewHelpers,
  removeCrewHelper,
  requestSpare,
  startWip,
} from './workshopApi';

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
});

describe('workshopApi', () => {
  it('assignWorkshopTechnician posts to /workshop/:jobCardId/assign', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'jc1', status: 'WORKSHOP_ASSIGNED' } });
    await assignWorkshopTechnician('jc1', { technicianId: 'tech-1' });
    expect(api.post).toHaveBeenCalledWith('/workshop/jc1/assign', { technicianId: 'tech-1' }, undefined);
  });

  it('startWip posts to /workshop/:jobCardId/start-wip with no body', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'jc1', status: 'IN_PROGRESS' } });
    await startWip('jc1');
    expect(api.post).toHaveBeenCalledWith('/workshop/jc1/start-wip');
  });

  it('requestSpare posts the full payload including optional rework fields', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'res1', status: 'HELD' } });
    const input = { sparePartId: 'sp1', quantity: 2, approverId: 'approver-1' };
    await requestSpare('jc1', input);
    expect(api.post).toHaveBeenCalledWith('/workshop/jc1/request-spare', input);
  });

  it('completeWorkshop posts to /workshop/:jobCardId/complete', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'jc1', status: 'READY_FOR_QC' } });
    await completeWorkshop('jc1');
    expect(api.post).toHaveBeenCalledWith('/workshop/jc1/complete');
  });

  it('getWorkshopState fetches GET /workshop/:jobCardId', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { jobCard: {}, staleReservations: [] } });
    await getWorkshopState('jc1');
    expect(api.get).toHaveBeenCalledWith('/workshop/jc1');
  });

  it('addCrewHelper posts to /workshop/:jobCardId/crew-helpers', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'helper-1', technicianId: 'tech-2' } });
    await addCrewHelper('jc1', { technicianId: 'tech-2' });
    expect(api.post).toHaveBeenCalledWith('/workshop/jc1/crew-helpers', { technicianId: 'tech-2' }, undefined);
  });

  it('listCrewHelpers fetches GET /workshop/:jobCardId/crew-helpers', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await listCrewHelpers('jc1');
    expect(api.get).toHaveBeenCalledWith('/workshop/jc1/crew-helpers');
  });

  it('removeCrewHelper posts to /workshop/:jobCardId/crew-helpers/:helperId/remove', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'helper-1', removedAt: '2026-09-09T10:00:00Z' } });
    await removeCrewHelper('jc1', 'helper-1');
    expect(api.post).toHaveBeenCalledWith('/workshop/jc1/crew-helpers/helper-1/remove');
  });
});
