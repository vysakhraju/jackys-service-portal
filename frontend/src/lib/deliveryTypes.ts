// Shapes mirror src/delivery/entities/delivery.entity.ts and src/delivery/dto/*.ts exactly.
// Cardinality: one Delivery has many JobCards via a plain `deliveryId` FK column on JobCard
// (not a join table) - see JobCard.deliveryId in jobCardsTypes.ts. There is no
// "list job cards by delivery id" endpoint anywhere else in the app except this module's
// own GET /delivery/:id/job-cards (a small Frontend Phase 8 addition to
// DeliveryController - the only other primitive was job-card -> delivery, not this
// direction).
import type { JobCard } from './jobCardsTypes';

export const DELIVERY_STATUSES = ['PENDING', 'DISPATCHED', 'DELIVERED', 'CANCELLED'] as const;
export type DeliveryStatusValue = (typeof DELIVERY_STATUSES)[number];

export interface Delivery {
  id: string;
  deliveryNumber: string;
  status: DeliveryStatusValue;
  dispatcherUserId: string;
  driverUserId: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  // Present only on GET /delivery/:id (single) - GET /delivery (list) excludes these two
  // columns entirely (not even null - the keys are absent from the response), per the
  // entity's own doc comment about keeping list responses light.
  podSignatureBase64?: string | null;
  podPhotoBase64?: string | null;
  podRecipientName: string | null;
  podNotes: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

// The shape ConflictException({ message, blockers }) serializes to on POST /delivery or
// POST /delivery/:id/pod when one or more OOW member Job Cards aren't paid (FR-12/AC-11) -
// same "structured 409, not just error.message" pattern as Phase 6/7's QcApproveBlocker.
export interface DeliveryBlocker {
  jobCardId: string;
  jobCardNumber: string;
  invoiceId: string;
  invoiceStatus: string;
  amount: number;
}

// GET /delivery/ready's per-row shape - a JobCard plus proactive OOW payment visibility.
// invoiceStatus/payable are always null/true for IW jobs (nothing to collect).
export interface ReadyForDeliveryRow {
  jobCard: JobCard;
  invoiceStatus: string | null;
  payable: boolean;
}

// Matches CreateDeliveryDto exactly.
export interface CreateDeliveryInput {
  jobCardIds: string[];
}

// POST /delivery's success response shape (DeliveryService.create()'s return type).
export interface CreateDeliveryResult {
  delivery: Delivery;
  jobCards: JobCard[];
}

// Matches DispatchDeliveryDto exactly.
export interface DispatchDeliveryInput {
  driverUserId?: string;
}

// Matches CapturePodDto exactly - at-least-one-of signature/photo is enforced by the
// service, not this shape (AC-12).
export interface CapturePodInput {
  signatureBase64?: string;
  photoBase64?: string;
  recipientName: string;
  notes?: string;
}

// Matches CancelDeliveryDto exactly.
export interface CancelDeliveryInput {
  reason: string;
}
