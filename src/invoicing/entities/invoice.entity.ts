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
import { JobCard } from '../../job-cards/entities/job-card.entity';
import { User } from '../../auth/entities/user.entity';

/**
 * NOT to be confused with Appointment.invoiceNumber, which is the customer's ORIGINAL
 * PURCHASE invoice/receipt number (used for S/N-vs-invoice warranty verification back in
 * the Technician Mobile API / Job Cards phases) - a completely different document from
 * this one, which is the bill WE issue for an out-of-warranty repair.
 *
 * Deliberately minimal (FR-12/AC-11 stopgap, not the real Finance module): amount is a
 * one-time snapshot of the job's approved Estimate.totalAmount (immutable once approved -
 * that figure IS what the customer agreed to pay, so there's nothing to "recompute"
 * later), status is just DRAFT/PAID/CANCELLED with no VAT breakdown, GL posting,
 * interdept debit, partial payments, or B2B aging - all genuinely Phase 8 (Finance
 * Module) territory. Never created for IW jobs (warranty covers it - nothing to invoice).
 * One invoice per Job Card (unique index below) - lazily created the first time it's
 * needed (InvoicingService.getOrCreateForJobCard), not eagerly at QC-approve time, so
 * Phase 6's already-shipped code is never touched.
 */
export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}

export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  BANK_TRANSFER = 'BANK_TRANSFER',
  B2B_CREDIT = 'B2B_CREDIT',
}

@Entity('invoices')
@Index(['jobCardId'], { unique: true })
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  invoiceNumber: string;

  @ManyToOne(() => JobCard)
  @JoinColumn({ name: 'jobCardId' })
  jobCard: JobCard;

  @Column({ type: 'uuid' })
  jobCardId: string;

  // Snapshot of the approved Estimate.totalAmount at the moment this invoice was
  // lazily created - see the class doc comment above for why this never needs updating.
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'enum', enum: InvoiceStatus, default: InvoiceStatus.DRAFT })
  status: InvoiceStatus;

  @Column({ type: 'enum', enum: PaymentMethod, nullable: true })
  paymentMethod: PaymentMethod | null;

  // Must equal `amount` exactly (InvoicingService.recordPayment) - a deliberate guard
  // against silently under-recording a payment as "PAID" with no real number behind it.
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  amountReceived: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  paymentReference: string | null;

  @Column({ type: 'timestamp', nullable: true })
  paidAt: Date | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'recordedByUserId' })
  recordedByUser: User;

  @Column({ type: 'uuid', nullable: true })
  recordedByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
