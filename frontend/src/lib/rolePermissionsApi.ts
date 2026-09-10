// Thin wrappers over PermissionsController's role-permissions endpoints
// (src/permissions/permissions.controller.ts) - the designation permission matrix. See
// rolePermissionsTypes.ts for the full picture and how this differs from roleAccessApi.ts.
import { api } from './api';
import type { Role } from './types';
import type { CapabilityMatrixEntry, RolePermissionUserRef, SetRoleCapabilitiesResult } from './rolePermissionsTypes';

const BASE = '/permissions/role-permissions';

export const listRolePermissionRoles = () => api.get<Role[]>(`${BASE}/roles`).then((r) => r.data);

export const getRolePermissionsMatrix = () => api.get<CapabilityMatrixEntry[]>(`${BASE}/matrix`).then((r) => r.data);

export const listUsersForRolePermission = (roleId: string) =>
  api.get<RolePermissionUserRef[]>(`${BASE}/roles/${roleId}/users`).then((r) => r.data);

export const setRoleCapabilities = (roleId: string, capabilityKeys: string[]) =>
  api.post<SetRoleCapabilitiesResult>(`${BASE}/roles/${roleId}`, { capabilityKeys }).then((r) => r.data);
