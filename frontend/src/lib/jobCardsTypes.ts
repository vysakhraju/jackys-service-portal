// Shapes mirrored from the backend's Job Cards module (src/job-cards/entities/job-card.entity.ts,
// src/job-cards/dto/*). Warranty status reuses the same IW/OOW enum Technician Visits use
// (src/technician/entities/technician-visit.entity.ts) - see appointmentsTypes.ts.
import type { Appointment, UserRef, WarrantyStatusValue } from './appointmentsTypes';

export const JOB_CARD_STATUSES = [
  'OPEN',
  'SN_VALIDATED',
  'SECTION_ASSIGNED',
  'RWR',
  'WORKSHOP_ASSIGNED',
  'IN_PROGRESS',
  'SPARE_PENDING',
  'READY_FOR_QC',
  'QC_PASSED',
  'DELIVERED',
  'CANCELLED',
  // Job Type split (2026-09-22 request, Phase 10) - terminal status for a Job Card
  // created via the ERP-sourced Installation/Delivery Installation flow
  // (createFromActivity()), which bypasses the OPEN -> ... pipeline entirely.
  'COMPLETED',
] as const;
export type JobCardStatusValue = (typeof JOB_CARD_STATUSES)[number];

export const JOB_CARD_SECTIONS = ['ON_SITE_REPAIR', 'WORKSHOP'] as const;
export type JobCardSectionValue = (typeof JOB_CARD_SECTIONS)[number];

// Lane: A = on-site repair + in warranty, B = on-site repair + out of warranty,
// C = workshop + in warranty, D = workshop + out of warranty. Derived server-side from
// section + warrantyStatus (see backend job-card-progress.util.ts) - null until a
// section has been assigned, since warranty status alone doesn't place a job in a lane.
export const JOB_CARD_LANES = ['A', 'B', 'C', 'D'] as const;
export type JobCardLaneValue = (typeof JOB_CARD_LANES)[number];

export interface JobCard {
  id: string;
  jobCardNumber: string;
  // Present on GET /job-cards/:id (findById loads the appointment relation) - the
  // by-appointment lookup does not. Estimates screens read customerPhone/customerEmail
  // from here for the Record Response prefill (the-fool pre-mortem, Phase 5). Modification
  // Request (2026-09-15): also now present on GET /delivery/ready's rows (Customer
  // type/Brand/Model/created-date columns) and on GET /delivery/:id/job-cards's rows.
  appointment?: Appointment;
  appointmentId: string;
  status: JobCardStatusValue;
  section: JobCardSectionValue | null;
  // Job Type split (Phase 10): null for a COMPLETED (ERP-sourced Installation/Delivery
  // Installation) Job Card - none of the REPAIR flow's S/N/fault/symptom/warranty capture
  // applies to it. Always populated for every other status.
  serialNumber: string | null;
  brand: string | null;
  faultCode: string | null;
  symptomCode: string | null;
  originalWarrantyStatus: WarrantyStatusValue | null;
  warrantyStatus: WarrantyStatusValue | null;
  // Job Type split (Phase 10) - the ERP reference number captured by the new creation
  // popup. Null for every REPAIR-flow Job Card.
  erpReferenceNumber: string | null;
  snValidatedAgainstInvoice: boolean;
  snValidationNotes: string | null;
  warrantyOverridden: boolean;
  warrantyOverrideReason: string | null;
  warrantyOverrideByUser?: UserRef | null;
  warrantyOverrideBy: string | null;
  warrantyOverrideAt: string | null;
  overrideCount: number;
  customerApproved: boolean;
  customerApprovalNotes: string | null;
  assignedWorkshopTechnicianId: string | null;
  workshopAssignedAt: string | null;
  qcApprovedByUserId: string | null;
  qcApprovedAt: string | null;
  qcRejectionCount: number;
  lastQcRejectedAt: string | null;
  lastQcRejectionReason: string | null;
  cancellationReason: string | null;
  deliveryId: string | null;
  publicToken: string | null;
  publicTokenExpiresAt: string | null;
  createdBy?: UserRef;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  // Computed, not stored - present on GET /job-cards/:id and GET
  // /job-cards/by-appointment/:appointmentId. Optional so any older cached response
  // shape (or a mock in a test) that predates this field keeps typechecking.
  lane?: JobCardLaneValue | null;
  nextStepText?: string;
  // Job Type split (Phase 10) - always [] for a REPAIR-flow Job Card. Optional so any
  // older cached response shape (or a mock in a test) that predates this field keeps
  // typechecking, same reasoning as lane/nextStepText above.
  activityLineItems?: JobCardActivityLineItem[];
}

// Matches CreateJobCardDto exactly.
export interface CreateJobCardInput {
  appointmentId: string;
}

// Job Type split (2026-09-22 request, Phase 10) - the new Job Card creation flow for
// Installation/Delivery Installation appointments. Mirrors the backend's
// JobCardActivityLineItem entity / CreateActivityJobCardDto exactly.
export type ActivityJobCardLineItemJobType = 'INSTALLATION' | 'DELIVERY_INSTALLATION';

