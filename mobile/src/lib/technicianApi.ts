// Thin wrapper over the real backend endpoint, matching the web app's
// src/lib/appointmentsApi.ts one-function-per-route pattern.
import { api } from './api';
import type {
  CaptureFaultSymptomInput,
  CaptureSerialNumberInput,
  CompleteVisitInput,
  JobCardSummary,
  JobCardTaskPause,
  NeedSpareInput,
  NeedSpareReservation,
  OwnJobCardResult,
  PauseTaskInput,
  ScheduledAppointment,
  StartVisitInput,
  TechnicianVisit,
} from './types';

const TECH_BASE = '/technician';
// Task timer pause/resume lives on the general Job Cards controller, not the /technician
// namespace - see src/job-cards/job-cards.controller.ts. Ownership there is enforced
// server-side (the caller must be the appointment's assigned field technician, or a
// JOB_CARD_ROLES office role), same as every other job-cards.controller.ts endpoint.
const JOB_CARDS_BASE = '/job-cards';

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

// Mobile Phase 5. Always 200 - `jobCard` is null until staff create one for this visit,
// which is expected and NOT surfaced as an error (unlike getVisit's 404-means-not-started
// convention above). `spareRequest` (added 2026-09-07) is the latest Need Spare request
// ever made against that Job Card, or null - see OwnJobCardResult's doc comment. The
// detail screen polls this to decide when to show Need Spare/Complete, and to reflect a
// Team Leader's review of a pending request without the technician having to do anything.
export const getOwnJobCard = (appointmentId: string) =>
  api.get<OwnJobCardResult>(`${TECH_BASE}/visits/${appointmentId}/job-card`).then((r) => r.data);

// Creates a PENDING_REVIEW request - no stock moves until a TL reviews it. `idempotencyKey`
// must be generated once per user-initiated tap (see offlineQueue.ts) so a retried
// offline-queue sync for the SAME tap can't be mistaken for a second, genuine request.
export const requestNeedSpare = (appointmentId: string, data: NeedSpareInput) =>
  api.post<NeedSpareReservation>(`${TECH_BASE}/visits/${appointmentId}/need-spare`, data).then((r) => r.data);

// Hands the Job Card to QC and completes the appointment. No precondition beyond the
// Job Card already being an assigned on-site-repair job - by the time one exists at all,
// serial number + fault/symptom are already guaranteed captured (JobCardsService.create()'s
// own Gate 1), so there's no diagnostic data this could be missing.
export const completeVisit = (appointmentId: string, data: CompleteVisitInput) =>
  api.post<JobCardSummary>(`${TECH_BASE}/visits/${appointmentId}/complete`, data).then((r) => r.data);

// --- Task timer pause/resume (SLA-safe pausing) --------------------------------------

export const pauseTask = (jobCardId: string, data: PauseTaskInput) =>
  api.post<JobCardTaskPause>(`${JOB_CARDS_BASE}/${jobCardId}/pause`, data).then((r) => r.data);

export const resumeTask = (jobCardId: string) =>
  api.post<JobCardTaskPause>(`${JOB_CARDS_BASE}/${jobCardId}/resume`).then((r) => r.data);

export const getTaskPauses = (jobCardId: string) =>
  api.get<JobCardTaskPause[]>(`${JOB_CARDS_BASE}/${jobCardId}/pauses`).then((r) => r.data);
