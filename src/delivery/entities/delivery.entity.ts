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
import { User } from '../../auth/entities/user.entity';

/**
 * FR-11/AC-10: a batch or normal delivery, one DLV# covering one or more Job Cards. The
 * JobCard side of this relationship (JobCard.deliveryId, many JobCards -> one Delivery) is
 * intentionally a plain FK column, not a join table - "batch" is just N>=1 members under
 * one manifest, no distinct data model needed for "normal" (N=1) vs "batch" (N>1).
 *
 * Deliberately does NOT track failed-delivery-attempt history (e.g. driver arrives,
 * customer isn't home, needs to retry as a fresh DLV# tomorrow) - out of scope for what
 * FR-11/FR-12/AC-10-12 actually ask for. If that need arises, it wants a proper
 * DeliveryAttempt history table; documented as a known gap, not built preemptively.
 */
export enum DeliveryStatus {
  PENDING = 'PENDING',
  DISPATCHED = 'DISPATCHED',
  DELIVERED = 'DELIVERED',
  // Only reachable from PENDING (DeliveryService.cancel), i.e. before dispatch. Kept as a
  // status (not a hard row delete) so a cancelled batch still shows up in delivery
  // history/audit - mirrors JobCardStatus.CANCELLED and InvoiceStatus.CANCELLED elsewhere.
  CANCELLED = 'CANCELLED',
}

@Entity('deliveries')
export class Delivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  deliveryNumber: string;

  @Column({ type: 'enum', enum: DeliveryStatus, default: DeliveryStatus.PENDING })
  status: DeliveryStatus;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'dispatcherUserId' })
  dispatcher: User;

  @Column({ type: 'uuid' })
  dispatcherUserId: string;

  // Who's physically driving - distinct from dispatcherUserId (who created/organized the
  // run). Nullable: not every delivery needs a named driver on record at creation time.
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'driverUserId' })
  driver: User;

  @Column({ type: 'uuid', nullable: true })
  driverUserId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  dispatchedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt: Date | null;

  // AC-12: POD mandatory (signature OR photo) - at least one required, enforced in
  // DeliveryService.capturePod(), not here. Stored as base64 text - a deliberate stopgap
  // (same philosophy as the notification stubs) until real blob storage (S3 etc.) exists;
  // capped at the DTO layer (~2MB decoded) so this table can't grow unbounded, and
  // excluded from the list-view query (DeliveryService.findAll) so browsing deliveries
  // doesn't drag megabytes of blob data over the wire - only the single-delivery detail
  // view returns them.
  @Column({ type: 'text', nullable: true })
  podSignatureBase64: string | null;

  @Column({ type: 'text', nullable: true })
  podPhotoBase64: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  podRecipientName: string | null;

  @Column({ type: 'text', nullable: true })
  podNotes: string | null;

  @Column({ type: 'text', nullable: true })
  cancellationReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
