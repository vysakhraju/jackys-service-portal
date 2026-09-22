import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

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
// One row per CreateAppointmentDto property name (`fieldKey` - must match exactly, it's
// how Phase 2's dynamic validation and the frontend form both look a field up). Seeded by
// scripts/seed-appointment-field-config.ts; rows are fixed (no create/delete route) since
// a row with no matching form field is meaningless - only `isMandatory` is admin-editable.
@Entity('appointment_field_configs')
export class AppointmentFieldConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100, unique: true })
  fieldKey: string;

  @Column({ length: 150 })
  fieldLabel: string;

  @Column({ default: false })
  isMandatory: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
