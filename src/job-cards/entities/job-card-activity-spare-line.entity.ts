import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { JobCard } from './job-card.entity';
import { SparePart } from '../../master-data/entities/spare-part.entity';
import { User } from '../../auth/entities/user.entity';

// Activity spares record-keeping (requested 2026-09-25, alongside the Activity dashboard/
// report work) - locked scope: record ONLY for now (which SparePart + qty an Installation/
// Delivery Installation Job Card used), no stock reservation/deduction. Mirrors
// JobCardActivityLineItem's own shape/conventions exactly (normalized child table, FK'd to
// JobCard with CASCADE, FK'd to its master with default RESTRICT so a referenced SparePart
// can't be silently deleted out from under an existing line) - same reasoning: individually
// reportable rows, not a JSON blob.
//
// Deliberately NO price/amount column here, same as JobCardActivityLineItem - pricing is
// resolved fresh at invoice-generation time from SparePart.unitPriceB2B/unitPriceB2C (see
// InvoicingService.resolveActivityLineItemsPricing), never snapshotted onto the source line
// itself; only the generated Invoice's own lineItemsBreakdown snapshots a price, same
// "copy, not a live join" convention used everywhere else in this app.
//
// Editable ANYTIME after the Job Card exists (not folded into the createFromActivity()
// popup) - your own locked answer. addedByUserId is who recorded it, for traceability only
// (no ownership/permission gate keyed off it - JOB_CARD_MANAGE covers add/remove, same as
// every other Job Card mutation).
//
// Real stock reserve/deduct is explicitly future work, gated behind a separate Super Admin
// toggle (see ActivityInventorySetting) that does nothing yet - this table's shape doesn't
// need to change for that later step, only a new service-layer branch would.
@Entity('job_card_activity_spare_lines')
export class JobCardActivitySpareLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => JobCard, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobCardId' })
  jobCard: JobCard;

  @Column({ type: 'uuid' })
  jobCardId: string;

  @ManyToOne(() => SparePart)
  @JoinColumn({ name: 'sparePartId' })
  sparePart: SparePart;

  @Column({ type: 'uuid' })
  sparePartId: string;

  @Column({ type: 'int' })
  quantity: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'addedByUserId' })
  addedByUser: User;

  @Column({ type: 'uuid' })
  addedByUserId: string;

  @CreateDateColumn()
  createdAt: Date;
}
