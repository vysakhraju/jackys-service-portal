import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { JobCard } from './job-card.entity';
import { ApplianceModel } from '../../master-data/entities/appliance-model.entity';
import { JobType } from '../../master-data/entities/service-price-list.entity';

// Job Type split (2026-09-22 request, Phase 10, built 2026-09-23): one row per
// appliance/line on the ERP-sourced Installation/Delivery Installation Job Card popup
// (point 10 of the original request - "a popup to enter an ERP reference number plus
// line items: brand from master, job type, quantity, finished checkbox"). Deliberately a
// normalized table, NOT a JSON blob on JobCard itself (unlike Estimate.lineItems, which
// is `@Column({ type: 'jsonb' })`) - the request explicitly asked for each line to stay
// individually reportable later, and this app already has a closer, more appropriate
// precedent for exactly that shape: WarrantyClaimLine (child rows FK'd to a parent,
// onDelete CASCADE, each line individually queryable) - this entity mirrors that
// convention rather than Estimate's.
@Entity('job_card_activity_line_items')
export class JobCardActivityLineItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => JobCard, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobCardId' })
  jobCard: JobCard;

  @Column({ type: 'uuid' })
  jobCardId: string;

  // "Brand" per the request - resolved against the same ApplianceModel (Brand+Model)
  // master the New Appointment popup's own Brand/Model dropdowns already use, rather
  // than a free-text column, so a line item stays joinable/reportable the same way every
  // other appliance reference in this app already is. No onDelete here (default
  // RESTRICT) - an ApplianceModel that already has line items against it should not be
  // silently deletable out from under them.
  @ManyToOne(() => ApplianceModel)
  @JoinColumn({ name: 'applianceModelId' })
  applianceModel: ApplianceModel;

  @Column({ type: 'uuid' })
  applianceModelId: string;

  // Reuses the appointment-level JobType enum rather than a new one - the service layer
  // (JobCardsService.createFromActivity) restricts this to INSTALLATION/
  // DELIVERY_INSTALLATION only (the same 2 values ACTIVITY_JOB_TYPES in
  // appointments.service.ts already gates the whole Activity flow to), avoiding a second,
  // independent "what work is being done" list of the kind this app has already been
  // burned by once (see the Price List rebuild's own doc comment on the
  // ServiceActivityType/JobType drift). Per-line rather than inherited from the parent
  // appointment's own jobType because a single ERP reference can genuinely cover a mix
  // (e.g. deliver 2 units, install 3 others) under one appointment/Job Card.
  @Column({ type: 'enum', enum: JobType })
  jobType: JobType;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'boolean', default: false })
  finished: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
