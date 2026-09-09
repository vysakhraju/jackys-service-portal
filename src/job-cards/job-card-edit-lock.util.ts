// Pure, side-effect-free helper answering "can this Job Card still be freely worked on, or
// is it a late-stage/financially-relevant record that now needs an elevated role" -
// 2026-09-09, per the user's own late-stage edit-lock requirement, pre-mortem'd with
// /the-fool before writing this (see job-card-edit-lock.util.spec.ts's doc comment for the
// findings that shaped the design below).
//
// Deliberately NOT a new guard bolted onto JobCardsController's existing action endpoints
// (validate-sn, assign-section, cancel, warranty-override, qc-approve/reject, task
// pause/resume): every one of those is already blocked by its own state-machine guard once
// a Job Card passes the status it's meant to run at (confirmed by inspection - e.g.
// JobCardsService.cancel() already throws for READY_FOR_QC/QC_PASSED/DELIVERED), and
// qc-approve/reject is deliberately gated by an admin-assignable QC_APPROVAL permission
// grant rather than a fixed role list (JobCardsController's own QC_GATE_ROLES doc comment) -
// re-gating either would be redundant at best and workflow-breaking at worst.
//
// What this DOES apply to: Estimate/Invoice amendment actions once their linked Job Card
// has reached a late-stage status (the "amount or invoice applicable, especially OOW"
// half of the original ask), and any future generic "edit Job Card details" screen. It is
// surfaced today via JobCardJourneyService.getJourney()'s `editLock` field so the frontend
// can grey out edit affordances without duplicating this logic.
import { JobCardStatus } from './entities/job-card.entity';

/** A Job Card in any of these statuses is done-or-terminal enough that further changes
 * are financially/operationally sensitive - READY_FOR_QC (frozen for QC, about to be
 * either approved or bounced back), QC_PASSED (stock already consumed, invoice-eligible),
 * DELIVERED (POD captured, cycle complete), CANCELLED (closed out, cannot be revived). */
export const LATE_STAGE_JOB_CARD_STATUSES: readonly JobCardStatus[] = [
  JobCardStatus.READY_FOR_QC,
  JobCardStatus.QC_PASSED,
  JobCardStatus.DELIVERED,
  JobCardStatus.CANCELLED,
];

// SUPER_ADMIN/SERVICE_HEAD/TECHNICAL_TEAM_LEADER cover the general "supervisor override"
// case; ACCOUNTANT/FINANCE_MANAGER are added specifically so Invoicing's own existing
// INVOICING_ROLES set (invoicing.controller.ts) isn't narrowed by this - they're the roles
// who are SUPPOSED to still be working a job precisely once it's QC_PASSED/DELIVERED.
export const JOB_CARD_EDIT_LOCK_OVERRIDE_ROLES: readonly string[] = [
  'SUPER_ADMIN',
  'SERVICE_HEAD',
  'TECHNICAL_TEAM_LEADER',
  'ACCOUNTANT',
  'FINANCE_MANAGER',
];

export function isLateStageJobCardStatus(status: JobCardStatus): boolean {
  return LATE_STAGE_JOB_CARD_STATUSES.includes(status);
}

/** True if this role is exempt from the late-stage lock (i.e. can still amend an
 * Estimate/Invoice, or use a future generic edit screen, on a late-stage Job Card). Always
 * true when the Job Card isn't late-stage in the first place - there's nothing to be
 * exempt from. */
export function canEditLateStageJobCard(status: JobCardStatus, roleName: string): boolean {
  if (!isLateStageJobCardStatus(status)) return true;
  return JOB_CARD_EDIT_LOCK_OVERRIDE_ROLES.includes(roleName);
}

export interface JobCardEditLock {
  locked: boolean;
  allowedRoles: string[];
  reason: string | null;
}

/** Read-only summary for a UI to render (e.g. JobCardJourneyPage's lock banner) - does not
 * itself enforce anything server-side, same "display, not a source of truth" relationship
 * job-card-journey.util.ts's buildJourneySteps has to the real state machine. */
export function getJobCardEditLock(status: JobCardStatus): JobCardEditLock {
  const locked = isLateStageJobCardStatus(status);
  return {
    locked,
    allowedRoles: locked ? [...JOB_CARD_EDIT_LOCK_OVERRIDE_ROLES] : [],
    reason: locked
      ? `This job card is ${status} - further changes need Super Admin, Service Head, ` +
        'Technical Team Leader, Accountant, or Finance Manager.'
      : null,
  };
}
