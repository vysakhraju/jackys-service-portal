import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./publicApi', () => ({
  publicApi: { get: vi.fn() },
}));

import { publicApi } from './publicApi';
import { getPortalInvoice, getPortalSummary, trackJob } from './customerPortalApi';

beforeEach(() => {
  vi.mocked(publicApi.get).mockReset();
});

describe('customerPortalApi', () => {
  it('trackJob fetches GET /customer-portal/public/track/:token via the unauthenticated client', async () => {
    (publicApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await trackJob('tok-1');
    expect(publicApi.get).toHaveBeenCalledWith('/customer-portal/public/track/tok-1');
  });

  it('getPortalInvoice fetches GET /customer-portal/public/invoice/:token', async () => {
    (publicApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await getPortalInvoice('tok-1');
    expect(publicApi.get).toHaveBeenCalledWith('/customer-portal/public/invoice/tok-1');
  });

  it('getPortalSummary fetches GET /customer-portal/public/job-card/:token/summary', async () => {
    (publicApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await getPortalSummary('tok-1');
    expect(publicApi.get).toHaveBeenCalledWith('/customer-portal/public/job-card/tok-1/summary');
  });
});
