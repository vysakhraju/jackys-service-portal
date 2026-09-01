import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { WarrantyClaimLine } from './warranty-claim-line.entity';

/**
 * BRD Workflow 12 (EPIC-007 partial, "[Optional]"): Warranty Claims & Vendor Management.
 * A WarrantyClaim is the header row for one aggregation run against one vendor over one
 * period - BRD 12.1's "System groups all warranty spares used for each vendor."
 *
 * Lifecycle: DRAFT (just aggregated, editable/cancellable) -> SUBMITTED (BRD 12.3, a
 * Warranty Clerk has uploaded it to the vendor's own portal - there's no real vendor
 * portal integration here, same documented-stub pattern as NotificationsService, so this
 * transition is a manual "I did this externally, recording it" action) -> CREDIT_RECEIVED
 * (BRD 12.4, an Accountant recorded a credit note and it posted to the GL) - or CANCELLED
 * from DRAFT only (the-fool pre-mortem finding: without this, a mistaken aggregate run
 * permanently locks its spares out of ever being claimed again, since WarrantyClaimsService
 * never re-offers a reservation that's already linked to a claim line, live or cancelled -
 * cancel() detaches this claim's lines so those reservations return to the aggregatable
 * pool). No transition ever exists back out of SUBMITTED/CREDIT_RECEIVED - once a claim
 * has left the building for the vendor's own portal, it's out in the real world and this
 * app has no authority to unilaterally cancel it (same "blocked once it's no longer just
 * ours" precedent as DismantlingRecord's cancel being blocked once VERIFIED).
 */
export enum WarrantyClaimStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  CREDIT_RECEIVED = 'CREDIT_RECEIVED',
  CANCELLED = 'CANCELLED',
}

@Entity('warranty_claims')
@Index(['supplier', 'status'])
export class WarrantyClaim {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  claimNumber: string;

  // Plain string, matching JobCard.warrantySupplier / WarrantyMaster.supplier - no
  // separate Vendor/Supplier master-data entity exists in this app.
  @Column({ type: 'varchar', length: 100 })
  supplier: string;

  // BRD 12.1's "Time Period (Weekly/Monthly)" mandatory field. Anchored to
  // InventoryReservation.consumedAt (see WarrantyClaimsService.aggregate()'s doc comment
  // for why that timestamp, not JobCard creation or QC, is the right anchor).
  @Column({ type: 'date' })
  periodStart: Date;

  @Column({ type: 'date' })
  periodEnd: Date;

  @Column({ type: 'enum', enum: WarrantyClaimStatus, default: WarrantyClaimStatus.DRAFT })
  status: WarrantyClaimStatus;

  // Sum of this claim's lines' lineAmount at aggregation time - a snapshot, not a live
  // computed column, so it stays meaningful even after cancel() detaches the lines.
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalClaimedAmount: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'generatedByUserId' })
  generatedByUser: User;

  @Column({ type: 'uuid' })
  generatedByUserId: string;

  // BRD 12.3's "Claim #" - the vendor portal's own external reference, recorded here when
  // this claim is marked SUBMITTED. Free text, since no real portal integration exists.
  @Column({ type: 'varchar', length: 100, nullable: true })
  claimReferenceNumber: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'submittedByUserId' })
  submittedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  submittedByUserId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  submittedAt: Date | null;

  // BRD 12.4's "Credit Note #, Amount" from the vendor.
  @Column({ type: 'varchar', length: 100, nullable: true })
  creditNoteNumber: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  creditNoteAmount: number | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'creditReceivedByUserId' })
  creditReceivedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  creditReceivedByUserId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  creditReceivedAt: Date | null;

  // Free text - a reference to supporting documents (invoices, job cards) per BRD 12.3.
  // No real file upload exists here (matches this app's established stub pattern for
  // anything requiring a real external integration this project doesn't have yet).
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'text', nullable: true })
  cancellationReason: string | null;

  @OneToMany(() => WarrantyClaimLine, (line) => line.warrantyClaim)
  lines: WarrantyClaimLine[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
