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

  // DEPRECATED (2026-09-25) - Phase 5 (2026-09-22) originally made this the flat rate an
  // appointment-picked channel billed at, overriding the matched Price List row's own
  // billingChannelRate. In practice this let a channel with no (or an accidentally-0)
  // defaultRate silently zero out an invoice with no error anywhere - the JER-C AED 0.00
  // dead-end. billing-channel-resolution.util.ts no longer reads this column at all: the
  // Price List row's own billingChannelRate (per category/jobType) is the single source
  // of truth for what a channel bills. Column kept (nullable, unused) rather than dropped
  // to avoid an enum/column migration on a dev DB with no migrations folder - do not wire
  // this back into pricing.
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  defaultRate: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
