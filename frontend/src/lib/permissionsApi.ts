// Thin wrappers over src/permissions/permissions.controller.ts - one function per route
// that actually exists. Unlike most modules on this frontend, GET /permissions?type=X IS
// a real list endpoint (who currently holds a given permission type) - only the per-user
// full history lookup (GET /permissions/users/:userId) needs a pasted user id, same "no
// list-users endpoint" convention as everywhere else.
import { api } from './api';
import type { GrantPermissionInput, PermissionTypeValue, RevokePermissionInput, UserPermissionGrant } from './permissionsTypes';

const BASE = '/permissions';

export const grantPermission = (data: GrantPermissionInput) =>
  api.post<UserPermissionGrant>(`${BASE}/grant`, data).then((r) => r.data);

export const revokePermission = (data: RevokePermissionInput) =>
  api.post<UserPermissionGrant>(`${BASE}/revoke`, data).then((r) => r.data);

export const listGrantsForUser = (userId: string) =>
  api.get<UserPermissionGrant[]>(`${BASE}/users/${userId}`).then((r) => r.data);

export const listGrantsByType = (type: PermissionTypeValue) =>
  api.get<UserPermissionGrant[]>(BASE, { params: { type } }).then((r) => r.data);
