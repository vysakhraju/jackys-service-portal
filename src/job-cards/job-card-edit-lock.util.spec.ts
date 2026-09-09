// Findings from the /the-fool pre-mortem (2026-09-09) that shaped job-card-edit-lock.util.ts:
//
// 1. Invoicing's own INVOICING_ROLES (invoicing.controller.ts) is already
//    ACCOUNTANT/FINANCE_MANAGER/SUPER_ADMIN/SERVICE_HEAD - narrower than, and different
//    from, the originally-proposed SUPER_ADMIN/SERVICE_HEAD/TECHNICAL_TEAM_LEADER-only
//    lock. Applying the lock verbatim would have locked Accountants/Finance Managers out
//    of the exact invoices they need to work on once a job reaches QC_PASSED/DELIVERED -
//    resolved by including ACCOUNTANT/FINANCE_MANAGER in the override role set.
// 2. QC approve/reject at READY_FOR_QC is deliberately gated by an admin-assignable
//    QC_APPROVAL permission grant, not a fixed role list (JobCardsController's QC_GATE_ROLES
//    doc comment) - this util is deliberately never wired into that action.
// 3. validate-sn/assign-section/warranty-override/cancel are already blocked by the state
//    machine itself once a Job Card passes their relevant status (confirmed:
//    JobCardsService.cancel() already throws for READY_FOR_QC/QC_PASSED/DELIVERED) - this
//    util is deliberately never wired into those actions either, to avoid redundant/
//    conflicting gates on top of guards that already do the job correctly.
import { JobCardStatus } from './entities/job-card.entity';
import {
  LATE_STAGE_JOB_CARD_STATUSES,
  JOB_CARD_EDIT_LOCK_OVERRIDE_ROLES,
  isLateStageJobCardStatus,
  canEditLateStageJobCard,
  getJobCardEditLock,
} from './job-card-edit-lock.util';

const EARLY_STATUSES = [
  JobCardStatus.OPEN,
  JobCardStatus.SN_VALIDATED,
  JobCardStatus.SECTION_ASSIGNED,
  JobCardStatus.RWR,
  JobCardStatus.WORKSHOP_ASSIGNED,
  JobCardStatus.IN_PROGRESS,
  JobCardStatus.SPARE_PENDING,
];

describe('isLateStageJobCardStatus', () => {
  it.each(LATE_STAGE_JOB_CARD_STATUSES)('treats %s as late-stage', (status) => {
    expect(isLateStageJobCardStatus(status)).toBe(true);
  });

  it.each(EARLY_STATUSES)('does not treat %s as late-stage', (status) => {
    expect(isLateStageJobCardStatus(status)).toBe(false);
  });
});

describe('canEditLateStageJobCard', () => {
  it('allows every role when the Job Card is not late-stage', () => {
    expect(canEditLateStageJobCard(JobCardStatus.IN_PROGRESS, 'TECHNICIAN_WORKSHOP')).toBe(true);
    expect(canEditLateStageJobCard(JobCardStatus.IN_PROGRESS, 'CCE')).toBe(true);
  });

  it.each(JOB_CARD_EDIT_LOCK_OVERRIDE_ROLES)('allows %s on a late-stage Job Card', (role) => {
    expect(canEditLateStageJobCard(JobCardStatus.QC_PASSED, role)).toBe(true);
  });

  it('blocks a role outside the override set on a late-stage Job Card', () => {
    expect(canEditLateStageJobCard(JobCardStatus.QC_PASSED, 'CCE')).toBe(false);
    expect(canEditLateStageJobCard(JobCardStatus.DELIVERED, 'TECHNICIAN_FIELD')).toBe(false);
    expect(canEditLateStageJobCard(JobCardStatus.CANCELLED, 'QC_OFFICER')).toBe(false);
  });

  it('blocks even on READY_FOR_QC for a role outside the override set (display-only - qc-approve/reject has its own separate grant check)', () => {
    expect(canEditLateStageJobCard(JobCardStatus.READY_FOR_QC, 'QC_OFFICER')).toBe(false);
  });
});

describe('getJobCardEditLock', () => {
  it('reports unlocked with no allowed-roles list for an early status', () => {
    expect(getJobCardEditLock(JobCardStatus.SECTION_ASSIGNED)).toEqual({
      locked: false,
      allowedRoles: [],
      reason: null,
    });
  });

  it('reports locked with the override roles and a human-readable reason for a late status', () => {
    const lock = getJobCardEditLock(JobCardStatus.DELIVERED);
    expect(lock.locked).toBe(true);
    expect(lock.allowedRoles).toEqual(JOB_CARD_EDIT_LOCK_OVERRIDE_ROLES);
    expect(lock.reason).toContain('DELIVERED');
  });

  it('returns a fresh array each call (callers cannot mutate the shared constant)', () => {
    const a = getJobCardEditLock(JobCardStatus.CANCELLED);
    const b = getJobCardEditLock(JobCardStatus.CANCELLED);
    expect(a.allowedRoles).not.toBe(b.allowedRoles);
    expect(a.allowedRoles).toEqual(b.allowedRoles);
  });
});
