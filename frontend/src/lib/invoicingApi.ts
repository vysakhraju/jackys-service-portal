// Thin wrappers over src/invoicing/invoicing.controller.ts. Kept deliberately small for
// Frontend Phase 8 - just enough to unblock Delivery's OOW-payment gate (view/lazily-create
// an invoice for a job card, view its payment history, record a payment). The B2B aging
// report (GET /invoicing/b2b-aging) and a standalone invoice-browsing screen are scoped to
// Frontend Phase 9 ("Finance extension") - see the-fool pre-mortem for this phase.
import { api } from './api';
import type { Invoice, Payment, RecordPaymentInput } from './invoicingTypes';

const BASE = '/invoicing';

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
