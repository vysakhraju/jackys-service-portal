import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock BOTH clients estimatesApi.ts can reach for - this is itself a regression guard for
// the-fool pre-mortem finding #2: if a public wrapper (getPublicEstimate/
// respondToPublicEstimate) ever accidentally switched from `publicApi` to `api`, these
// tests would start failing because the call would show up on the wrong mock.
vi.mock('./api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('./publicApi', () => ({
  publicApi: { get: vi.fn(), post: vi.fn() },
}));

import { api } from './api';
import { publicApi } from './publicApi';
import {
  createEstimate,
  getEstimate,
  getEstimatesByJobCard,
  getPublicEstimate,
  recordResponse,
  respondToPublicEstimate,
  reviseEstimate,
  sendEstimate,
} from './estimatesApi';

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(publicApi.get).mockReset();
  vi.mocked(publicApi.post).mockReset();
});

describe('estimatesApi (staff, authenticated)', () => {
  it('createEstimate posts to /estimates via the authenticated client', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'e1' } });
    const input = { jobCardId: 'jc1', lineItems: [{ description: 'Part', quantity: 1, unitPrice: 100 }] };
    await createEstimate(input);
    expect(api.post).toHaveBeenCalledWith('/estimates', input);
    expect(publicApi.post).not.toHaveBeenCalled();
  });

  it('sendEstimate posts to /estimates/:id/send', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'e1', status: 'SENT' } });
    await sendEstimate('e1');
    expect(api.post).toHaveBeenCalledWith('/estimates/e1/send');
  });

  it('recordResponse posts the full staff-recorded payload', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'e1', status: 'APPROVED' } });
    const input = { approved: true, contactMethod: 'PHONE_CALL' as const, contactValue: '+971501112222', notes: 'Confirmed by phone' };
    await recordResponse('e1', input);
    expect(api.post).toHaveBeenCalledWith('/estimates/e1/record-response', input);
  });

  it('reviseEstimate posts to /estimates/:id/revise', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'e2', status: 'DRAFT' } });
    await reviseEstimate('e1', {});
    expect(api.post).toHaveBeenCalledWith('/estimates/e1/revise', {});
  });

  it('getEstimate fetches by id', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'e1' } });
    await getEstimate('e1');
    expect(api.get).toHaveBeenCalledWith('/estimates/e1');
  });

  it('getEstimatesByJobCard fetches the by-job-card history', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await getEstimatesByJobCard('jc1');
    expect(api.get).toHaveBeenCalledWith('/estimates/by-job-card/jc1');
  });
});

describe('estimatesApi (public, unauthenticated) - must use publicApi, never api', () => {
  it('getPublicEstimate calls publicApi, not api', async () => {
    (publicApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { jobCardNumber: 'JC-1' } });
    await getPublicEstimate('tok123');
    expect(publicApi.get).toHaveBeenCalledWith('/estimates/public/tok123');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('respondToPublicEstimate calls publicApi, not api', async () => {
    (publicApi.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'e1', status: 'APPROVED' } });
    await respondToPublicEstimate('tok123', { approved: true });
    expect(publicApi.post).toHaveBeenCalledWith('/estimates/public/tok123/respond', { approved: true });
    expect(api.post).not.toHaveBeenCalled();
  });
});
