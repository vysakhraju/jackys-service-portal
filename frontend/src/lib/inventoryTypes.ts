// Shapes mirror src/inventory/entities/*.ts and src/inventory/dto/*.ts exactly - enum
// values are the backend's own strings, not re-worded.
import type { UserRef } from './appointmentsTypes';

export const INVENTORY_LOCATIONS = ['MAIN_STORE', 'DAMAGE_LOCATION'] as const;
export type InventoryLocationValue = (typeof INVENTORY_LOCATIONS)[number];

export const RESERVATION_STATUSES = [
  'HELD',
  'PARTIALLY_RESERVED',
  'RETURN_PENDING',
  'RETURNED',
  'CONSUMED',
] as const;
export type ReservationStatusValue = (typeof RESERVATION_STATUSES)[number];

export const REVIEW_DECISIONS = ['APPROVE_REALLOCATION', 'REJECT'] as const;
export type ReviewDecisionValue = (typeof REVIEW_DECISIONS)[number];

export interface InventoryStock {
  id: string;
  sparePartId: string;
  location: InventoryLocationValue;
  quantityOnHand: number;
  quantityReserved: number;
  lastUpdatedAt: string;
  createdAt: string;
}

// GET /inventory/stock/:sparePartId synthesizes this exact shape (no `id`) when no real
// row exists yet for that spare part/location - see InventoryController.getStock(). Kept
// as a separate type rather than making InventoryStock.id optional, so callers are forced
// to handle "never received via GRN yet" as a distinct case from "id present, zero on hand".
export interface StockLookupResult {
  id?: string;
  sparePartId: string;
  location: InventoryLocationValue;
  quantityOnHand: number;
  quantityReserved: number;
  lastUpdatedAt?: string;
  createdAt?: string;
}

export interface InventoryReservation {
  id: string;
  sparePartId: string;
  jobCardId: string;
  custodian?: UserRef;
  custodianUserId: string;
  quantityRequested: number;
  quantityReserved: number;
  status: ReservationStatusValue;
  requestedBy?: UserRef;
  requestedByUserId: string;
  requestedAt: string;
  lastReviewedAt: string | null;
  reviewedBy?: UserRef | null;
  reviewedByUserId: string | null;
  reviewDecision: ReviewDecisionValue | null;
  notes: string | null;
  quantityReturned: number | null;
  returnConfirmedByUserId: string | null;
  returnConfirmedAt: string | null;
  consumedAt: string | null;
  consumedBy?: UserRef | null;
  consumedByUserId: string | null;
  reworkApprovedByUserId: string | null;
  reworkApprovedBy?: UserRef | null;
  reworkVerbalOverrideBy: string | null;
  reworkVerbalOverrideNotes: string | null;
  updatedAt: string;
}

// GET /inventory/reservations/stale (and WorkshopState.staleReservations) adds these two
// computed fields on top of the raw entity - see InventoryService.getStaleReservations().
export interface InventoryReservationWithAge extends InventoryReservation {
  ageHours: number;
  custodianActive: boolean;
}

export interface GrnInput {
  sparePartId: string;
  quantity: number;
  notes?: string;
}

export interface ReviewReservationInput {
  decision: ReviewDecisionValue;
  notes?: string;
}

export interface ConfirmReturnInput {
  quantityReturned: number;
}
