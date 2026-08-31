// Shapes mirror src/amc/entities/*.ts and src/amc/dto/*.ts exactly (Frontend Phase 10,
// post-MVP BRD Workflow 13). This is the biggest single-module surface built so far - 3
// entities, 16 endpoints - and the most fragmented role set of any phase: 4 different,
// overlapping-but-not-identical arrays gate different parts of the same screen (see
// AMC_MANAGEMENT_ROLES/AMC_VIEW_ROLES/AMC_TECHNICIAN_ROLES/AMC_FINANCE_ROLES below, copied
// verbatim from amc.controller.ts). the-fool pre-mortem finding #2: rather than repeat
// `SOME_ARRAY.includes(user.role.name)` inline at every call site (an easy place to
// copy-paste the wrong array under deadline pressure), amcPermissions() below computes all
// four checks once from a single source of truth.
import type { CustomerTypeValue, UserRef } from './appointmentsTypes';
import type { PaymentMethodValue } from './invoicingTypes';

export const AMC_CONTRACT_STATUSES = ['ACTIVE', 'EXPIRED', 'CANCELLED', 'RENEWED'] as const;
export type AmcContractStatusValue = (typeof AMC_CONTRACT_STATUSES)[number];

export const COVERAGE_TYPES = ['COMPREHENSIVE', 'LABOR_ONLY'] as const;
export type CoverageTypeValue = (typeof COVERAGE_TYPES)[number];

export const VISIT_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY'] as const;
export type VisitFrequencyValue = (typeof VISIT_FREQUENCIES)[number];

export const AMC_PAYMENT_TERMS = ['FULL_UPFRONT', 'HALF_YEARLY', 'QUARTERLY'] as const;
export type AmcPaymentTermsValue = (typeof AMC_PAYMENT_TERMS)[number];

export const AMC_BILLING_STATUSES = ['DRAFT', 'PAID', 'CANCELLED'] as const;
export type AmcBillingStatusValue = (typeof AMC_BILLING_STATUSES)[number];

// Copied verbatim from amc.controller.ts's own const declarations - keep these two files
// in sync if the backend's role sets ever change.
export const AMC_MANAGEMENT_ROLES = ['SERVICE_HEAD', 'SUPER_ADMIN', 'CCE'];
export const AMC_VIEW_ROLES = ['SERVICE_HEAD', 'SUPER_ADMIN', 'CCE', 'TECHNICIAN_FIELD', 'TECHNICIAN_WORKSHOP', 'ACCOUNTANT', 'FINANCE_MANAGER'];
export const AMC_TECHNICIAN_ROLES = ['TECHNICIAN_FIELD', 'TECHNICIAN_WORKSHOP', 'SERVICE_HEAD', 'SUPER_ADMIN'];
export const AMC_FINANCE_ROLES = ['ACCOUNTANT', 'FINANCE_MANAGER', 'SUPER_ADMIN', 'SERVICE_HEAD'];

export interface AmcPermissions {
  canView: boolean;
  canManage: boolean;
  canCompleteVisits: boolean;
  canBill: boolean;
}

// Single source of truth for every AMC role check in the frontend - every page/component
// below calls this once instead of inlining `.includes()` against one of the four arrays.
export function amcPermissions(roleName: string | undefined): AmcPermissions {
  return {
    canView: !!roleName && AMC_VIEW_ROLES.includes(roleName),
    canManage: !!roleName && AMC_MANAGEMENT_ROLES.includes(roleName),
    canCompleteVisits: !!roleName && AMC_TECHNICIAN_ROLES.includes(roleName),
    canBill: !!roleName && AMC_FINANCE_ROLES.includes(roleName),
  };
}

export interface ServiceCentreRef {
  id: string;
  code: string;
  name: string;
}

