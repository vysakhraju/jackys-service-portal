// Types mirror src/estimates/entities/estimate.entity.ts and the DTOs in src/estimates/dto/*
// exactly - status/enum values are the backend's own strings, not re-worded.
import type { UserRef } from './appointmentsTypes';

export const ESTIMATE_STATUSES = ['DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED'] as const;
export type EstimateStatusValue = (typeof ESTIMATE_STATUSES)[number];

export const RESPONDED_VIA = ['CUSTOMER_LINK', 'STAFF_RECORDED'] as const;
export type RespondedViaValue = (typeof RESPONDED_VIA)[number];

export const CONTACT_METHODS = ['PHONE_CALL', 'WHATSAPP', 'EMAIL_REPLY', 'IN_PERSON'] as const;
export type ContactMethodValue = (typeof CONTACT_METHODS)[number];

export interface EstimateLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface Estimate {
  id: string;
  jobCardId: string;
  lineItems: EstimateLineItem[];
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
  status: EstimateStatusValue;
  accessToken: string | null;
  tokenExpiresAt: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  respondedVia: RespondedViaValue | null;
  recordedByUser?: UserRef | null;
  recordedByUserId: string | null;
  contactMethod: ContactMethodValue | null;
  contactValue: string | null;
  responseNotes: string | null;
  channelsAttempted: string[];
  channelsDelivered: string[];
  previousEstimateId: string | null;
  createdBy?: UserRef | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

// Customer-safe subset returned by GET /estimates/public/:token - deliberately not the
// full Estimate (no createdById, recordedByUserId, contactValue, etc).
export interface PublicEstimateView {
  jobCardNumber: string;
  brand: string | null;
  lineItems: EstimateLineItem[];
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
  tokenExpiresAt: string | null;
}

export interface CreateEstimateInput {
  jobCardId: string;
  lineItems: EstimateLineItem[];
}

export interface ReviseEstimateInput {
  lineItems?: EstimateLineItem[];
}

export interface RespondEstimateInput {
  approved: boolean;
  notes?: string;
}

export interface RecordResponseInput {
  approved: boolean;
  contactMethod: ContactMethodValue;
  contactValue: string;
  notes: string;
}
