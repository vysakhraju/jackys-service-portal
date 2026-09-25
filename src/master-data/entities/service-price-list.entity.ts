import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ApplianceCategory } from './fault-symptom.entity';
import { BillingChannel } from './billing-channel.entity';

// Price List rebuild (requested 2026-09-22, Phase 3). Moved here from
// appointments/entities/appointment.entity.ts so this file (master-data) can be the
// single source of truth for "what work is being done" without creating a cycle back to
// the appointments module - appointments already depends one-directionally on
// master-data (City/CancellationReason/ApplianceModel), never the other way, so this
// keeps that direction intact, the same way ApplianceCategory already lives here and is
// reused by both FaultSymptom and ApplianceModel. appointment.entity.ts re-exports this
// under the same name so nothing importing JobType from there needs to change.
// String values are unchanged from the original definition, so this move is a pure
// relocation - it does not touch the `appointments.jobType` column's stored data.
export enum JobType {
  REPAIR = 'REPAIR',
  INSTALLATION = 'INSTALLATION',
  DELIVERY_INSTALLATION = 'DELIVERY_INSTALLATION',
  MAINTENANCE = 'MAINTENANCE',
}

// Super-admin pricing matrix (requested 2026-09-25, backlog item opened by the JER-C
// billing fix that same day). Moved here for exactly the same one-directional-dependency
// reason JobType was moved above (Phase 3): the pricing matrix needs CustomerType as one
// of its own row-key columns, and master-data must never import from appointments.
// appointment.entity.ts re-exports this under the same name - every existing `import {
// CustomerType } from '../entities/appointment.entity'` keeps working unchanged, and the
// string values are untouched, so this move alone does not touch stored appointment data.
export enum CustomerType {
  B2C = 'B2C',
  B2B = 'B2B',
  B2B_SALES_CHANNEL = 'B2B_SALES_CHANNEL',
}

// Super-admin pricing matrix rebuild (requested 2026-09-25) - full rewrite of the row
// shape, replacing the Phase 3 (2026-09-22) priceB2B/priceB2C/billingChannelRate design.
//
// Why: the owner's own ask was a matrix configurable across FOUR dimensions - appliance
// Category ("Type"), Job Type, Customer Type, and Billing Channel - not two hardcoded
// price columns (B2B/B2C) plus an optional third (a single channel override per row).
// Hardcoding exactly two customer types into fixed columns meant Customer Type was never
// actually a matrix dimension a Super Admin could configure - it was baked into the
// schema. This rebuild makes every one of the four dimensions a real row-key column,
// with ONE `price` column holding the rate for that exact combination. Adding a new
// priceable combination (a new Billing Channel's rate for an existing
// category/jobType/customerType, for instance) is now "add a row" - no entity/column
// change needed, which is the whole point of "super-admin configurable."
//
// Row identity (the unique index below): (category, jobType, customerType,
// billingChannelId). `billingChannelId` null means "the generic rate for this
// category/jobType/customerType, no specific channel" - a DIFFERENT row from any
// channel-specific one for the same category/jobType/customerType. This is a deliberate
// behavior change from the old design: previously a category/jobType row could carry an
// "attached" Billing Channel that applied automatically even to an appointment that
// picked no channel of its own. Under the matrix, "no channel picked" and "a specific
// channel picked" are two independently-configurable rows - see
// billing-channel-resolution.util.ts's resolvePriceListRow() for the lookup logic this
// enables (query directly by the appointment's actual customerType + picked channel,
// rather than fetching one row and then checking whether its channel happens to match).
//
// Postgres unique indexes treat NULL as distinct from every other NULL, so the DB index
// below does NOT by itself stop two "generic" (billingChannelId IS NULL) rows for the
// same (category, jobType, customerType) from being created - MasterDataService's
// createServicePriceList() enforces that in application code (same pattern already used
// elsewhere in this app for a de-facto-nullable uniqueness check).
//
// `warrantyLaborCost` is kept as its own column, orthogonal to `price` - it is the
// interdepartment labor-recharge amount DebitNotesService bills for an IN_WARRANTY
// B2B_SALES_CHANNEL job, a completely different scenario (nothing is being sold to a
// customer) from `price`, which is what InvoicingService bills for an OUT_OF_WARRANTY
// job in the same category/jobType/customerType/channel combination. Only ever read for
// customerType = B2B_SALES_CHANNEL rows in practice (DebitNotesService's own guard
// ensures its caller never reaches here for any other customerType) - present on every
// row for schema simplicity, harmlessly unused (defaults to 0) on B2C/B2B rows.
@Entity('service_price_lists')
@Index(['category', 'jobType', 'customerType', 'billingChannelId'], { unique: true })
export class ServicePriceList {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ApplianceCategory })
  category: ApplianceCategory;

  @Column({ type: 'enum', enum: JobType })
  jobType: JobType;

  @Column({ type: 'enum', enum: CustomerType })
  customerType: CustomerType;

  // Nullable: null = the generic rate for this category/jobType/customerType, with no
  // specific Billing Channel involved. See the entity comment above for why this is a
  // separate row from any channel-specific one, not a fallback baked into one row.
  @ManyToOne(() => BillingChannel, { nullable: true })
  @JoinColumn({ name: 'billingChannelId' })
  billingChannel: BillingChannel | null;

  @Column({ type: 'uuid', nullable: true })
  billingChannelId: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  price: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  warrantyLaborCost: number;

  @Column({ length: 100, nullable: true })
  currency: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
