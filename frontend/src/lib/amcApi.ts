// Thin wrappers over the real backend endpoints in src/amc/amc.controller.ts - one function
// per route actually exposed, same house style as every other lib/*Api.ts file in this app.
import { api } from './api';
import type {
  AmcBillingInvoice,
  AmcContract,
  AmcContractStatusValue,
  AmcScheduleVisit,
  AmcVisitCompletion,
  CompleteAmcVisitInput,
  CreateAmcContractInput,
  RenewAmcContractInput,
  UpsellCandidate,
} from './amcTypes';
import type { PaymentMethodValue } from './invoicingTypes';

const BASE = '/amc';

// === Contracts ===
export const createAmcContract = (data: CreateAmcContractInput) =>
  api.post<AmcContract>(`${BASE}/contracts`, data).then((r) => r.data);

export const listAmcContracts = (status?: AmcContractStatusValue) =>
  api.get<AmcContract[]>(`${BASE}/contracts`, { params: status ? { status } : {} }).then((r) => r.data);

export const getExpiringAmcContracts = (withinDays = 30) =>
  api.get<AmcContract[]>(`${BASE}/contracts/expiring`, { params: { withinDays } }).then((r) => r.data);

export const getAmcUpsellCandidates = () => api.get<UpsellCandidate[]>(`${BASE}/upsell-candidates`).then((r) => r.data);

export const getAmcContractByNumber = (contractNumber: string) =>
  api.get<AmcContract>(`${BASE}/contracts/number/${encodeURIComponent(contractNumber)}`).then((r) => r.data);

export const getAmcContract = (id: string) => api.get<AmcContract>(`${BASE}/contracts/${id}`).then((r) => r.data);

export const getAmcSchedule = (contractId: string) =>
  api.get<AmcScheduleVisit[]>(`${BASE}/contracts/${contractId}/schedule`).then((r) => r.data);

export const renewAmcContract = (id: string, data: RenewAmcContractInput) =>
  api.post<AmcContract>(`${BASE}/contracts/${id}/renew`, data).then((r) => r.data);

export const cancelAmcContract = (id: string, reason: string) =>
  api.post<AmcContract>(`${BASE}/contracts/${id}/cancel`, { reason }).then((r) => r.data);

export const sendAmcRenewalReminder = (id: string) =>
  api.post<{ attempted: string[]; delivered: string[] }>(`${BASE}/contracts/${id}/send-renewal-reminder`).then((r) => r.data);

// === PM visits ===
export const completeAmcVisit = (appointmentId: string, data: CompleteAmcVisitInput) =>
  api.post<AmcVisitCompletion>(`${BASE}/visits/${appointmentId}/complete`, data).then((r) => r.data);

export const getAmcVisitCompletion = (appointmentId: string) =>
  api.get<AmcVisitCompletion>(`${BASE}/visits/${appointmentId}/completion`).then((r) => r.data);

// === Billing ===
export const generateAmcBillingInvoice = (contractId: string, periodLabel: string) =>
  api.post<AmcBillingInvoice>(`${BASE}/contracts/${contractId}/billing-invoices`, { periodLabel }).then((r) => r.data);

export const getAmcBillingInvoicesForContract = (contractId: string) =>
  api.get<AmcBillingInvoice[]>(`${BASE}/contracts/${contractId}/billing-invoices`).then((r) => r.data);

export const getAmcBillingInvoice = (id: string) => api.get<AmcBillingInvoice>(`${BASE}/billing-invoices/${id}`).then((r) => r.data);

export const recordAmcBillingPayment = (id: string, method: PaymentMethodValue, reference?: string) =>
  api.post<AmcBillingInvoice>(`${BASE}/billing-invoices/${id}/record-payment`, { method, reference }).then((r) => r.data);
