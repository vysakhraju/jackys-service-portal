import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

// Master-Data/New-Appointment billing modification (requested 2026-09-21), req. 4: a new
// admin-manageable master backing the New Appointment popup's "Billing Channel" dropdown.
// Deliberately NOT the same thing as AppointmentChannel (see appointment.entity.ts) - that
// enum is intake triage ("how did this request come in" - phone/WhatsApp/walk-in/etc, a
// fixed small enum). This is a Finance-facing, admin-editable list of billing routes
// (e.g. "Retail", "Corporate Interdepartment", a named B2B partner) so Finance can tell
// which channel to bill against without guessing from customerType alone. Named distinctly
// ("Billing Channel", never bare "Channel" anywhere - frontend labels included) per the
// the-fool pre-mortem finding #4 on this same request: a shared "Channel" label would get
// confused with the existing intake-channel field by CCE staff at data-entry time.
@Entity('billing_channels')
@Index(['name'], { unique: true })
export class BillingChannel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
