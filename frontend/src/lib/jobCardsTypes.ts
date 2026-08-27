// Shapes mirrored from the backend's Job Cards module (src/job-cards/entities/job-card.entity.ts,
// src/job-cards/dto/*). Warranty status reuses the same IW/OOW enum Technician Visits use
// (src/technician/entities/technician-visit.entity.ts) - see appointmentsTypes.ts.
import type { UserRef, WarrantyStatusValue } from './appointmentsTypes';

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
] as const;
export type JobCardStatusValue = (typeof JOB_CARD_STATUSES)[number];

export const JOB_CARD_SECTIONS = ['ON_SITE_REPAIR', 'WORKSHOP'] as const;
export type JobCardSectionValue = (typeof JOB_CARD_SECTIONS)[number];

export interface JobCard {
  id: string;
  jobCardNumber: string;
  appointmentId: string;
  status: JobCardStatusValue;
  section: JobCardSectionValue | null;
  serialNumber: string;
  brand: string | null;
  faultCode: string;
  symptomCode: string;
  originalWarrantyStatus: WarrantyStatusValue;
  warrantyStatus: WarrantyStatusValue;
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
}

// Matches CreateJobCardDto exactly.
export interface CreateJobCardInput {
  appointmentId: string;
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
