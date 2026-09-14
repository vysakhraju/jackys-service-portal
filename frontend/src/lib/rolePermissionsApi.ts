// Thin wrappers over PermissionsController's role-permissions endpoints
// (src/permissions/permissions.controller.ts) - the designation permission matrix. See
// rolePermissionsTypes.ts for the full picture and how this differs from roleAccessApi.ts.
import { api } from './api';
import type { Role } from './types';
import type { CapabilityMatrixEntry, MyCapabilities, RolePermissionUserRef, SetRoleCapabilitiesResult } from './rolePermissionsTypes';

const BASE = '/permissions/role-permissions';

// Not under BASE - this is GET /permissions/my-capabilities, a sibling endpoint (the
// current user's own capabilities), not part of the admin matrix API itself.
export const getMyCapabilities = () => api.get<MyCapabilities>('/permissions/my-capabilities').then((r) => r.data);

export const listRolePermissionRoles = () => api.get<Role[]>(`${BASE}/roles`).then((r) => r.data);

export const getRolePermissionsMatrix = () => api.get<CapabilityMatrixEntry[]>(`${BASE}/matrix`).then((r) => r.data);

export const listUsersForRolePermission = (roleId: string) =>
  api.get<RolePermissionUserRef[]>(`${BASE}/roles/${roleId}/users`).then((r) => r.data);

export const setRoleCapabilities = (roleId: string, capabilityKeys: string[]) =>
  api.post<SetRoleCapabilitiesResult>(`${BASE}/roles/${roleId}`, { capabilityKeys }).then((r) => r.data);
