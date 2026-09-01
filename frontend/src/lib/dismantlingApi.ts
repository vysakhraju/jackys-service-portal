// Thin wrappers over the real backend endpoints in src/dismantling/dismantling.controller.ts
// - one function per route actually exposed, same house style as every other lib/*Api.ts
// file in this app.
import { api } from './api';
import type {
  CreateDismantlingRecordInput,
  DismantlingRecord,
  DismantlingStatusValue,
  HarvestComponentsInput,
  PriceAndPostDismantlingInput,
} from './dismantlingTypes';

const BASE = '/dismantling';

export const createDismantlingRecord = (data: CreateDismantlingRecordInput) =>
  api.post<DismantlingRecord>(BASE, data).then((r) => r.data);

export const listDismantlingRecords = (status?: DismantlingStatusValue) =>
  api.get<DismantlingRecord[]>(BASE, { params: status ? { status } : {} }).then((r) => r.data);

export const listDismantlingRecordsBySerial = (applianceSerialNumber: string) =>
  api.get<DismantlingRecord[]>(`${BASE}/serial/${encodeURIComponent(applianceSerialNumber)}`).then((r) => r.data);

export const getDismantlingRecord = (id: string) => api.get<DismantlingRecord>(`${BASE}/${id}`).then((r) => r.data);

export const harvestDismantlingComponents = (id: string, data: HarvestComponentsInput) =>
  api.post<DismantlingRecord>(`${BASE}/${id}/harvest`, data).then((r) => r.data);

export const verifyDismantlingRecord = (id: string, notes?: string) =>
  api.post<DismantlingRecord>(`${BASE}/${id}/verify`, { notes }).then((r) => r.data);

export const priceAndPostDismantlingRecord = (id: string, data: PriceAndPostDismantlingInput) =>
  api.post<DismantlingRecord>(`${BASE}/${id}/price-and-post`, data).then((r) => r.data);

export const cancelDismantlingRecord = (id: string, reason: string) =>
  api.post<DismantlingRecord>(`${BASE}/${id}/cancel`, { reason }).then((r) => r.data);
