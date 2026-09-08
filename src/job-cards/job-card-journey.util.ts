// Pure, side-effect-free helper that turns a Job Card's full cross-module state (its own
// fields, plus its Appointment/TechnicianVisit/Delivery) into an ordered list of lifecycle
// steps for the "Job Card Journey" page - one screen showing the whole scheduled ->
// completed cycle, so a user tracking a specific job doesn't have to hop between the
// Appointments, Job Cards, Workshop, QC, and Delivery screens (each of which only ever
// shows one slice, by this codebase's deliberate "no list-all, paste the id" design - see
// JobCardsPage/EstimatesPage/WorkshopPage/QcPage's own doc comments).
//
// Deliberately NOT a source of truth for anything: exactly like getJobCardNextStepText in
// job-card-progress.util.ts, this only describes what already happened - every actual gate/
// guard stays exactly where it already lives (each service's own methods). If this function
// disagrees with reality because of a bug, that's a display bug, not a business-logic one.
//
// "current" here means "this is what getJobCardNextStepText would describe as the next
// action" - i.e. current = the step JUST AFTER whatever the job card's status confirms is
// already done, mirroring that function's own status -> next-action switch, NOT a step
// whose own name happens to equal the current status (SECTION_ASSIGNED status means the
// section WAS assigned - already done - the current/highlighted step is whatever comes
// after it). IN_PROGRESS/SPARE_PENDING are the one exception: those describe an ongoing
// action, not a completed milestone, so the "in_progress" step is itself "current" while
// the job card sits in either of those two statuses.
import { JobCard, JobCardSection, JobCardStatus } from './entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { DeliveryStatus } from '../delivery/entities/delivery.entity';

export type JourneyStepState = 'done' | 'current' | 'pending' | 'skipped' | 'cancelled';

export interface JourneyStep {
  key: string;
  label: string;
  state: JourneyStepState;
  at: Date | null;
  detail?: string;
}

export interface JourneyInput {
  appointment: { createdAt: Date; scheduledAt: Date };
  visit: { startedAt: Date } | null;
  jobCard: Pick<
    JobCard,
    | 'createdAt'
    | 'status'
    | 'section'
    | 'warrantyStatus'
    | 'snValidatedAgainstInvoice'
    | 'snValidationNotes'
    | 'customerApproved'
    | 'qcRejectionCount'
    | 'cancellationReason'
    | 'onSiteCompletionNotes'
  >;
  delivery: {
    createdAt: Date;
    status: DeliveryStatus;
    dispatchedAt: Date | null;
    deliveredAt: Date | null;
    cancellationReason: string | null;
    deliveryNumber: string;
  } | null;
}

// Statuses at/after which a given milestone has definitely already happened - deliberately
// defined as "everything from here on", not "everything except the ones before", so adding
// a brand-new status later fails loud (TS exhaustiveness on the switch below) rather than
// silently being miscategorized.
function reached(status: JobCardStatus, atLeast: JobCardStatus[]): boolean {
  return atLeast.includes(status);
}

const AFTER_SN_VALIDATED = [
  JobCardStatus.SECTION_ASSIGNED,
  JobCardStatus.WORKSHOP_ASSIGNED,
  JobCardStatus.IN_PROGRESS,
  JobCardStatus.SPARE_PENDING,
  JobCardStatus.READY_FOR_QC,
  JobCardStatus.QC_PASSED,
  JobCardStatus.DELIVERED,
];
const AFTER_SECTION_ASSIGNED = [
  JobCardStatus.WORKSHOP_ASSIGNED,
  JobCardStatus.IN_PROGRESS,
  JobCardStatus.SPARE_PENDING,
  JobCardStatus.READY_FOR_QC,
  JobCardStatus.QC_PASSED,
  JobCardStatus.DELIVERED,
];
const AFTER_WORKSHOP_ASSIGNED = [
  JobCardStatus.IN_PROGRESS,
  JobCardStatus.SPARE_PENDING,
  JobCardStatus.READY_FOR_QC,
  JobCardStatus.QC_PASSED,
  JobCardStatus.DELIVERED,
];
const AFTER_IN_PROGRESS = [JobCardStatus.READY_FOR_QC, JobCardStatus.QC_PASSED, JobCardStatus.DELIVERED];
const AFTER_READY_FOR_QC = [JobCardStatus.QC_PASSED, JobCardStatus.DELIVERED];
const AFTER_QC_PASSED = [JobCardStatus.DELIVERED];

