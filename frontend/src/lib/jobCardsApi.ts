// Thin wrappers over the real backend endpoints in src/job-cards/job-cards.controller.ts -
// one function per route actually exposed. There is deliberately no "list all job cards"
// wrapper here: the backend has no such endpoint (only get-by-id and get-by-appointment),
// so a Job Card is always reached by pasting an appointment id, the same way Warranty
// Master and Spare Parts already work on this frontend. qcApprove/qcReject were added in
// Frontend Phase 7 (QC + Permissions admin) - they live here rather than in a separate
// "qc" API file because they're plain Job Card mutations under QC_GATE_ROLES, same as
// warrantyOverride above.
import { api } from './api';
import type {
  ApproveCustomerInput,
  AssignSectionInput,
  BlockedAppointmentForJobCard,
  CancelJobCardInput,
  CreateJobCardInput,
  EligibleAppointmentForJobCard,
  JobCard,
  JobCardTaskPause,
  PauseTaskInput,
  QcRejectInput,
  ValidateSnInput,
  WarrantyOverrideInput,
} from './jobCardsTypes';

const BASE = '/job-cards';

export const createJobCard = (data: CreateJobCardInput) => api.post<JobCard>(BASE, data).then((r) => r.data);

// Job Cards page (requested 2026-09-17): "instead now user copy paste appointment number
// for job creation" - lists exactly the appointments create() above would accept right
// now, so the page can offer them directly rather than the user hunting one down first
// (e.g. from the Schedule page's own "+ Create Job" pill). `q` narrows by appointment
// number/customer name/phone; omitted or blank returns the full eligible pool, same as
// leaving the search box empty on the Job Card Journey page's search - except here that
// deliberately shows the whole list rather than nothing, since browsing IS the point.
export const getEligibleAppointmentsForJobCard = (q?: string) => {
  const trimmed = q?.trim();
  return api
    .get<EligibleAppointmentForJobCard[]>(`${BASE}/eligible-appointments`, { params: trimmed ? { q: trimmed } : {} })
    .then((r) => r.data);
};

// 2026-09-21 live finding (see BlockedAppointmentForJobCard's own doc comment): the
// counterpart to getEligibleAppointmentsForJobCard above - same shape, same blank-q
// behavior - but for rows that look ready (S/N/warranty/fault/symptom captured, no Job
// Card yet) and are still excluded, plus why, so the empty state isn't a dead end.
export const getBlockedAppointmentsForJobCard = (q?: string) => {
  const trimmed = q?.trim();
  return api
    .get<BlockedAppointmentForJobCard[]>(`${BASE}/blocked-appointments`, { params: trimmed ? { q: trimmed } : {} })
    .then((r) => r.data);
};

export const getJobCard = (id: string) => api.get<JobCard>(`${BASE}/${id}`).then((r) => r.data);

export const getJobCardByAppointment = (appointmentId: string) =>
  api.get<JobCard>(`${BASE}/by-appointment/${appointmentId}`).then((r) => r.data);

export const validateSn = (id: string, data: ValidateSnInput) =>
  api.post<JobCard>(`${BASE}/${id}/validate-sn`, data).then((r) => r.data);

export const assignSection = (id: string, data: AssignSectionInput) =>
  api.post<JobCard>(`${BASE}/${id}/assign-section`, data).then((r) => r.data);

export const approveCustomer = (id: string, data: ApproveCustomerInput) =>
  api.post<JobCard>(`${BASE}/${id}/approve-customer`, data).then((r) => r.data);

export const warrantyOverride = (id: string, data: WarrantyOverrideInput) =>
  api.post<JobCard>(`${BASE}/${id}/warranty-override`, data).then((r) => r.data);

export const cancelJobCard = (id: string, data: CancelJobCardInput) =>
  api.post<JobCard>(`${BASE}/${id}/cancel`, data).then((r) => r.data);

// Gated by PermissionsService.requireActiveGrant(user.id, QC_APPROVAL), not a fixed
// @Roles() list - see QC_GATE_ROLES in job-cards.controller.ts. On success this also
// atomically consumes the job's reserved stock (Main Store -> Damage Location); on a
// stock shortfall it 409s with { message, blockers: [...] } - callers should render
// that structured shape, not just error.message (the-fool pre-mortem finding #2).
export const qcApprove = (id: string) => api.post<JobCard>(`${BASE}/${id}/qc/approve`).then((r) => r.data);

// Sends the job back to IN_PROGRESS and increments qcRejectionCount - same QC_APPROVAL
// grant gate as approve.
export const qcReject = (id: string, data: QcRejectInput) =>
  api.post<JobCard>(`${BASE}/${id}/qc/reject`, data).then((r) => r.data);

// Task-timer pause/resume (SLA-safe pausing). Gated server-side to the assigned technician
// (workshop or field) or a JOB_CARD_ROLES office role - see JobCardsService.pauseTask.
export const pauseTask = (id: string, data: PauseTaskInput) =>
  api.post<JobCardTaskPause>(`${BASE}/${id}/pause`, data).then((r) => r.data);

export const resumeTask = (id: string) =>
  api.post<JobCardTaskPause>(`${BASE}/${id}/resume`).then((r) => r.data);

export const getTaskPauses = (id: string) =>
  api.get<JobCardTaskPause[]>(`${BASE}/${id}/pauses`).then((r) => r.data);
