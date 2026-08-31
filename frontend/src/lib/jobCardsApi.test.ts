// Job Cards predates this project's automated test convention (Phases 1-4 are
// manual-walkthrough-only, per TESTING_GUIDE.md's closing note) - this file covers only
// the qcApprove/qcReject wrappers added in Frontend Phase 7, not a retroactive full-file
// audit of the rest of jobCardsApi.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from './api';
import { qcApprove, qcReject } from './jobCardsApi';

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
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
