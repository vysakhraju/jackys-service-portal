// Mirrors src/auth/entities/role-access-grant.entity.ts, src/auth/dto/grant-role-access.dto.ts,
// and src/permissions/role-capabilities.service.ts on the API side. "Extra role access" -
// an admin can delegate a role's access to a user who doesn't hold it, without changing
// their real role (e.g. give a CCE everything a Technical Team Leader can do while the TL
// is on leave). Deliberately separate from PermissionsPage's QC_APPROVAL/REWORK_APPROVAL
// grants - see this feature's own write-up in STATUS_TRACKER.md for why.

import type { Role, User } from './types';

// SUPER_ADMIN, SERVICE_HEAD, and CUSTOMER are never offered here - the backend rejects them
// outright (see NON_GRANTABLE_ACCESS_ROLES), this just keeps the same exclusion visible in
// the picker so a doomed choice never gets that far. The authoritative list is always
// fetched from GET /permissions/roles/grantable though - this constant exists only for
// convenience where a synchronous list is useful (e.g. a quick client-side sanity check),
// never as the source of truth for what the roster actually renders.
export const NON_GRANTABLE_ACCESS_ROLE_NAMES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'CUSTOMER'];

// Every role-access grant has a hard end date - there is no standing/permanent
// delegation (the-fool finding #2, 2026-09-03). Mirrors MAX_ROLE_ACCESS_GRANT_DAYS.
export const MAX_ROLE_ACCESS_GRANT_DAYS = 90;

export interface RoleAccessGrant {
  id: string;
  userId: string;
  grantedRoleName: string;
  grantedByUserId: string;
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedByUserId: string | null;
  notes: string | null;
  user?: User;
}

export interface RoleCapabilityEndpoint {
  method: string;
  path: string;
  summary: string | null;
  // Set when this endpoint's real gate is a SEPARATE, individually-issued permission
  // grant (e.g. QC_APPROVAL) that this role-access grant does not include on its own -
  // the-fool finding #3. Shown as a caveat in the preview, not a plain included capability.
  requiresSeparatePermissionGrant: string | null;
}

export interface RoleCapabilityModule {
  module: string;
  endpoints: RoleCapabilityEndpoint[];
}

export interface GrantRoleAccessInput {
  userId: string;
  roleName: string;
  expiresAt: string;
  notes?: string;
}

export interface RevokeRoleAccessInput {
  userId: string;
  roleName: string;
  notes?: string;
}

export function isRoleAccessGrantActive(grant: RoleAccessGrant): boolean {
  return grant.revokedAt === null && new Date(grant.expiresAt) > new Date();
}

export type { Role };
