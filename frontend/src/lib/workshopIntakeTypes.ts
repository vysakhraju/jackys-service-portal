// Appointment/Mobile/Job Card overhaul Phase 4 (2026-09-16) - see
// claude/APPOINTMENT_MOBILE_JOBCARD_SPEC.md section 3.4. Mirrors TechnicianVisit's own
// FR-03/FR-04 shape (appointmentsTypes.ts) exactly, since WorkshopIntake is the
// COLLECTED_TO_WS-only equivalent of a field technician's visit record - same fields,
// captured on the web by a workshop/CCE user instead of on-site by a technician.
import type { CaptureFaultSymptomInput, CaptureSerialNumberInput, WarrantyStatusValue } from './appointmentsTypes';

export interface WorkshopIntake {
  id: string;
  appointmentId: string;
  receivedByUserId: string;
  receivedAt: string;
  serialNumber: string | null;
  brand: string | null;
  warrantyStatus: WarrantyStatusValue | null;
  warrantySupplier: string | null;
  warrantyPeriodMonths: number | null;
  serialNumberCapturedAt: string | null;
  faultCode: string | null;
  symptomCode: string | null;
  faultSymptomCapturedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Re-exported so callers only need one import for the whole workshop-intake flow -
// identical shape to the technician mobile capture DTOs (the backend imports the very same
// DTO classes for both).
export type { CaptureFaultSymptomInput, CaptureSerialNumberInput };
