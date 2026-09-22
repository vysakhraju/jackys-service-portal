import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { JobType } from './service-price-list.entity';

// Master-Data/New-Appointment billing modification (requested 2026-09-21), req. 1: lets a
// Super Admin tick which New Appointment fields are mandatory, instead of that being fixed
// in code. Deliberately NOT covering every field on the form - `type` and `customerType`
// stay permanently hard-required via CreateAppointmentDto's own @IsEnum decorators (no
// @IsOptional), per the locked decision on the-fool pre-mortem finding #1: those two drive
// downstream billing/ledger logic, so letting an admin accidentally switch them off would
// silently break invoicing, not just this form. Only the fields that are ALREADY optional
// in CreateAppointmentDto today get a row here - this table controls whether one of THOSE
// becomes soft-mandatory, never whether a structurally-required field becomes optional.
//
// Job Type split (requested 2026-09-22), Phase 6: `jobType` and `isVisible` added so a row
// can be scoped to one Job Type instead of applying globally. `jobType: null` means "applies
// to every Job Type" (every row from before this phase has jobType null) - a more specific
// (fieldKey, jobType) row overrides the global (fieldKey, null) row when both exist, resolved
// by AppointmentsService.validateMandatoryFields() on the backend and the New Appointment
// popup on the frontend, both picking the most specific match. `isVisible` is a separate
// concern from `isMandatory`: a hidden field (isVisible: false) is never shown on the form
// and never sent at all, regardless of what isMandatory says on that same row - used to hide
// Brand/Model, Serial Number, Invoice Number, Purchase Date, and Problem Description for the
// Installation/Delivery Installation Job Types, since those appointments are currently
// created by CCE from a separate ERP process with none of that information available yet.
//
// One row per (CreateAppointmentDto property name, Job Type) pair - `fieldKey` must match a
// CreateAppointmentDto property exactly, it's how the dynamic validation and the frontend
// form both look a field up. Seeded by scripts/seed-appointment-field-config.ts; rows are
// fixed (no create/delete route) since a row with no matching form field is meaningless -
// only `isMandatory`/`isVisible` are admin-editable. No DB-level unique constraint on
// (fieldKey, jobType): Postgres treats every NULL as distinct for uniqueness purposes, which
// would let multiple global (jobType: null) rows for the same fieldKey slip past a unique
// index anyway - the seed script's own idempotent existing-row check (by fieldKey AND
// jobType together) is what actually prevents duplicates in practice.
@Entity('appointment_field_configs')
@Index(['fieldKey', 'jobType'])
export class AppointmentFieldConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  fieldKey: string;

  @Column({ length: 150 })
  fieldLabel: string;

  @Column({ default: false })
  isMandatory: boolean;

  @Column({ type: 'enum', enum: JobType, nullable: true })
  jobType: JobType | null;

  @Column({ default: true })
  isVisible: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
