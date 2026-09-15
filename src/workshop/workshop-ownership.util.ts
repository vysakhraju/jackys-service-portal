// Extracted (Modification Request 2026-09-16) from a local const in both
// workshop.controller.ts and the frontend's WorkshopPage.tsx, so the actual bypass DECISION
// is one pure, directly-testable function instead of two independently-maintained copies of
// "which roles skip per-technician ownership" - the same reasoning every other *.util.ts in
// this codebase (job-card-edit-lock.util.ts, job-card-progress.util.ts, ...) already
// follows. The frontend still keeps its own small mirror of this (a client-side hint only,
// same as every other capability gate) - this file is the one that actually matters, since
// workshop.controller.ts calls it on every start-wip/request-spare/complete request.
import { RoleName } from '../auth/entities/role.entity';

/**
 * TL+ roles that bypass per-technician ownership on start-wip/request-spare/complete -
 * mirrors WorkshopService.assertOwnership()'s own `isPrivilegedRole` parameter exactly, same
 * "checked in code, not admin-editable" reasoning as Job Cards' TASK_PAUSE_PRIVILEGED_ROLES.
 */
export const WORKSHOP_OWNERSHIP_BYPASS_ROLES: RoleName[] = [
  RoleName.SUPER_ADMIN,
  RoleName.SERVICE_HEAD,
  RoleName.TECHNICAL_TEAM_LEADER,
];

/**
 * Whether a caller bypasses per-technician ownership on a Job Card's workshop actions -
 * either because their ROLE is always privileged (WORKSHOP_OWNERSHIP_BYPASS_ROLES above), or
 * because they hold the WORKSHOP_ACTION_ANY_JOB capability (admin-grantable via Designation
 * access, e.g. to a Customer Care Executive who needs to handle a job end-to-end regardless
 * of which workshop technician it's assigned to - see capability-catalog.ts's own comment on
 * that key for the full history).
 */
export function bypassesWorkshopOwnership(roleName: string | undefined, hasWorkshopActionAnyJobCapability: boolean): boolean {
  return (!!roleName && WORKSHOP_OWNERSHIP_BYPASS_ROLES.includes(roleName as RoleName)) || hasWorkshopActionAnyJobCapability;
}
