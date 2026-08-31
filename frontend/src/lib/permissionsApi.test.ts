import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from './api';
import { grantPermission, listGrantsByType, listGrantsForUser, revokePermission } from './permissionsApi';

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
});

describe('permissionsApi', () => {
  it('grantPermission posts to /permissions/grant', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'grant-1', permissionType: 'QC_APPROVAL' } });
    const input = { userId: 'user-2', permissionType: 'QC_APPROVAL' as const, notes: 'covering leave' };
    await grantPermission(input);
    expect(api.post).toHaveBeenCalledWith('/permissions/grant', input);
  });

  it('revokePermission posts to /permissions/revoke', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'grant-1', revokedAt: '2026-08-31T00:00:00Z' } });
    const input = { userId: 'user-2', permissionType: 'QC_APPROVAL' as const };
    await revokePermission(input);
    expect(api.post).toHaveBeenCalledWith('/permissions/revoke', input);
  });

  it('listGrantsForUser fetches GET /permissions/users/:userId', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await listGrantsForUser('user-2');
    expect(api.get).toHaveBeenCalledWith('/permissions/users/user-2');
  });

  it('listGrantsByType fetches GET /permissions with a type query param', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await listGrantsByType('REWORK_APPROVAL');
    expect(api.get).toHaveBeenCalledWith('/permissions', { params: { type: 'REWORK_APPROVAL' } });
  });
});
