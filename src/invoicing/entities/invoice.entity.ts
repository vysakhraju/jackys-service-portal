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
 * Phase 7 built this as a deliberate stopgap (amount only, no VAT breakdown, no partial
 * payments, no aging). Phase 8 extends it in place rather than replacing it: subtotal/
 * vatRate/vatAmount are now snapshotted alongside `amount` (which remains the VAT-
 * inclusive total, unchanged in meaning) from the approved Estimate at the moment this
 * invoice is lazily created - the Estimate already computed these correctly using the
 * Job Card's Service Centre vatRate (see EstimatesService.computeTotals), so this is a
 * copy, never a recomputation. `dueDate` (createdAt + 30 days) exists only to support the
 * B2B aging report (AC-16) - it means nothing for Cash/Card/Bank invoices, which are
 * expected to be settled same-visit.
 *
 * Real multi-payment support (Phase 8): a PAID invoice is no longer necessarily one
 * lump-sum event - see Payment (payment.entity.ts). `paymentMethod`/`amountReceived`/
 * `paidAt`/`recordedByUserId` on this entity are now a convenience snapshot of the LATEST
 * payment (useful for simple UI display without a join), not the source of truth; the
 * source of truth for "how much has actually been paid" is SUM(Payment.amount) for this
 * invoice, computed in InvoicingService.
 */
export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
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
  // lazily created - VAT-inclusive. See subtotal/vatRate/vatAmount below for the breakdown.
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  // Phase 8 VAT breakdown - all three copied verbatim from the source Estimate.
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  subtotal: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 5 })
  vatRate: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  vatAmount: number;

  // createdAt + 30 days, set at creation. Only meaningful for B2B Credit's 30-day terms
  // (AC-16 aging report); ignored for Cash/Card/Bank invoices.
  @Column({ type: 'timestamp', nullable: true })
  dueDate: Date | null;

  @Column({ type: 'enum', enum: InvoiceStatus, default: InvoiceStatus.DRAFT })
  status: InvoiceStatus;

  @Column({ type: 'enum', enum: PaymentMethod, nullable: true })
  paymentMethod: PaymentMethod | null;

  // Latest-payment convenience snapshot only as of Phase 8 - see class doc comment.
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
