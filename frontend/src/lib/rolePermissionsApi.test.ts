import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from './api';
import { getRolePermissionsMatrix, listRolePermissionRoles, listUsersForRolePermission, setRoleCapabilities } from './rolePermissionsApi';

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
});

describe('rolePermissionsApi', () => {
  it('listRolePermissionRoles fetches GET /permissions/role-permissions/roles', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await listRolePermissionRoles();
    expect(api.get).toHaveBeenCalledWith('/permissions/role-permissions/roles');
  });

  it('getRolePermissionsMatrix fetches GET /permissions/role-permissions/matrix', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await getRolePermissionsMatrix();
    expect(api.get).toHaveBeenCalledWith('/permissions/role-permissions/matrix');
  });

  it('listUsersForRolePermission fetches GET /permissions/role-permissions/roles/:roleId/users', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await listUsersForRolePermission('role-cce');
    expect(api.get).toHaveBeenCalledWith('/permissions/role-permissions/roles/role-cce/users');
  });

  it('setRoleCapabilities posts the full capability set to /permissions/role-permissions/roles/:roleId', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { granted: [], revoked: [] } });
    await setRoleCapabilities('role-cce', ['SCHEDULE_CCE_MANAGE']);
    expect(api.post).toHaveBeenCalledWith('/permissions/role-permissions/roles/role-cce', {
      capabilityKeys: ['SCHEDULE_CCE_MANAGE'],
    });
  });
});
