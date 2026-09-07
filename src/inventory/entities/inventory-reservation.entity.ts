import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { SparePart } from '../../master-data/entities/spare-part.entity';
import { JobCard } from '../../job-cards/entities/job-card.entity';
import { User } from '../../auth/entities/user.entity';

export enum ReservationStatus {
  // Mobile Phase 5 (Need Spare): a field technician has asked for a part while on-site,
  // but a TL hasn't reviewed it yet - deliberately NO stock movement at this point
  // (quantityOnHand/quantityReserved both untouched). Distinct from HELD/PARTIALLY_RESERVED
  // (which always mean stock WAS moved) - see InventoryService.requestNeedSpare()/
  // reviewNeedSpareRequest().
  PENDING_REVIEW = 'PENDING_REVIEW',
  // Fully reserved - the full requested quantity was available and set aside.
  HELD = 'HELD',
  // Stock was short at request time - quantityReserved < quantityRequested.
  PARTIALLY_RESERVED = 'PARTIALLY_RESERVED',
  // Set aside for return (TL-approved reallocation, technician's own return request, or
  // Job Card cancellation) but NOT yet physically handed back - quantityOnHand has not
  // moved yet. Only confirmReturn() (Inventory Clerk) can close this out.
  RETURN_PENDING = 'RETURN_PENDING',
  // Physically confirmed back in Main Store. Terminal.
  RETURNED = 'RETURNED',
  // Phase 6 (FR-10): permanently consumed on QC approval - moved Main Store -> Damage
  // Location and will never come back. Terminal, distinct from RETURNED (which is stock
  // going back INTO Main Store, not out of it). Set only by
  // InventoryService.consumeReservationsOnQcApproval().
  CONSUMED = 'CONSUMED',
  // Mobile Phase 5: a Need Spare request a TL rejected (reviewNeedSpareRequest), OR a
  // still-PENDING_REVIEW request released via releaseReservation() (e.g. to unblock a
  // technician reassignment) before a TL ever reviewed it. Both cases never moved any
  // stock, so this is terminal with nothing to physically return - distinct from
  // RETURN_PENDING, which always implies stock IS still out there somewhere.
  REJECTED = 'REJECTED',
}

export enum ReviewDecision {
  APPROVE_REALLOCATION = 'APPROVE_REALLOCATION',
  REJECT = 'REJECT',
}

