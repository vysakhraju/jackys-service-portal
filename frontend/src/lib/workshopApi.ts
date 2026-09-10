// Thin wrappers over src/workshop/workshop.controller.ts - one function per route that
// actually exists. There is no "list workshop jobs" wrapper here, same reason there's no
// "list all job cards" wrapper in jobCardsApi.ts: the backend has no such endpoint. A
// workshop job is always reached by pasting its Job Card id (from the Job Cards screen's
// "Go to Workshop →" link, or directly).
import { api } from './api';
import type { AddCrewHelperInput, AssignWorkshopInput, JobCardCrewHelper, RequestSpareInput, WorkshopState } from './workshopTypes';
import type { InventoryReservation } from './inventoryTypes';
import type { JobCard } from './jobCardsTypes';

const BASE = '/workshop';

export const assignWorkshopTechnician = (
  jobCardId: string,
  data: AssignWorkshopInput,
  opts?: { skipSuccessToast?: boolean },
) => api.post<JobCard>(`${BASE}/${jobCardId}/assign`, data, opts).then((r) => r.data);

// Technician Assignment Board's reassign action (2026-09-09) - only valid once a job
// already has a workshop technician; use assignWorkshopTechnician above for the first one.
export const reassignWorkshopTechnician = (
  jobCardId: string,
  data: AssignWorkshopInput,
  opts?: { skipSuccessToast?: boolean },
) => api.post<JobCard>(`${BASE}/${jobCardId}/reassign`, data, opts).then((r) => r.data);

export const startWip = (jobCardId: string) => api.post<JobCard>(`${BASE}/${jobCardId}/start-wip`).then((r) => r.data);

export const requestSpare = (jobCardId: string, data: RequestSpareInput) =>
  api.post<InventoryReservation>(`${BASE}/${jobCardId}/request-spare`, data).then((r) => r.data);

export const completeWorkshop = (jobCardId: string) => api.post<JobCard>(`${BASE}/${jobCardId}/complete`).then((r) => r.data);

export const getWorkshopState = (jobCardId: string) => api.get<WorkshopState>(`${BASE}/${jobCardId}`).then((r) => r.data);

// Gantt board's "add crew helper" action, 2026-09-09.
export const addCrewHelper = (
  jobCardId: string,
  data: AddCrewHelperInput,
  opts?: { skipSuccessToast?: boolean },
) => api.post<JobCardCrewHelper>(`${BASE}/${jobCardId}/crew-helpers`, data, opts).then((r) => r.data);

export const listCrewHelpers = (jobCardId: string) =>
  api.get<JobCardCrewHelper[]>(`${BASE}/${jobCardId}/crew-helpers`).then((r) => r.data);

export const removeCrewHelper = (jobCardId: string, helperId: string) =>
  api.post<JobCardCrewHelper>(`${BASE}/${jobCardId}/crew-helpers/${helperId}/remove`).then((r) => r.data);
