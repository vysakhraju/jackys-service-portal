// Shapes mirror src/permissions/entities/user-permission-grant.entity.ts and
// src/permissions/dto/*.ts exactly. Only two permission types exist today -
// QC_APPROVAL and REWORK_APPROVAL - both admin-assignable to any user regardless of
// their primary role (PermissionsService.grant() has no role check at all beyond the
// admin-only endpoint guard), which is what makes this "dynamic admin RBAC" real.
import type { UserRef } from './appointmentsTypes';

export const PERMISSION_TYPES = ['QC_APPROVAL', 'REWORK_APPROVAL'] as const;
export type PermissionTypeValue = (typeof PERMISSION_TYPES)[number];

export interface UserPermissionGrant {
  id: string;
  user?: UserRef;
  userId: string;
  permissionType: PermissionTypeValue;
  grantedBy?: UserRef;
  grantedByUserId: string;
  grantedAt: string;
  // null = active. A grant is never deleted on revoke - see PermissionsService.revoke().
  revokedAt: string | null;
  revokedBy?: UserRef | null;
  revokedByUserId: string | null;
  notes: string | null;
}

// Matches GrantPermissionDto exactly.
export interface GrantPermissionInput {
  userId: string;
  permissionType: PermissionTypeValue;
  notes?: string;
}

// Matches RevokePermissionDto exactly.
export interface RevokePermissionInput {
  userId: string;
  permissionType: PermissionTypeValue;
  notes?: string;
}
