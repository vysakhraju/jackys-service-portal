// Shapes mirror src/invoicing/entities/invoice.entity.ts, entities/payment.entity.ts, and
// dto/record-payment.dto.ts exactly. Deliberately distinct from Appointment.invoiceNumber
// (the customer's ORIGINAL PURCHASE invoice/receipt number, used for S/N-vs-invoice
// warranty verification) - this Invoice is the bill the business issues for an
// out-of-warranty repair. No Invoice is ever created for IW jobs (nothing to collect).
import type { UserRef, CustomerTypeValue } from './appointmentsTypes';

export const INVOICE_STATUSES = ['DRAFT', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'] as const;
export type InvoiceStatusValue = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'B2B_CREDIT'] as const;
export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number];

export interface Invoice {
  id: string;
  invoiceNumber: string;
  jobCardId: string;
  amount: number;
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  dueDate: string | null;
  status: InvoiceStatusValue;
  // "Latest payment" convenience snapshot only, not the source of truth - see
  // GET /invoicing/:id/payments for the real append-only payment history.
  paymentMethod: PaymentMethodValue | null;
  amountReceived: number | null;
  paymentReference: string | null;
  paidAt: string | null;
  recordedByUser?: UserRef | null;
  recordedByUserId: string | null;
  // Phase 4/11 - which path priced this invoice: an approved Estimate (REPAIR), a Price
  // List baseline fallback (REPAIR with no Estimate), or per-line-item activity pricing
  // (COMPLETED ERP-sourced Installation/Delivery Installation jobs). sourceEstimateId is
  // only ever set for ESTIMATE. billingChannelId/Name are only ever set for
  // PRICE_LIST_BASELINE (B2B_SALES_CHANNEL) or, per line, inside lineItemsBreakdown for
  // ACTIVITY_LINE_ITEMS. lineItemsBreakdown is only ever set for ACTIVITY_LINE_ITEMS -
  // see invoice.entity.ts's own doc comment for why this stays a loose jsonb shape.
  priceSource?: 'ESTIMATE' | 'PRICE_LIST_BASELINE' | 'ACTIVITY_LINE_ITEMS';
  sourceEstimateId?: string | null;
  billingChannelId?: string | null;
  billingChannelName?: string | null;
  lineItemsBreakdown?:
    | {
        applianceModelId: string;
        brand: string;
        model: string;
        category: string;
        jobType: string;
        quantity: number;
        unitPrice: number;
        lineTotal: number;
        billingChannelId: string | null;
        billingChannelName: string | null;
      }[]
    | null;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  method: PaymentMethodValue;
  amount: number;
  reference: string | null;
  recordedByUser?: UserRef;
  recordedByUserId: string;
  recordedAt: string;
}

// Matches RecordPaymentDto exactly.
export interface RecordPaymentInput {
  method: PaymentMethodValue;
  amountReceived: number;
  reference?: string;
}

// Optional filters for GET /invoicing (Frontend Phase 9's new list endpoint - see
// invoicing.controller.ts/invoicing.service.ts's findAll()). customerType lives on the
// Job Card's Appointment, not on Invoice itself - the backend joins it in.
export interface InvoiceListFilters {
  status?: InvoiceStatusValue;
  customerType?: CustomerTypeValue;
}

// Matches InvoicingService.getB2bAgingReport()'s return shape exactly (AC-16).
export const AGING_BUCKET_LABELS = ['0-30 days', '31-60 days', '61-90 days', '90+ days'] as const;

export interface AgingBucket {
  label: (typeof AGING_BUCKET_LABELS)[number];
  invoices: Invoice[];
  totalOutstanding: number;
}

export interface AgingReport {
  buckets: AgingBucket[];
  totalOutstanding: number;
}

// Matches InvoicingService.regenerateDraftInvoice()'s return shape (2026-09-25, the JER-C
// AED 0.00 dead-end fix) - only ever succeeds for a never-paid DRAFT, and returns a fresh
// Invoice under a NEW invoiceNumber/id, not an in-place edit.
export interface RegenerateInvoiceResult {
  invoice: Invoice;
  oldInvoiceNumber: string;
  oldAmount: number;
}
