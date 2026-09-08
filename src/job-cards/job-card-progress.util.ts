// Pure, side-effect-free helpers that derive UI-facing "where is this job card in its
// workflow" fields from data already stored on the JobCard entity (section,
// warrantyStatus, status, customerApproved). Nothing here is persisted - these are
// computed fresh on every read and attached as plain-object properties at the service
// boundary (see job-cards.service.ts and technician.service.ts), NOT as entity getters,
// because this app has no ClassSerializerInterceptor: a prototype getter is not an
// own-enumerable property and would be silently dropped by JSON.stringify. Keeping this
// logic in one shared backend module (rather than duplicating it in the web frontend and
// the mobile app separately) means web, mobile, and any future consumer all see the same
// lane/next-step text without needing to reimplement the workflow rules themselves.
import { JobCard, JobCardSection, JobCardStatus } from './entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';

export type JobCardLane = 'A' | 'B' | 'C' | 'D';

// A: on-site repair, in warranty. B: on-site repair, out of warranty.
// C: workshop, in warranty. D: workshop, out of warranty.
// Lane is null until a section has been assigned (SECTION_ASSIGNED or later) - warranty
// status alone isn't enough to place a job in a lane, since the lane is fundamentally
// about which physical workflow (on-site vs. workshop) the job is following.
export function getJobCardLane(
  jobCard: Pick<JobCard, 'section' | 'warrantyStatus'>,
): JobCardLane | null {
  if (!jobCard.section) return null;
  const inWarranty = jobCard.warrantyStatus === WarrantyStatus.IN_WARRANTY;
  if (jobCard.section === JobCardSection.ON_SITE_REPAIR) {
    return inWarranty ? 'A' : 'B';
  }
  return inWarranty ? 'C' : 'D';
}

type NextStepInput = Pick<
  JobCard,
  'status' | 'section' | 'warrantyStatus' | 'customerApproved'
>;

// One short, human-readable sentence describing what needs to happen next. Deliberately
// informational only - it does not gate or block anything; the actual enable/disable
// logic for each action stays exactly where it already lives (JobCardsPage.tsx's
// canValidateSn/canAssignSection/blockedByCustomerApproval/etc. on the frontend, and the
// service-layer guards on the backend). This function must never be treated as a source
// of truth for what actions are allowed.
export function getJobCardNextStepText(jobCard: NextStepInput): string {
  switch (jobCard.status) {
    case JobCardStatus.OPEN:
      return 'Validate the serial number against the invoice';
    case JobCardStatus.SN_VALIDATED:
      if (jobCard.warrantyStatus === WarrantyStatus.OUT_OF_WARRANTY && !jobCard.customerApproved) {
        return 'Record customer approval for this out-of-warranty job before assigning a section';
      }
      return 'Assign a section (on-site repair or workshop)';
    case JobCardStatus.RWR:
      return 'Waiting on a revised estimate before this can proceed';
    case JobCardStatus.SECTION_ASSIGNED:
      return jobCard.section === JobCardSection.WORKSHOP
        ? 'Assign a workshop technician'
        : 'Technician to complete the on-site repair';
    case JobCardStatus.WORKSHOP_ASSIGNED:
      return 'Technician to start work-in-progress';
    case JobCardStatus.IN_PROGRESS:
      return 'Technician to complete the repair (or request a spare part)';
    case JobCardStatus.SPARE_PENDING:
      return 'Waiting on spare part stock';
    case JobCardStatus.READY_FOR_QC:
      return 'Awaiting QC approval';
    case JobCardStatus.QC_PASSED:
      return 'Ready for delivery scheduling';
    case JobCardStatus.DELIVERED:
      return 'Complete - delivered to customer';
    case JobCardStatus.CANCELLED:
      return 'Job cancelled';
    default:
      return '';
  }
}

export interface JobCardProgressFields {
  lane: JobCardLane | null;
  nextStepText: string;
}

// Convenience for the two call sites that attach both fields at once.
export function getJobCardProgressFields(jobCard: NextStepInput & Pick<JobCard, 'section' | 'warrantyStatus'>): JobCardProgressFields {
  return {
    lane: getJobCardLane(jobCard),
    nextStepText: getJobCardNextStepText(jobCard),
  };
}
