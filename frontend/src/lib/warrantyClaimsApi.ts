// Thin wrappers over the real backend endpoints in
// src/warranty-claims/warranty-claims.controller.ts - one function per route actually
// exposed, same house style as every other lib/*Api.ts file in this app.
import { api } from './api';
import type {
  AggregateWarrantyClaimInput,
  RecordCreditNoteInput,
  RecoveryRate,
  SubmitWarrantyClaimInput,
  WarrantyClaim,
  WarrantyClaimStatusValue,
} from './warrantyClaimsTypes';

const BASE = '/warranty-claims';

export const aggregateWarrantyClaim = (data: AggregateWarrantyClaimInput) =>
  api.post<WarrantyClaim>(`${BASE}/aggregate`, data).then((r) => r.data);

export const listWarrantyClaims = (filters: { supplier?: string; status?: WarrantyClaimStatusValue } = {}) =>
  api.get<WarrantyClaim[]>(BASE, { params: filters }).then((r) => r.data);

export const getWarrantyClaim = (id: string) => api.get<WarrantyClaim>(`${BASE}/${id}`).then((r) => r.data);

export const submitWarrantyClaim = (id: string, data: SubmitWarrantyClaimInput) =>
  api.post<WarrantyClaim>(`${BASE}/${id}/submit`, data).then((r) => r.data);

export const cancelWarrantyClaim = (id: string, reason: string) =>
  api.post<WarrantyClaim>(`${BASE}/${id}/cancel`, { reason }).then((r) => r.data);

export const recordWarrantyClaimCreditNote = (id: string, data: RecordCreditNoteInput) =>
  api.post<WarrantyClaim>(`${BASE}/${id}/credit-note`, data).then((r) => r.data);

export const getWarrantyClaimRecoveryRate = (supplier?: string) =>
  api.get<RecoveryRate>(`${BASE}/recovery-rate`, { params: supplier ? { supplier } : {} }).then((r) => r.data);
