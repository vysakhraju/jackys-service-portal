import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Appointment } from '../../appointments/entities/appointment.entity';
import { User } from '../../auth/entities/user.entity';
import { WarrantyStatus } from '../../technician/entities/technician-visit.entity';
import { Delivery } from '../../delivery/entities/delivery.entity';

export enum JobCardStatus {
  OPEN = 'OPEN',
  SN_VALIDATED = 'SN_VALIDATED',
  SECTION_ASSIGNED = 'SECTION_ASSIGNED',
  // FR-08: set when a customer rejects an OOW Estimate. Not a dead end - blocks
  // validate-sn/assign-section/warranty-override until a revised Estimate is created
  // (Estimate.revise()), which moves the Job Card back to SN_VALIDATED.
  RWR = 'RWR',
  // Phase 5, section=WORKSHOP jobs only: a workshop technician has been assigned
  // (WorkshopService.assign), but hasn't started WIP yet.
  WORKSHOP_ASSIGNED = 'WORKSHOP_ASSIGNED',
  // WIP started (WorkshopService.startWip). A spare request that's fully reserved keeps
  // the job here; one that's short of stock moves it to SPARE_PENDING below.
  IN_PROGRESS = 'IN_PROGRESS',
  // A requested spare couldn't be fully reserved (FR-09) - blocks WorkshopService.complete
  // until either more stock arrives and the technician tops up, or the shortfall is
  // otherwise resolved. Moves back to IN_PROGRESS once a request-spare call is fully filled.
  SPARE_PENDING = 'SPARE_PENDING',
  // Work is done, frozen waiting for QC. Only qcApprove/qcReject (guarded by
  // PermissionType.QC_APPROVAL, admin-assignable to any user) can move it out of here.
  READY_FOR_QC = 'READY_FOR_QC',
  // Phase 6: QC officer (or whoever holds the QC_APPROVAL grant) approved the job.
  // Reservations for this job are atomically consumed (Main Store -> Damage Location) in
  // the same transaction that sets this status - see
  // InventoryService.consumeReservationsOnQcApproval(). Terminal for the repair workflow;
  // later phases (Delivery/Invoice) pick up from here.
  QC_PASSED = 'QC_PASSED',
  // Phase 7: POD actually captured (DeliveryService.capturePod). Terminal - the repair
  // and hand-back cycle is fully complete. See `delivery`/`deliveryId` below for how a job
  // gets here (batch/normal delivery, one DLV# covering one or more Job Cards).
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

export enum JobCardSection {
  ON_SITE_REPAIR = 'ON_SITE_REPAIR',
  WORKSHOP = 'WORKSHOP',
}

@Entity('job_cards')
@Index(['appointmentId'], { unique: true })
export class JobCard {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  jobCardNumber: string;

  @OneToOne(() => Appointment)
  @JoinColumn({ name: 'appointmentId' })
  appointment: Appointment;

  @Column({ type: 'uuid' })
  appointmentId: string;

  @Column({ type: 'enum', enum: JobCardStatus, default: JobCardStatus.OPEN })
  status: JobCardStatus;

  @Column({ type: 'enum', enum: JobCardSection, nullable: true })
  section: JobCardSection | null;

  // Snapshotted from TechnicianVisit at creation time - deliberately NOT re-read live from
  // the visit afterwards, so a Job Card's record of what was found on-site can't silently
  // drift if the visit is ever revisited.
  @Column({ type: 'varchar', length: 100 })
  serialNumber: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  brand: string | null;

  @Column({ type: 'varchar', length: 20 })
  faultCode: string;

  @Column({ type: 'varchar', length: 20 })
  symptomCode: string;

  // Immutable snapshot of the warranty badge the technician captured on-site. Never
  // mutated after creation - `warrantyStatus` below is the effective/current one.
  @Column({ type: 'enum', enum: WarrantyStatus })
  originalWarrantyStatus: WarrantyStatus;

  @Column({ type: 'enum', enum: WarrantyStatus })
  warrantyStatus: WarrantyStatus;

