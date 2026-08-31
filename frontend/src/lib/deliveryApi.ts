// Thin wrappers over the real backend endpoints in src/delivery/delivery.controller.ts -
// one function per route actually exposed, same convention as every other xApi.ts in this
// project. Unlike most modules, Delivery genuinely has list endpoints (GET /delivery and
// GET /delivery/ready) - it's the exception to the "paste an id, no list-all" rule the rest
// of the app follows, because the backend itself has real list endpoints here.
import { api } from './api';
import type {
  CancelDeliveryInput,
  CapturePodInput,
  CreateDeliveryInput,
  CreateDeliveryResult,
  Delivery,
  DeliveryStatusValue,
  DispatchDeliveryInput,
  ReadyForDeliveryRow,
} from './deliveryTypes';
import type { JobCard } from './jobCardsTypes';
import type { WarrantyStatusValue } from './appointmentsTypes';

const BASE = '/delivery';

export const getReadyForDelivery = (warrantyStatus?: WarrantyStatusValue) =>
  api.get<ReadyForDeliveryRow[]>(`${BASE}/ready`, { params: warrantyStatus ? { warrantyStatus } : undefined }).then((r) => r.data);

export const getDeliveryByJobCard = (jobCardId: string) =>
  api.get<Delivery | null>(`${BASE}/job-card/${jobCardId}`).then((r) => r.data);

export const createDelivery = (data: CreateDeliveryInput) =>
  api.post<CreateDeliveryResult>(BASE, data).then((r) => r.data);

export const listDeliveries = (status?: DeliveryStatusValue) =>
  api.get<Delivery[]>(BASE, { params: status ? { status } : undefined }).then((r) => r.data);

export const getDelivery = (id: string) => api.get<Delivery>(`${BASE}/${id}`).then((r) => r.data);

// Frontend Phase 8 addition to DeliveryController (GET /delivery/:id/job-cards) - the
// only other primitive is job-card -> delivery (getDeliveryByJobCard above), not this
// direction, so the Delivery detail screen needed this to show its batch members.
export const getDeliveryJobCards = (id: string) => api.get<JobCard[]>(`${BASE}/${id}/job-cards`).then((r) => r.data);

export const dispatchDelivery = (id: string, data: DispatchDeliveryInput) =>
  api.post<Delivery>(`${BASE}/${id}/dispatch`, data).then((r) => r.data);

export const capturePod = (id: string, data: CapturePodInput) =>
  api.post<Delivery>(`${BASE}/${id}/pod`, data).then((r) => r.data);

export const cancelDelivery = (id: string, data: CancelDeliveryInput) =>
  api.post<Delivery>(`${BASE}/${id}/cancel`, data).then((r) => r.data);
