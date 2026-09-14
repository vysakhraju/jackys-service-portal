// Shapes mirror src/workshop/dto/*.ts exactly - status/enum values are the backend's own
// strings, not re-worded. WorkshopState is the exact shape WorkshopService.getWorkshopState()
// returns: { jobCard, staleReservations, activeReservations }.
//
// staleReservations is filtered to this job only, and used to ONLY ever be a fresh
// reservation's one and only visible representation on this screen - a documented gap (the-
// fool pre-mortem finding #2, STATUS_TRACKER.md's Frontend Phase 6 section) that live use
// proved wrong 2026-09-14: a technician who requested a spare, switched tabs, and came back
// saw nothing, because staleReservations only ever shows something once it's idle 24h+.
// activeReservations closes that gap - every reservation on this job that hasn't reached a
// terminal state yet (HELD/PARTIALLY_RESERVED/RETURN_PENDING/PENDING_REVIEW), always
// current, surviving a remount/refresh/tab-switch. staleReservations stays a separate field
// (a different, TL-facing triage concern - which of these have gone idle too long) rather
// than being folded into activeReservations.
import type { JobCard } from './jobCardsTypes';
import type { InventoryReservation, InventoryReservationWithAge } from './inventoryTypes';

export interface WorkshopState {
  jobCard: JobCard;
  staleReservations: InventoryReservationWithAge[];
  activeReservations: InventoryReservation[];
}

export interface AssignWorkshopInput {
  technicianId: string;
}

export interface RequestSpareInput {
  sparePartId: string;
  quantity: number;
  // Rework re-request only (see request-spare.dto.ts) - required together only when the
  // backend actually needs them (same part requested before on this job AND a prior QC
  // rejection exists). Ignored otherwise.
  approverId?: string;
  verbalOverrideBy?: string;
  verbalOverrideNotes?: string;
}

// Mirrors JobCardCrewHelper - the Gantt board's "add crew helper" action, 2026-09-09.
export interface JobCardCrewHelper {
  id: string;
  jobCardId: string;
  technicianId: string;
  technician?: { id: string; firstName: string; lastName: string };
  addedByUserId: string;
  addedAt: string;
  removedByUserId: string | null;
  removedAt: string | null;
}

export interface AddCrewHelperInput {
  technicianId: string;
}
