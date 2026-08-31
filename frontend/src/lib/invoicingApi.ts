// Thin wrappers over src/invoicing/invoicing.controller.ts. Phase 8 kept this deliberately
// small - just enough to unblock Delivery's OOW-payment gate (view/lazily-create an invoice
// for a job card, view its payment history, record a payment). Phase 9 ("Finance extension")
// adds the two read primitives Phase 8 explicitly deferred: a general browse/audit list
// (listInvoices - backed by a small new GET /invoicing list endpoint added this phase, since
// none of the existing routes gave Finance a full system-of-record view) and the AC-16 B2B
// aging report (getB2bAging).
import { api } from './api';
import type { AgingReport, Invoice, InvoiceListFilters, Payment, RecordPaymentInput } from './invoicingTypes';

const BASE = '/invoicing';

export const listInvoices = (filters?: InvoiceListFilters) =>
  api.get<Invoice[]>(BASE, { params: filters }).then((r) => r.data);

export const getB2bAging = () => api.get<AgingReport>(`${BASE}/b2b-aging`).then((r) => r.data);

// Lazily creates a DRAFT invoice the first time it's queried for a QC_PASSED/DELIVERED +
// OOW job card with an approved Estimate - a real side effect of this GET, which is why
// nothing calls it just to render a list (see ReadyForDeliveryPage's on-demand, not eager,
// use of this).
export const getInvoiceByJobCard = (jobCardId: string) =>
  api.get<Invoice>(`${BASE}/job-card/${jobCardId}`).then((r) => r.data);

export const getInvoice = (id: string) => api.get<Invoice>(`${BASE}/${id}`).then((r) => r.data);

export const getPayments = (id: string) => api.get<Payment[]>(`${BASE}/${id}/payments`).then((r) => r.data);

export const recordPayment = (id: string, data: RecordPaymentInput) =>
  api.post<Invoice>(`${BASE}/${id}/record-payment`, data).then((r) => r.data);
