// Shapes mirror src/workshop/dto/*.ts exactly - status/enum values are the backend's own
// strings, not re-worded. WorkshopState is the exact shape WorkshopService.getWorkshopState()
// returns: { jobCard, staleReservations } - staleReservations is filtered to this job only,
// and is NOT a full "all active reservations" list (see the-fool pre-mortem finding #2 -
// STATUS_TRACKER.md's Frontend Phase 6 section). It reuses InventoryReservation shape plus
// the two computed fields getStaleReservations() adds.
import type { JobCard } from './jobCardsTypes';
import type { InventoryReservationWithAge } from './inventoryTypes';

export interface WorkshopState {
  jobCard: JobCard;
  staleReservations: InventoryReservationWithAge[];
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
