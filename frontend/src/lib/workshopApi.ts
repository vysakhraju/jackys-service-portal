// Thin wrappers over src/workshop/workshop.controller.ts - one function per route that
// actually exists. There is no "list workshop jobs" wrapper here, same reason there's no
// "list all job cards" wrapper in jobCardsApi.ts: the backend has no such endpoint. A
// workshop job is always reached by pasting its Job Card id (from the Job Cards screen's
// "Go to Workshop →" link, or directly).
import { api } from './api';
import type { AssignWorkshopInput, RequestSpareInput, WorkshopState } from './workshopTypes';
import type { InventoryReservation } from './inventoryTypes';
import type { JobCard } from './jobCardsTypes';

const BASE = '/workshop';

export const assignWorkshopTechnician = (jobCardId: string, data: AssignWorkshopInput) =>
  api.post<JobCard>(`${BASE}/${jobCardId}/assign`, data).then((r) => r.data);

export const startWip = (jobCardId: string) => api.post<JobCard>(`${BASE}/${jobCardId}/start-wip`).then((r) => r.data);

export const requestSpare = (jobCardId: string, data: RequestSpareInput) =>
  api.post<InventoryReservation>(`${BASE}/${jobCardId}/request-spare`, data).then((r) => r.data);

export const completeWorkshop = (jobCardId: string) => api.post<JobCard>(`${BASE}/${jobCardId}/complete`).then((r) => r.data);

export const getWorkshopState = (jobCardId: string) => api.get<WorkshopState>(`${BASE}/${jobCardId}`).then((r) => r.data);
