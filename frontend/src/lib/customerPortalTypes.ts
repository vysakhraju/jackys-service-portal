// Shapes mirror src/customer-portal/customer-portal.service.ts's three return payloads
// exactly (that service returns Record<string, unknown> on the backend - these interfaces
// pin down what it actually puts in there, read from source, not guessed). All three take
// the same JobCard.publicToken (minted at Job Card creation, 180-day expiry) - a customer
// gets ONE tracking link and can see everything through it; there's no separate token per
// view, unlike Estimate's accessToken.
import type { InvoiceStatusValue } from './invoicingTypes';
import type { EstimateLineItem } from './estimatesTypes';

export interface PortalDeliverySummary {
  deliveryNumber: string;
  status: 'PENDING' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
  dispatchedAt: string | null;
  deliveredAt: string | null;
}

// getSummaryByToken's delivery field omits dispatchedAt - a narrower view than track's.
export type PortalDeliveryBrief = Pick<PortalDeliverySummary, 'deliveryNumber' | 'status' | 'deliveredAt'>;

export interface PortalTrackView {
  jobCardNumber: string;
  brand: string | null;
  status: string;
  warrantyStatus: 'IW' | 'OOW';
  customerApproved: boolean;
  qcApprovedAt: string | null;
  delivery: PortalDeliverySummary | null;
  createdAt: string;
}

// A discriminated union on applicable/invoiceCreated - see CustomerPortalService's
// getInvoiceByToken for the exact three shapes this can take.
export type PortalInvoiceView =
  | { applicable: false; message: string }
  | { applicable: true; invoiceCreated: false; message: string }
  | {
      applicable: true;
      invoiceCreated: true;
      invoiceNumber: string;
      subtotal: number;
      vatRate: number;
      vatAmount: number;
      totalAmount: number;
      amountPaid: number;
      amountDue: number;
      status: InvoiceStatusValue;
      message: string;
    };

export interface PortalEstimateView {
  lineItems: EstimateLineItem[];
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
  status: string;
}

export interface PortalSummaryView {
  jobCardNumber: string;
  brand: string | null;
  faultCode: string;
  symptomCode: string;
  status: string;
  warrantyStatus: 'IW' | 'OOW';
  createdAt: string;
  estimate: PortalEstimateView | null;
  invoice: PortalInvoiceView;
  delivery: PortalDeliveryBrief | null;
}