  // Gate 2: a CCE (or above) manually confirms the captured S/N matches the physical
  // invoice. Business rule: "no Job Card without invoice verification."
  @Column({ type: 'boolean', default: false })
  snValidatedAgainstInvoice: boolean;

  @Column({ type: 'text', nullable: true })
  snValidationNotes: string | null;

  // Warranty override (FR-17/AC-18): TL approval required, full audit trail. Can be
  // called more than once - overrideCount tracks how many times, each one also writes an
  // AuditLog row (see JobCardsController) so the full history survives even though this
  // entity itself only holds the *latest* override's details.
  @Column({ type: 'boolean', default: false })
  warrantyOverridden: boolean;

  @Column({ type: 'text', nullable: true })
  warrantyOverrideReason: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'warrantyOverrideBy' })
  warrantyOverrideByUser: User;

  @Column({ type: 'uuid', nullable: true })
  warrantyOverrideBy: string | null;

  @Column({ type: 'timestamp', nullable: true })
  warrantyOverrideAt: Date | null;

  @Column({ type: 'int', default: 0 })
  overrideCount: number;

  // FR-06 stopgap: the real Estimate/shareable-approval-link flow is a later phase. Until
  // then, an OOW job card cannot move to SECTION_ASSIGNED without this manual flag being
  // set by a CCE/TL/above. Deliberately reset to false whenever an override flips the
  // *effective* status to OOW after the fact, so a stale approval can't cover new terms.
  @Column({ type: 'boolean', default: false })
  customerApproved: boolean;

  @Column({ type: 'text', nullable: true })
  customerApprovalNotes: string | null;

  // Phase 5: the workshop technician this job is assigned to once section=WORKSHOP work
  // actually starts. Distinct from the field technician on the Appointment - a job can
  // (and for major repairs, does) have a different person doing the workshop half.
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'assignedWorkshopTechnicianId' })
  assignedWorkshopTechnician: User | null;

  @Column({ type: 'uuid', nullable: true })
  assignedWorkshopTechnicianId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  workshopAssignedAt: Date | null;

  // Phase 6 QC gate. Mirrors the warrantyOverride "latest snapshot on the entity, full
  // history via @Audit()" pattern above. qcApproved*/lastQcRejected* are both nullable and
  // independent - a job can be rejected any number of times (qcRejectionCount increments
  // each time) before eventually being approved.
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'qcApprovedByUserId' })
  qcApprovedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  qcApprovedByUserId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  qcApprovedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  qcRejectionCount: number;

  @Column({ type: 'timestamp', nullable: true })
  lastQcRejectedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastQcRejectionReason: string | null;

  @Column({ type: 'text', nullable: true })
  cancellationReason: string | null;

  // Phase 7: many Job Cards -> one Delivery (batch or normal, N>=1 members under one
  // DLV#). Set by DeliveryService.create() once the OOW-paid gate clears for every job in
  // the batch; cleared again by DeliveryService.cancel() while still PENDING (before
  // dispatch) so the job returns to the ready-for-delivery pool.
  @ManyToOne(() => Delivery, { nullable: true })
  @JoinColumn({ name: 'deliveryId' })
  delivery: Delivery;

  @Column({ type: 'uuid', nullable: true })
  deliveryId: string | null;

  // Phase 8: the public, no-login tracking token for the Customer Portal
  // (`/customer-portal/public/track/:token`). Generated once, at Job Card creation
  // (JobCardsService.create) - unlike Estimate.accessToken (only generated when send()
  // is explicitly called, because a customer has nothing to approve until then), a
  // tracking link is useful from day one of any job, so there's no separate "generate"
  // step. Long-lived (180 days from creation - a repair's whole lifecycle, plus a safety
  // margin) rather than short-lived like the Estimate link, since this is read-only
  // (no state-changing action happens through this token, unlike Estimate's respond()).
  @Column({ type: 'varchar', length: 64, unique: true, nullable: true })
  publicToken: string | null;

  @Column({ type: 'timestamp', nullable: true })
  publicTokenExpiresAt: Date | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @Column({ type: 'uuid' })
  createdById: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
