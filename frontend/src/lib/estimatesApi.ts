// Thin wrappers over src/estimates/estimates.controller.ts - one function per route that
// actually exists. The public (no-JWT) endpoints deliberately use the bare `publicApi`
// client, never the interceptor-laden `api` client - see lib/publicApi.ts for why.
import { api } from './api';
import { publicApi } from './publicApi';
import type {
  CreateEstimateInput,
  Estimate,
  PublicEstimateView,
  RecordResponseInput,
  RespondEstimateInput,
  ReviseEstimateInput,
} from './estimatesTypes';

const BASE = '/estimates';

export const createEstimate = (data: CreateEstimateInput) => api.post<Estimate>(BASE, data).then((r) => r.data);

export const sendEstimate = (id: string) => api.post<Estimate>(`${BASE}/${id}/send`).then((r) => r.data);

export const recordResponse = (id: string, data: RecordResponseInput) =>
  api.post<Estimate>(`${BASE}/${id}/record-response`, data).then((r) => r.data);

export const reviseEstimate = (id: string, data: ReviseEstimateInput) =>
  api.post<Estimate>(`${BASE}/${id}/revise`, data).then((r) => r.data);

export const getEstimate = (id: string) => api.get<Estimate>(`${BASE}/${id}`).then((r) => r.data);

export const getEstimatesByJobCard = (jobCardId: string) =>
  api.get<Estimate[]>(`${BASE}/by-job-card/${jobCardId}`).then((r) => r.data);

// --- Public, unauthenticated (customer-facing link) ---

export const getPublicEstimate = (token: string) =>
  publicApi.get<PublicEstimateView>(`${BASE}/public/${token}`).then((r) => r.data);

export const respondToPublicEstimate = (token: string, data: RespondEstimateInput) =>
  publicApi.post<Estimate>(`${BASE}/public/${token}/respond`, data).then((r) => r.data);