export function buildJourneySteps(input: JourneyInput): JourneyStep[] {
  const { appointment, visit, jobCard, delivery } = input;
  const status = jobCard.status;
  const isCancelled = status === JobCardStatus.CANCELLED;
  const isRwr = status === JobCardStatus.RWR;
  const isOnSite = jobCard.section === JobCardSection.ON_SITE_REPAIR;

  const steps: JourneyStep[] = [
    {
      key: 'scheduled',
      label: 'Appointment scheduled',
      state: 'done',
      at: appointment.createdAt,
      detail: `Scheduled for ${new Date(appointment.scheduledAt).toLocaleString()}`,
    },
    {
      key: 'visit_started',
      // Gate 1 (job-cards.service.ts create()) guarantees a visit with S/N + fault/symptom
      // already exists before a Job Card can ever be created, so this is always 'done' in
      // practice by the time a journey is being viewed at all.
      label: 'Technician started the visit',
      state: visit ? 'done' : 'pending',
      at: visit?.startedAt ?? null,
    },
    {
      key: 'job_card_created',
      label: 'Job Card created',
      state: 'done',
      at: jobCard.createdAt,
    },
  ];

  if (isCancelled) {
    // A cancelled Job Card's status no longer tells us exactly how far it got, and there's
    // no historical marker to reconstruct that from - honest middle ground: everything past
    // "it definitely existed" shows as skipped rather than a guessed done/pending split.
    for (const [key, label] of [
      ['sn_validated', 'Serial number validated against invoice'],
      ['section_assigned', 'Section assigned'],
      ['ready_for_qc', 'Ready for QC'],
      ['qc_passed', 'QC passed'],
    ] as const) {
      steps.push({ key, label, state: 'skipped', at: null });
    }
    steps.push({
      key: 'cancelled',
      label: 'Job Card cancelled',
      state: 'cancelled',
      at: null,
      detail: jobCard.cancellationReason ?? undefined,
    });
    // Nothing past cancellation is knowable/relevant - a Delivery can never exist for a
    // cancelled Job Card (JobCardsController.cancel()'s own guard), so stop here.
    return steps;
  }

  steps.push({
    key: 'sn_validated',
    label: 'Serial number validated against invoice',
    state: isRwr ? 'current' : status === JobCardStatus.OPEN ? 'current' : 'done',
    at: jobCard.snValidatedAgainstInvoice ? jobCard.createdAt : null,
    detail: isRwr
      ? 'Customer rejected the estimate - waiting on a revised one before this can proceed'
      : (jobCard.snValidationNotes ?? undefined),
  });

  const warrantyLabel = jobCard.warrantyStatus === WarrantyStatus.IN_WARRANTY ? 'in warranty' : 'out of warranty';
  const sectionAssignedDone = reached(status, AFTER_SECTION_ASSIGNED) || status === JobCardStatus.SECTION_ASSIGNED;
  steps.push({
    key: 'section_assigned',
    label: 'Section assigned',
    state: isRwr || status === JobCardStatus.OPEN
      ? 'pending'
      : sectionAssignedDone
        ? 'done'
        : status === JobCardStatus.SN_VALIDATED
          ? 'current'
          : 'pending',
    at: null,
    detail: jobCard.section
      ? `${jobCard.section === JobCardSection.WORKSHOP ? 'Workshop repair' : 'On-site repair'} (${warrantyLabel})`
      : jobCard.warrantyStatus === WarrantyStatus.OUT_OF_WARRANTY && !jobCard.customerApproved
        ? 'Waiting on customer approval (out of warranty) before a section can be assigned'
        : undefined,
  });

  // Workshop-only tier - omitted entirely once we know for certain this is an on-site job
  // (completeOnSiteRepair() never touches WORKSHOP_ASSIGNED/IN_PROGRESS/SPARE_PENDING at
  // all), shown as upcoming possibilities while the section is still undecided.
  if (!isOnSite) {
    steps.push({
      key: 'workshop_assigned',
      label: 'Workshop technician assigned',
      // SECTION_ASSIGNED is folded into 'current' here too, same reasoning as
      // ready_for_qc's own SECTION_ASSIGNED case below: once the section itself is
      // assigned to WORKSHOP, assigning a workshop technician IS the very next action -
      // without this, a job sitting at SECTION_ASSIGNED showed no 'current' step at all
      // (section_assigned reads 'done', and nothing after it claimed 'current').
      state: status === JobCardStatus.WORKSHOP_ASSIGNED || status === JobCardStatus.SECTION_ASSIGNED
        ? 'current'
        : reached(status, AFTER_WORKSHOP_ASSIGNED)
          ? 'done'
          : 'pending',
      at: null,
    });
    steps.push({
      key: 'in_progress',
      label: 'Repair in progress',
      state: status === JobCardStatus.IN_PROGRESS || status === JobCardStatus.SPARE_PENDING
        ? 'current'
        : reached(status, AFTER_IN_PROGRESS)
          ? 'done'
          : 'pending',
      at: null,
      detail: status === JobCardStatus.SPARE_PENDING ? 'Waiting on spare part stock' : undefined,
    });
  }

  steps.push({
    key: 'ready_for_qc',
    label: 'Ready for QC',
    // On-site repairs skip the workshop-only tier entirely (completeOnSiteRepair() jumps
    // SECTION_ASSIGNED -> READY_FOR_QC directly, per technician.service.ts) - so for an
    // on-site job sitting at SECTION_ASSIGNED, THIS is the next action, not
    // workshop_assigned/in_progress (which aren't even rendered for this section). Without
    // this case, an on-site job actively being worked on-site showed no 'current' step at
    // all between "section assigned" (done) and "ready for QC" (pending).
    state:
      status === JobCardStatus.READY_FOR_QC
        ? 'current'
        : reached(status, AFTER_READY_FOR_QC)
          ? 'done'
          : isOnSite && status === JobCardStatus.SECTION_ASSIGNED
            ? 'current'
            : 'pending',
    at: null,
    detail: jobCard.onSiteCompletionNotes ?? undefined,
  });

  steps.push({
    key: 'qc_passed',
    label: 'QC passed',
    state: status === JobCardStatus.QC_PASSED ? 'current' : reached(status, AFTER_QC_PASSED) ? 'done' : 'pending',
    at: null,
    detail: jobCard.qcRejectionCount > 0 ? `Previously sent back by QC ${jobCard.qcRejectionCount}x` : undefined,
  });

  steps.push({
    key: 'delivery_created',
    label: 'Delivery created',
    state: delivery ? 'done' : 'pending',
    at: delivery?.createdAt ?? null,
    detail: delivery ? `${delivery.deliveryNumber}${delivery.status === DeliveryStatus.CANCELLED ? ' (cancelled)' : ''}` : undefined,
  });

  if (delivery?.status === DeliveryStatus.CANCELLED) {
    steps.push({
      key: 'delivery_cancelled',
      label: 'Delivery cancelled',
      state: 'cancelled',
      at: null,
      detail: delivery.cancellationReason ?? 'This Job Card is back in the Ready for Delivery pool.',
    });
    return steps;
  }

  steps.push({
    key: 'dispatched',
    label: 'Dispatched',
    state: delivery && (delivery.status === DeliveryStatus.DISPATCHED || delivery.status === DeliveryStatus.DELIVERED) ? 'done' : 'pending',
    at: delivery?.dispatchedAt ?? null,
  });

  steps.push({
    key: 'delivered',
    label: 'Delivered (POD captured)',
    state: delivery?.status === DeliveryStatus.DELIVERED ? 'done' : 'pending',
    at: delivery?.deliveredAt ?? null,
  });

  return steps;
}
