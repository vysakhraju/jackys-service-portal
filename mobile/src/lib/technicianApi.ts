// Thin wrapper over the real backend endpoint, matching the web app's
// src/lib/appointmentsApi.ts one-function-per-route pattern.
import { api } from './api';
import type {
  CaptureFaultSymptomInput,
  CaptureSerialNumberInput,
  ScheduledAppointment,
  StartVisitInput,
  TechnicianVisit,
} from './types';

const TECH_BASE = '/technician';

export const getMySchedule = (date?: string) =>
  api.get<ScheduledAppointment[]>(`${TECH_BASE}/schedule`, { params: date ? { date } : {} }).then((r) => r.data);

export const startVisit = (appointmentId: string, data: StartVisitInput) =>
  api.post<TechnicianVisit>(`${TECH_BASE}/visits/${appointmentId}/start`, data).then((r) => r.data);

// 404 means "not started yet" - callers should treat that as expected, not an error to
// surface (mirrors the web app's FieldVisitsPage.tsx `visitNotFound` handling).
export const getVisit = (appointmentId: string) =>
  api.get<TechnicianVisit>(`${TECH_BASE}/visits/${appointmentId}`).then((r) => r.data);

// Phase 3. Re-capturing clears any previously recorded fault/symptom pair server-side
// (the backend gates fault/symptom on the *current* validated S/N) - callers should
// invalidate/refetch the visit after this resolves rather than trusting stale local state.
export const captureSerialNumber = (appointmentId: string, data: CaptureSerialNumberInput) =>
  api.post<TechnicianVisit>(`${TECH_BASE}/visits/${appointmentId}/serial-number`, data).then((r) => r.data);

// 400s if the serial number hasn't been captured yet; 404s if either code is unknown -
// shouldn't happen in practice since the picker only offers codes from the same
// GET /master-data/fault-symptoms list the backend validates against.
export const captureFaultSymptom = (appointmentId: string, data: CaptureFaultSymptomInput) =>
  api.post<TechnicianVisit>(`${TECH_BASE}/visits/${appointmentId}/fault-symptom`, data).then((r) => r.data);