export interface JobCardActivityLineItem {
  id: string;
  jobCardId: string;
  applianceModelId: string;
  // Loaded via getActivityLineItems()/findById()'s relations - just enough to label a
  // line without pulling in the full ApplianceModel shape.
  applianceModel?: { id: string; brand: string; model: string };
  jobType: ActivityJobCardLineItemJobType;
  quantity: number;
  finished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityJobCardLineItemInput {
  applianceModelId: string;
  jobType: ActivityJobCardLineItemJobType;
  quantity: number;
  finished: boolean;
}

// Matches CreateActivityJobCardDto exactly.
export interface CreateActivityJobCardInput {
  appointmentId: string;
  erpReferenceNumber: string;
  lineItems: ActivityJobCardLineItemInput[];
}

// GET /job-cards/eligible-activity-appointments - the Installation/Delivery Installation
// counterpart to EligibleAppointmentForJobCard above. Real precondition: the appointment's
// mobile Activity must already be FINISHED (see AppointmentsService.getActivity()), not
// FR-05's invoice/S-N/fault-symptom gate.
export interface EligibleActivityAppointmentForJobCard {
  id: string;
  appointmentNumber: string;
  customerName: string;
  customerPhone: string;
  status: string;
  scheduledAt: string;
  jobType: ActivityJobCardLineItemJobType;
}

// GET /job-cards/eligible-appointments (requested 2026-09-17) - backs the Job Cards
// page's "eligible for Job Card creation" picker. Just enough per row for that picker,
// not the full Appointment shape - see JobCardsService.findEligibleForJobCardCreation's
// own doc comment for exactly which appointments this includes.
export interface EligibleAppointmentForJobCard {
  id: string;
  appointmentNumber: string;
  customerName: string;
  customerPhone: string;
  status: string;
  scheduledAt: string;
}

// 2026-09-21 live finding: an appointment can have S/N/warranty/fault/symptom fully
// captured and no Job Card yet - everything the "Pending Job Creation"/"on-site ready"
// badges check - and still be blocked from Job Card creation because of the separate
// invoiceNumber gate (FR-05), with nothing on screen saying why. This is that "why".
// Only one reason exists today; kept as a union (not a bare string) so a second gate
// later is a type change here, not a new shape somewhere else.
export type BlockedJobCardReason = 'MISSING_INVOICE_NUMBER';

export interface BlockedAppointmentForJobCard {
  id: string;
  appointmentNumber: string;
  customerName: string;
  customerPhone: string;
  status: string;
  scheduledAt: string;
  reason: BlockedJobCardReason;
}

export function blockedJobCardReasonText(reason: BlockedJobCardReason): string {
  switch (reason) {
    case 'MISSING_INVOICE_NUMBER':
      return 'Missing invoice number - open this appointment in Appointment Scheduling and fill in its Invoice number field, then it will appear here.';
  }
}

export interface ValidateSnInput {
  matches: boolean;
  notes?: string;
}

export interface AssignSectionInput {
  section: JobCardSectionValue;
}

export interface ApproveCustomerInput {
  notes?: string;
}

// Matches WarrantyOverrideDto - newStatus reuses the same IW/OOW values.
export interface WarrantyOverrideInput {
  newStatus: WarrantyStatusValue;
  reason: string;
}

export interface CancelJobCardInput {
  reason: string;
}

// Matches QcRejectDto exactly - reason is required, 5-500 chars, for the audit trail.
export interface QcRejectInput {
  reason: string;
}

// Task-timer pause/resume (SLA-safe pausing). Mirrors the backend's TaskPauseReason enum
// (src/job-cards/entities/job-card-task-pause.entity.ts) - MATERIAL_SHORTAGE is the only
// reason excluded from the SLA Breach report's elapsed-hours calculation; every other
// reason is still tracked (this list) but still counts against SLA.
export const TASK_PAUSE_REASONS = [
  'MATERIAL_SHORTAGE',
  'AWAITING_CUSTOMER_APPROVAL',
  'CUSTOMER_UNAVAILABLE',
  'BREAK',
  'OTHER',
] as const;
export type TaskPauseReasonValue = (typeof TASK_PAUSE_REASONS)[number];

// One row per pause - "is this job currently paused" is never a stored flag, it's derived
// by finding the row (if any) with resumedAt === null, same as the backend.
export interface JobCardTaskPause {
  id: string;
  jobCardId: string;
  reason: TaskPauseReasonValue;
  notes: string | null;
  pausedByUserId: string | null;
  pausedAt: string;
  resumedByUserId: string | null;
  resumedAt: string | null;
  // True for a MATERIAL_SHORTAGE pause the system opened itself (from a Need Spare
  // shortfall) rather than one a technician started manually.
  autoCreated: boolean;
}

export interface PauseTaskInput {
  reason: TaskPauseReasonValue;
  notes?: string;
}

// The shape ConflictException({ message, blockers }) serializes to on a QC-approve stock
// shortfall - see InventoryService.consumeReservationsOnQcApproval(). Not exported from
// jobCardsApi.ts's qcApprove() itself (axios throws, it doesn't return this) - callers
// read it off the caught AxiosError's response.data.
export interface QcApproveBlocker {
  reservationId: string;
  sparePartId: string;
  quantityRequested: number;
  quantityReserved: number;
}
