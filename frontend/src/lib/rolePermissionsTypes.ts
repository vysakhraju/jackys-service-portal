// Mirrors src/auth/capability-catalog.ts and src/auth/role-permissions.service.ts on the
// API side. "Designation access" - a role-level capability matrix: tick a capability for
// CCE, every user holding the CCE role gets it immediately, no per-user configuration.
// Deliberately separate from roleAccessTypes.ts ("Extra role access" - per-USER whole-role
// delegation, unchanged, still the right tool for "cover this one person's leave") and from
// permissionsTypes.ts (QC_APPROVAL/REWORK_APPROVAL - per-USER named sign-off authority).
import type { Role } from './types';

export interface CapabilityMatrixEntry {
  key: string;
  label: string;
  module: string;
  // false = listed for visibility ("coming soon") but not a real, savable checkbox yet -
  // see capability-catalog.ts's own doc comment for why the catalog carries these at all.
  migrated: boolean;
  // Role ids (not names) currently holding this capability - MATRIX_LOCKED_ROLES
  // (Super Admin/Service Head/Customer) never appear here, by construction on the backend.
  grantedRoleIds: string[];
}

// Reference-only - shown next to the checklist so an admin sees who a change actually
// affects before saving, never itself editable from this screen.
export interface RolePermissionUserRef {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}

export interface SetRoleCapabilitiesResult {
  granted: string[];
  revoked: string[];
}

// Mirrors RolePermissionsService.getMyCapabilities() - the CURRENT user's own capability
// set, read fresh from the same table this whole file describes. `fullAccess: true` for
// SUPER_ADMIN/SERVICE_HEAD (the matrix's hardcoded bypass); otherwise the exact keys this
// role currently holds. This is what lets a page show "you don't have access to this
// yet" up front (see useMyCapabilities.ts) instead of only ever finding out via a 403
// after already rendering an admin UI the backend was going to reject anyway.
export interface MyCapabilities {
  fullAccess: boolean;
  capabilities: string[];
}

export type { Role };