// Mobile Phase 5: a TL's decision on a technician's Need Spare request. Kept separate
// from ReviewDecision above rather than reusing APPROVE_REALLOCATION/REJECT - that enum is
// about what happens to an already-reserved, idle reservation (reallocate it back to Main
// Store), which is a different real-world action from approving a brand-new request that
// hasn't touched stock yet at all.
export enum NeedSpareReviewDecision {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

@Entity('inventory_reservations')
@Index(['jobCardId'])
@Index(['sparePartId'])
@Index(['custodianUserId'])
// Mobile Phase 5 idempotency: a mobile client generates a fresh idempotencyKey every time
// the user taps "Need Spare" (never derived from jobCardId+sparePartId), so this unique
// index only ever catches a true network-retry of the SAME tap (offline queue resending an
// unsynced item) - a second, intentional request for the same part creates a second,
// separate row. Nullable + unique is fine in Postgres: NULLs never conflict with each
// other, so every pre-Phase-5 reservation (idempotencyKey always null) is unaffected.
@Index(['jobCardId', 'idempotencyKey'], { unique: true })
export class InventoryReservation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => SparePart)
  @JoinColumn({ name: 'sparePartId' })
  sparePart: SparePart;

  @Column({ type: 'uuid' })
  sparePartId: string;

  @ManyToOne(() => JobCard)
  @JoinColumn({ name: 'jobCardId' })
  jobCard: JobCard;

  @Column({ type: 'uuid' })
  jobCardId: string;

  // The technician physically holding the reserved part once it leaves Main Store.
  // Deliberately just a direct FK on the reservation rather than a separate
  // per-technician "location" entity - the number of technicians (and therefore
  // sub-inventories) changes as technicians are added/deactivated, so custody is modeled
  // as a property of the reservation, computed from whoever holds it, not a fixed roster
  // of location rows to keep in sync.
  @ManyToOne(() => User)
  @JoinColumn({ name: 'custodianUserId' })
  custodian: User;

  @Column({ type: 'uuid' })
  custodianUserId: string;

  @Column({ type: 'int' })
  quantityRequested: number;

  // May be less than quantityRequested if stock was short at request time.
  @Column({ type: 'int' })
  quantityReserved: number;

  @Column({ type: 'enum', enum: ReservationStatus, default: ReservationStatus.HELD })
  status: ReservationStatus;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'requestedByUserId' })
  requestedBy: User;

  @Column({ type: 'uuid' })
  requestedByUserId: string;

  @CreateDateColumn()
  requestedAt: Date;

  // Set whenever a TL makes a review decision (approve-reallocation or reject). A reject
  // does NOT change status - it resets this timestamp so the staleness clock restarts.
  // This is a snooze, not a permanent exemption: getStaleReservations() re-flags this
  // reservation again once another 24h passes from lastReviewedAt, exactly like it would
  // from requestedAt if it had never been reviewed at all.
  @Column({ type: 'timestamp', nullable: true })
  lastReviewedAt: Date | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'reviewedByUserId' })
  reviewedBy: User | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedByUserId: string | null;

  @Column({ type: 'enum', enum: ReviewDecision, nullable: true })
  reviewDecision: ReviewDecision | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'int', nullable: true })
  quantityReturned: number | null;

  @Column({ type: 'uuid', nullable: true })
  returnConfirmedByUserId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  returnConfirmedAt: Date | null;

  // Phase 6 (FR-10): set when this reservation is permanently consumed on QC approval.
  @Column({ type: 'timestamp', nullable: true })
  consumedAt: Date | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'consumedByUserId' })
  consumedBy: User | null;

  @Column({ type: 'uuid', nullable: true })
  consumedByUserId: string | null;

  // Phase 6 rework gate: if this reservation was created because the SAME spare part was
  // already consumed/reserved once before on this same Job Card (a rework re-request),
  // one of the two pairs below must be populated - either a real supervisor/TL sign-off
  // (reworkApprovedByUserId, checked against PermissionType.REWORK_APPROVAL) or a verbal
  // override fallback (reworkVerbalOverrideBy + notes) when no one with that grant is
  // reachable. Both null means this reservation was NOT a rework re-request (first time
  // this part was requested on this job, or a same-part top-up before any QC rejection -
  // see WorkshopService.requestSpare()). Latest-only on the reservation row; the full
  // history of every request is still in the audit log via @Audit().
  @Column({ type: 'uuid', nullable: true })
  reworkApprovedByUserId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'reworkApprovedByUserId' })
  reworkApprovedBy: User | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reworkVerbalOverrideBy: string | null;

  @Column({ type: 'text', nullable: true })
  reworkVerbalOverrideNotes: string | null;

  // --- Mobile Phase 5: Need Spare ---------------------------------------------------
  // Client-generated once per user-initiated "Need Spare" tap (see the unique index
  // above). Null for every reservation created through the pre-existing WorkshopService
  // reserve() path - idempotency only matters for a mobile client that might retry a
  // request it can't confirm went through (offline queue, dropped connection).
  @Column({ type: 'varchar', length: 128, nullable: true })
  idempotencyKey: string | null;

  // Set only by InventoryService.reviewNeedSpareRequest() - kept separate from
  // reviewDecision (see NeedSpareReviewDecision's doc comment) even though
  // reviewedByUserId/lastReviewedAt/notes are shared with the older review() flow above.
  @Column({ type: 'enum', enum: NeedSpareReviewDecision, nullable: true })
  needSpareDecision: NeedSpareReviewDecision | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
