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

// Price List rebuild (requested 2026-09-22, Phase 3) - full rewrite of the row shape,
// replacing the original (requested 2026-09-14) ServiceActivityType/modelId design.
//
// Why: the original ServiceActivityType enum (INSTALL/REPAIR/DEMO/ON_SITE/PM/DISMANTLE)
// was its own, separate list from the New Appointment popup's JobType enum
// (REPAIR/INSTALLATION/DELIVERY_INSTALLATION/MAINTENANCE) - two independent copies of
// "what work is being done" that could silently drift, the exact failure mode this app
// already hit once for real (the ACTIVITY appointment-type bug, see
// MODIFICATION_REQUESTS.md's "Backend crash" section). Per req. #6/#7 of the 2026-09-22
// request ("sync the Pricing screen's Activity Type list with New Appointment's" /
// "rebuild the Price List row around Appliance Model->category, Activity Type..."),
// ServiceActivityType is retired outright and Price List rows now key off the SAME
// JobType enum the appointment itself uses, plus ApplianceCategory (already reused from
// FaultSymptom/ApplianceModel) instead of a loose SparePartModel.modelId string that had
// nothing to do with the appliance the appointment was actually for (see
// appliance-model.entity.ts's own doc comment on that exact confusion).
//
// Row shape, per the business owner's own design clarification: one row per
// (category, jobType) combo (the unique index below) carries a B2B price and a B2C
// price, plus an OPTIONAL third rate - `billingChannelRate` - that applies when the job
// is billed through a specific interdepartment Billing Channel (billingChannelId),
// keeping the "B2B Sales Channel (interdepartment billing)" rate distinct from the
// default B2B price. `billingChannelId` null means no channel-specific override is set
// for this category/jobType combo yet (Finance falls back to priceB2B). This shape can
// still change again in a follow-up round if it turns out to need one row PER channel
// instead of one extra column - nothing downstream consumes it yet (Phase 4, not built),
// so revising it now is cheap.
@Entity('service_price_lists')
@Index(['category', 'jobType'], { unique: true })
export class ServicePriceList {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ApplianceCategory })
  category: ApplianceCategory;

  @Column({ type: 'enum', enum: JobType })
  jobType: JobType;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  priceB2B: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  priceB2C: number;

  // Optional interdepartment-billing override - see the entity comment above. Nullable:
  // most category/jobType rows won't have a channel-specific rate at all.
  @ManyToOne(() => BillingChannel, { nullable: true })
  @JoinColumn({ name: 'billingChannelId' })
  billingChannel: BillingChannel | null;

  @Column({ type: 'uuid', nullable: true })
  billingChannelId: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  billingChannelRate: number;

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
