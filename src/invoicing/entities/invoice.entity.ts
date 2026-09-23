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

// Billing logic + Billing Channel routing (requested 2026-09-22, Phase 4). Real gap
// found before writing any code: an OOW Job Card can reach QC_PASSED with NO Estimate at
// all (JobCardsService.approveCustomer's FR-06 manual stopgap bypasses the Estimate flow
// entirely), and getOrCreateForJobCard used to hard-block invoicing in that case. Now it
// falls back to a Price List baseline (see InvoicingService.resolveBaselinePricing) - an
// approved Estimate still always overrides the baseline whenever one exists (the
// "billing tiebreaker" decision locked back in the original 2026-09-22 request).
// ACTIVITY_LINE_ITEMS added Phase 11 (2026-09-24, billing verification for the Job Type
// split's Installation/Delivery Installation flow) - a COMPLETED (ERP-sourced) Job Card
// never has an Estimate (Estimates are REPAIR-only) and its Category comes from its own
// JobCardActivityLineItem rows rather than a single appointment-level ApplianceModel, so
// it gets its own price source tag distinct from PRICE_LIST_BASELINE - Finance can tell
// "REPAIR job priced off the Price List because no Estimate existed" apart from "ERP
// install/delivery job priced per line item" at a glance, without having to cross-
// reference the Job Card's own status/section.
export enum InvoicePriceSource {
  ESTIMATE = 'ESTIMATE',
  PRICE_LIST_BASELINE = 'PRICE_LIST_BASELINE',
  ACTIVITY_LINE_ITEMS = 'ACTIVITY_LINE_ITEMS',
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

  // Phase 4 - which of the two paths actually priced this invoice. Defaults ESTIMATE
  // since every invoice created before this column existed really was Estimate-priced
  // (the baseline-fallback path didn't exist yet), so backfilling old rows this way is
  // correct, not just a placeholder.
  @Column({ type: 'enum', enum: InvoicePriceSource, default: InvoicePriceSource.ESTIMATE })
  priceSource: InvoicePriceSource;

  // Which APPROVED Estimate this invoice's amount was snapshotted from - null when
  // priceSource is PRICE_LIST_BASELINE (no Estimate was ever involved). Traceability
  // only; amount/subtotal/vatAmount remain the real snapshot, this is just "why".
  @Column({ type: 'uuid', nullable: true })
  sourceEstimateId: string | null;

  // Set only when priceSource is PRICE_LIST_BASELINE AND the matched Price List row has
  // a Billing Channel configured (B2B_SALES_CHANNEL jobs only) - see
  // InvoicingService.resolveBaselinePricing. billingChannelName is a denormalized
  // snapshot at creation time (same "copy, not a live join" convention as the VAT
  // breakdown above), so a later rename/deactivation of the channel doesn't retroactively
  // change what this invoice says it was billed through.
  @Column({ type: 'uuid', nullable: true })
  billingChannelId: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  billingChannelName: string | null;

  // Phase 11 (2026-09-24) - only ever set when priceSource is ACTIVITY_LINE_ITEMS. One
  // entry per JobCardActivityLineItem this invoice's subtotal was built from, snapshotted
  // at creation time (same "copy, not a live join" convention as billingChannelName
  // above) so a later Price List edit doesn't retroactively change what this invoice says
  // it was billed for. Kept as a loose jsonb shape rather than its own child table -
  // there is nothing here a report needs to query/filter by independently of its parent
  // invoice (unlike JobCardActivityLineItem itself, which genuinely needed to be
  // individually reportable per the original request) - this exists purely so Finance
  // can see the per-line math behind a multi-line total without re-deriving it from the
  // Price List after the fact.
  @Column({ type: 'jsonb', nullable: true })
  lineItemsBreakdown: {
    applianceModelId: string;
    brand: string;
    model: string;
    category: string;
    jobType: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    billingChannelId: string | null;
    billingChannelName: string | null;
  }[] | null;

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
