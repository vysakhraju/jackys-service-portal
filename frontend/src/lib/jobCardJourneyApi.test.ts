import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  api: { get: vi.fn() },
}));

import { api } from './api';
import { getJobCardJourney, searchJobCardJourney } from './jobCardJourneyApi';

beforeEach(() => {
  vi.mocked(api.get).mockReset();
});

describe('jobCardJourneyApi', () => {
  it('searchJobCardJourney fetches GET /job-card-journey/search with the query as a param', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await searchJobCardJourney('JC-0120');
    expect(api.get).toHaveBeenCalledWith('/job-card-journey/search', { params: { q: 'JC-0120' } });
  });

  it('getJobCardJourney fetches GET /job-card-journey/:id', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await getJobCardJourney('jc-1');
    expect(api.get).toHaveBeenCalledWith('/job-card-journey/jc-1');
  });
});
