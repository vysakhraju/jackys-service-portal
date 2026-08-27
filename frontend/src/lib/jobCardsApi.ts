// Thin wrappers over the real backend endpoints in src/job-cards/job-cards.controller.ts -
// one function per route actually exposed. There is deliberately no "list all job cards"
// wrapper here: the backend has no such endpoint (only get-by-id and get-by-appointment),
// so a Job Card is always reached by pasting an appointment id, the same way Warranty
// Master and Spare Parts already work on this frontend. qc/approve and qc/reject are not
// wrapped here either - those belong to the QC + Permissions admin screens (Frontend
// Phase 7), not this phase.
import { api } from './api';
import type {
  ApproveCustomerInput,
  AssignSectionInput,
  CancelJobCardInput,
  CreateJobCardInput,
  JobCard,
  ValidateSnInput,
  WarrantyOverrideInput,
} from './jobCardsTypes';

const BASE = '/job-cards';

export const createJobCard = (data: CreateJobCardInput) => api.post<JobCard>(BASE, data).then((r) => r.data);

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
