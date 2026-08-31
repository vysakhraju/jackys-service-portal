// Thin wrappers over src/customer-portal/customer-portal.controller.ts. Uses publicApi
// (no auth header, no 401-redirect - see lib/publicApi.ts's doc comment), exactly like
// estimatesApi's getPublicEstimate/respondToPublicEstimate - never the staff `api` client.
import { publicApi } from './publicApi';
import type { PortalInvoiceView, PortalSummaryView, PortalTrackView } from './customerPortalTypes';

const BASE = '/customer-portal/public';

export const trackJob = (token: string) => publicApi.get<PortalTrackView>(`${BASE}/track/${token}`).then((r) => r.data);

export const getPortalInvoice = (token: string) =>
  publicApi.get<PortalInvoiceView>(`${BASE}/invoice/${token}`).then((r) => r.data);

export const getPortalSummary = (token: string) =>
  publicApi.get<PortalSummaryView>(`${BASE}/job-card/${token}/summary`).then((r) => r.data);
