import { SetMetadata } from '@nestjs/common';
import { PermissionType } from '../entities/user-permission-grant.entity';

export const REQUIRES_PERMISSION_GRANT_KEY = 'requiresPermissionGrant';

/**
 * Documentation-only marker (does not itself gate anything - the real gate is each
 * endpoint's own inline `permissionsService.requireActiveGrant(...)` call, e.g.
 * JobCardsController.qcApprove/qcReject). Read by RoleCapabilitiesService so the
 * role-access "what will this user be able to do" preview can flag these endpoints as
 * needing a SEPARATE grant, instead of silently listing them as included just because
 * the role passes @Roles() (the-fool finding #3, 2026-09-03 - granting someone
 * "QC_OFFICER access" through RoleAccessGrant does NOT by itself let them QC-approve).
 */
export const RequiresPermissionGrant = (permissionType: PermissionType) =>
  SetMetadata(REQUIRES_PERMISSION_GRANT_KEY, permissionType);
