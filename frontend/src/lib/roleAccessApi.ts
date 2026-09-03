// Thin wrappers over PermissionsController's role-access endpoints
// (src/permissions/permissions.controller.ts) - "Extra role access", see
// roleAccessTypes.ts for the full picture.
import { api } from './api';
import type { Role } from './types';
import type {
  GrantRoleAccessInput,
  RevokeRoleAccessInput,
  RoleAccessGrant,
  RoleCapabilityModule,
} from './roleAccessTypes';

const BASE = '/permissions';

export const listGrantableRoles = () => api.get<Role[]>(`${BASE}/roles/grantable`).then((r) => r.data);

export const getRoleCapabilities = (roleName: string) =>
  api.get<RoleCapabilityModule[]>(`${BASE}/roles/${roleName}/capabilities`).then((r) => r.data);

export const grantRoleAccess = (data: GrantRoleAccessInput) =>
  api.post<RoleAccessGrant>(`${BASE}/role-access/grant`, data).then((r) => r.data);

export const revokeRoleAccess = (data: RevokeRoleAccessInput) =>
  api.post<RoleAccessGrant>(`${BASE}/role-access/revoke`, data).then((r) => r.data);

export const listRoleAccessForUser = (userId: string) =>
  api.get<RoleAccessGrant[]>(`${BASE}/role-access/users/${userId}`).then((r) => r.data);
