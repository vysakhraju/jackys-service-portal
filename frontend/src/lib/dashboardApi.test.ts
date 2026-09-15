import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  api: { get: vi.fn() },
}));

import { api } from './api';
import { getDashboardOverview } from './dashboardApi';

beforeEach(() => {
  vi.mocked(api.get).mockReset();
});

describe('dashboardApi', () => {
  it('getDashboardOverview fetches GET /dashboard/overview', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { widgets: {} } });
    await getDashboardOverview();
    expect(api.get).toHaveBeenCalledWith('/dashboard/overview');
  });
});
