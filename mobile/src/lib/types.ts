// Shapes mirrored from the backend's real DTOs/entities - kept in lockstep with the
// same source of truth the web app's src/lib/types.ts and src/lib/appointmentsTypes.ts
// already use (src/auth/entities, src/appointments/entities, src/technician/entities
// on the API side). Only what this app's v1 scope actually touches is included here;
// extend as later phases need more of the API surface.

export interface Role {
  id: string;
  name: string; // e.g. "TECHNICIAN_FIELD" - see backend RoleName enum
  displayName: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
}

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  employeeId: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  role: Role;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'TECHNICIAN_ASSIGNED',
  'ON_SITE',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
] as const;
export type AppointmentStatusValue = (typeof APPOINTMENT_STATUSES)[number];

// Today's Schedule (GET /technician/schedule) only needs a subset of the full
// Appointment entity - trimmed here to what the schedule list/detail screens show.
// Widen this (matching the web app's fuller AppointmentsTypes.Appointment) if a later
// phase's screen needs more fields.
export interface ScheduledAppointment {
  id: string;
  appointmentNumber: string;
  status: AppointmentStatusValue;
  customerName: string;
  customerPhone: string;
  customerAddress: string | null;
  customerCity: string | null;
  brand: string | null;
  modelNumber: string | null;
  problemDescription: string | null;
  scheduledAt: string;
  estimatedDurationMinutes: number | null;
}

// Mirrors the backend's TechnicianVisit entity / the web app's
// appointmentsTypes.ts#TechnicianVisit in full, even though Phase 2 only reads
// startGpsLat/startGpsLng/startedAt - the serial-number and fault/symptom fields land in
// Phase 3, which will build directly on this same GET /technician/visits/:id response.
export interface TechnicianVisit {
  id: string;
  appointmentId: string;
  technicianId: string;
  startGpsLat: number;
  startGpsLng: number;
  startedAt: string;
  serialNumber: string | null;
  brand: string | null;
  // The backend's WarrantyStatus enum only has these two values ('IW'/'OOW' - see
  // src/technician/entities/technician-visit.entity.ts) - not the longer IN_WARRANTY/
  // OUT_OF_WARRANTY/EXTENDED_WARRANTY names an earlier draft of this file guessed at.
  warrantyStatus: 'IW' | 'OOW' | null;
  warrantySupplier: string | null;
  warrantyPeriodMonths: number | null;
  serialNumberCapturedAt: string | null;
  faultCode: string | null;
  symptomCode: string | null;
  faultSymptomCapturedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StartVisitInput {
  gpsLat: number;
  gpsLng: number;
}

export interface CaptureSerialNumberInput {
  serialNumber: string;
  brand?: string;
}

export interface CaptureFaultSymptomInput {
  faultCode: string;
  symptomCode: string;
}

// GET /master-data/fault-symptoms - each row is one fault+symptom PAIR, not two
// independent lists (see src/master-data/entities/fault-symptom.entity.ts), so the
// fault/symptom picker below selects one whole row rather than combining fault and
// symptom fields separately.
export const APPLIANCE_CATEGORIES = [
  'REFRIGERATOR',
  'WASHING_MACHINE',
  'AC',
  'MICROWAVE',
  'OVEN',
  'COOKING_RANGE',
  'DISHWASHER',
  'WATER_HEATER',
  'DRYER',
  'OTHER',
] as const;
export type ApplianceCategoryValue = (typeof APPLIANCE_CATEGORIES)[number];

export interface FaultSymptom {
  id: string;
  faultCode: string;
  faultDescription: string;
  symptomCode: string;
  symptomDescription: string;
  category: ApplianceCategoryValue;
  requiresWorkshop: boolean;
  isActive: boolean;
}

// --- Mobile Phase 5: Need Spare + Complete/QC-handoff --------------------------------

// GET /master-data/spare-parts - trimmed to what the Need Spare picker shows/searches;
// widen if a later phase needs pricing/stock fields (src/master-data/entities/spare-part.entity.ts).
export interface SparePart {
  id: string;
  code: string;
  name: string;
  category: string;
  brand: string | null;
  isActive: boolean;
}

// GET /technician/visits/:appointmentId/job-card - 200 with a null body when staff
// haven't created a Job Card for this visit yet (an ordinary, expected state, not an
// error - see technicianApi.ts#getOwnJobCard). Trimmed to what the detail screen needs
// to decide which section to show; mirrors the relevant subset of the backend's JobCard
// entity (src/job-cards/entities/job-card.entity.ts).
export interface JobCardSummary {
  id: string;
  jobCardNumber: string;
  status: string;
  section: 'ON_SITE_REPAIR' | 'WORKSHOP' | null;
  onSiteCompletionNotes: string | null;
}

export interface NeedSpareInput {
  sparePartId: string;
  quantity: number;
  // Generated once per "Need Spare" tap (never derived from the part/job) - see
  // offlineQueue.ts's doc comment on why a queued retry must reuse the SAME key while a
  // fresh tap must generate a new one.
  idempotencyKey: string;
}

// Mirrors the shape InventoryService.requestNeedSpare() returns (a PENDING_REVIEW
// InventoryReservation) - only what the confirmation UI shows.
export interface NeedSpareReservation {
  id: string;
  sparePartId: string;
  quantityRequested: number;
  status: string;
}

export interface CompleteVisitInput {
  notes?: string;
}