export interface AmcContract {
  id: string;
  contractNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  customerAddress: string | null;
  customerType: CustomerTypeValue;
  serviceCentre?: ServiceCentreRef;
  serviceCentreId: string;
  coveredSerialNumbers: string[];
  brand: string | null;
  modelNumber: string | null;
  coverageType: CoverageTypeValue;
  serviceLevel: string | null;
  visitFrequency: VisitFrequencyValue;
  startDate: string;
  endDate: string;
  totalAmount: number;
  paymentTerms: AmcPaymentTermsValue;
  assignedTechnician?: UserRef | null;
  assignedTechnicianId: string | null;
  status: AmcContractStatusValue;
  cancellationReason: string | null;
  renewalReminderSentAt: string | null;
  renewalReminderChannelsAttempted: string[];
  renewalReminderChannelsDelivered: string[];
  previousContractId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

// Matches CreateAmcContractDto exactly.
export interface CreateAmcContractInput {
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerAddress?: string;
  customerType: CustomerTypeValue;
  serviceCentreId: string;
  coveredSerialNumbers: string[];
  brand?: string;
  modelNumber?: string;
  coverageType: CoverageTypeValue;
  serviceLevel?: string;
  visitFrequency: VisitFrequencyValue;
  startDate: string;
  endDate: string;
  totalAmount: number;
  paymentTerms: AmcPaymentTermsValue;
  assignedTechnicianId?: string;
}

// Matches RenewAmcContractDto exactly.
export interface RenewAmcContractInput {
  startDate: string;
  endDate: string;
  totalAmount: number;
  visitFrequency?: VisitFrequencyValue;
  paymentTerms?: AmcPaymentTermsValue;
  coveredSerialNumbers?: string[];
}

export interface AmcVisitCompletion {
  id: string;
  amcContractId: string;
  appointmentId: string;
  visitNumber: number;
  checklistNotes: string | null;
  customerSignatureBase64: string | null;
  extraChargeDescription: string | null;
  extraChargeAmount: number | null;
  extraChargeApprovedByCustomer: boolean;
  completedByUserId: string;
  completedAt: string;
}

// Matches CompleteAmcVisitDto exactly.
export interface CompleteAmcVisitInput {
  checklistNotes?: string;
  customerSignatureBase64?: string;
  extraChargeDescription?: string;
  extraChargeAmount?: number;
  extraChargeApprovedByCustomer?: boolean;
}

export interface AmcBillingInvoice {
  id: string;
  invoiceNumber: string;
  amcContractId: string;
  periodLabel: string;
  amount: number;
  status: AmcBillingStatusValue;
  paymentMethod: PaymentMethodValue | null;
  paymentReference: string | null;
  paidAt: string | null;
  recordedByUser?: UserRef | null;
  recordedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsellCandidate {
  jobCardId: string;
  jobCardNumber: string;
  customerName: string;
  customerPhone: string;
  estimateAmount: number;
}

// A visit-generated Appointment row, as returned by GET /amc/contracts/:id/schedule - the
// same Appointment shape used elsewhere, but we only need these fields for the schedule list.
export interface AmcScheduleVisit {
  id: string;
  appointmentNumber: string;
  status: string;
  scheduledAt: string;
  amcContractId: string | null;
}

// the-fool pre-mortem finding #5: mirrors AmcService's own buildVisitDates()/
// intervalMonthsFor() math exactly (src/amc/amc.service.ts) so the Create/Renew forms can
// show "N PM visits will be generated" - and disable submit once it would exceed the
// backend's own 60-visit safety cap - BEFORE a long multi-field form gets submitted and
// rejected. This is the one place in the app that duplicates backend arithmetic on the
// frontend; everywhere else defers entirely to the backend's own validation, but a
// date-range x frequency interaction is cheap and safe to mirror, unlike re-implementing a
// real business rule.
export const MAX_GENERATED_VISITS = 60;

function intervalMonthsFor(frequency: VisitFrequencyValue): number {
  switch (frequency) {
    case 'MONTHLY':
      return 1;
    case 'HALF_YEARLY':
      return 6;
    case 'QUARTERLY':
    default:
      return 3;
  }
}

export function estimateVisitCount(startDate: string, endDate: string, frequency: VisitFrequencyValue): number | null {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;

  const months = intervalMonthsFor(frequency);
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    count += 1;
    cursor.setMonth(cursor.getMonth() + months);
    if (count > 10000) break; // safety valve against a runaway loop on a malformed date
  }
  return count;
}
