// Job Cards predates this project's automated test convention (Phases 1-4 are
// manual-walkthrough-only, per TESTING_GUIDE.md's closing note) - this file covers only
// the qcApprove/qcReject wrappers added in Frontend Phase 7, not a retroactive full-file
// audit of the rest of jobCardsApi.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from './api';
import { getBlockedAppointmentsForJobCard, getEligibleAppointmentsForJobCard, getTaskPauses, pauseTask, qcApprove, qcReject, resumeTask } from './jobCardsApi';

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
});

// Modification request (2026-09-17): backs the Job Cards page's eligible-appointment
// picker - see JobCardsPage.tsx's EligibleAppointmentPicker.
describe('jobCardsApi - eligible-appointments (2026-09-17)', () => {
  it('gets /job-cards/eligible-appointments with no params when q is omitted', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await getEligibleAppointmentsForJobCard();
    expect(api.get).toHaveBeenCalledWith('/job-cards/eligible-appointments', { params: {} });
  });

  it('gets /job-cards/eligible-appointments with no params when q is a blank string', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await getEligibleAppointmentsForJobCard('   ');
    expect(api.get).toHaveBeenCalledWith('/job-cards/eligible-appointments', { params: {} });
  });

  it('gets /job-cards/eligible-appointments with q as a query param when provided', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await getEligibleAppointmentsForJobCard('APT-005');
    expect(api.get).toHaveBeenCalledWith('/job-cards/eligible-appointments', { params: { q: 'APT-005' } });
  });
});

// 2026-09-21 live finding - the "why" counterpart to eligible-appointments above.
describe('jobCardsApi - blocked-appointments (2026-09-21)', () => {
  it('gets /job-cards/blocked-appointments with no params when q is omitted', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await getBlockedAppointmentsForJobCard();
    expect(api.get).toHaveBeenCalledWith('/job-cards/blocked-appointments', { params: {} });
  });

  it('gets /job-cards/blocked-appointments with q as a query param when provided', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await getBlockedAppointmentsForJobCard('APT-005');
    expect(api.get).toHaveBeenCalledWith('/job-cards/blocked-appointments', { params: { q: 'APT-005' } });
  });
});

describe('jobCardsApi - QC (Frontend Phase 7)', () => {
  it('qcApprove posts to /job-cards/:id/qc/approve with no body', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'jc-1', status: 'QC_PASSED' } });
    await qcApprove('jc-1');
    expect(api.post).toHaveBeenCalledWith('/job-cards/jc-1/qc/approve');
  });

  it('qcReject posts to /job-cards/:id/qc/reject with the reason', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'jc-1', status: 'IN_PROGRESS' } });
    await qcReject('jc-1', { reason: 'Drum still noisy after reassembly' });
    expect(api.post).toHaveBeenCalledWith('/job-cards/jc-1/qc/reject', { reason: 'Drum still noisy after reassembly' });
  });
});

describe('jobCardsApi - task timer pause/resume', () => {
  it('pauseTask posts to /job-cards/:id/pause with the reason and optional notes', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'pause-1', reason: 'MATERIAL_SHORTAGE' } });
    await pauseTask('jc-1', { reason: 'MATERIAL_SHORTAGE', notes: 'Waiting on compressor' });
    expect(api.post).toHaveBeenCalledWith('/job-cards/jc-1/pause', { reason: 'MATERIAL_SHORTAGE', notes: 'Waiting on compressor' });
  });

  it('resumeTask posts to /job-cards/:id/resume with no body', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'pause-1', resumedAt: '2026-09-08T10:00:00.000Z' } });
    await resumeTask('jc-1');
    expect(api.post).toHaveBeenCalledWith('/job-cards/jc-1/resume');
  });

  it('getTaskPauses gets /job-cards/:id/pauses', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await getTaskPauses('jc-1');
    expect(api.get).toHaveBeenCalledWith('/job-cards/jc-1/pauses');
  });
});
