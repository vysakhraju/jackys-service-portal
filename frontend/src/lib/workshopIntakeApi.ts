// Thin wrappers over src/workshop-intake/workshop-intake.controller.ts (Phase 4, see
// claude/APPOINTMENT_MOBILE_JOBCARD_SPEC.md section 3.4) - one function per route.
import { api } from './api';
import type { CaptureFaultSymptomInput, CaptureSerialNumberInput, WorkshopIntake } from './workshopIntakeTypes';

const BASE = '/workshop-intake';

// null (not a throw) means "not marked received yet" - an ordinary, expected state for
// this screen to render a Mark Received button, matching the backend's own
// WorkshopIntakeService.getIntake() convention.
export const getWorkshopIntake = (appointmentId: string) =>
  api.get<WorkshopIntake | null>(`${BASE}/${appointmentId}`).then((r) => r.data);

export const markWorkshopReceived = (appointmentId: string) =>
  api.post<WorkshopIntake>(`${BASE}/${appointmentId}/mark-received`).then((r) => r.data);

export const captureWorkshopSerialNumber = (appointmentId: string, data: CaptureSerialNumberInput) =>
  api.post<WorkshopIntake>(`${BASE}/${appointmentId}/serial-number`, data).then((r) => r.data);

export const captureWorkshopFaultSymptom = (appointmentId: string, data: CaptureFaultSymptomInput) =>
  api.post<WorkshopIntake>(`${BASE}/${appointmentId}/fault-symptom`, data).then((r) => r.data);
