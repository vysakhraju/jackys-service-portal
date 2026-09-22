import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ServiceCentre } from '../../master-data/entities/service-centre.entity';
import { City } from '../../master-data/entities/city.entity';
import { CancellationReason } from '../../master-data/entities/cancellation-reason.entity';
import { ApplianceModel } from '../../master-data/entities/appliance-model.entity';
import { BillingChannel } from '../../master-data/entities/billing-channel.entity';
import { User } from '../../auth/entities/user.entity';
import { JobCard } from '../../job-cards/entities/job-card.entity';
// Price List rebuild (2026-09-22, Phase 3) moved JobType's definition into master-data
// (service-price-list.entity.ts) so the Price List rebuild could reuse the exact same
// enum without a cycle back into this module - see that file's own doc comment. Re-
// exported under the same name here so every existing `import { JobType } from
// '../entities/appointment.entity'` (create-appointment.dto.ts, this app's own tests)
// keeps working unchanged; the string values themselves are untouched.
import { JobType } from '../../master-data/entities/service-price-list.entity';
export { JobType };

// Appointment/Mobile/Job Card overhaul (2026-09-16) Phase 1, req. 3d/3e: COLLECTED_TO_WS
// is the new intermediate status for the mobile "Collection to WS" action. Deliberately
// NOT the same as COMPLETED (the pre-mortem's failure #3) - a collected-but-not-yet-
// received unit must still be cancellable-in-spirit-blocked-by-Job-Card the same way any
// other active appointment is, and must NOT trip the existing "can't cancel once
// COMPLETED" rule. It only reaches COMPLETED once the web's "Mark Received" + workshop
// S/N/invoice check (Phase 4) succeeds and a Job Card is created. See
// claude/APPOINTMENT_MOBILE_JOBCARD_SPEC.md section 2.2 for the full state machine.
export enum AppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  CONFIRMED = 'CONFIRMED',
  TECHNICIAN_ASSIGNED = 'TECHNICIAN_ASSIGNED',
  ON_SITE = 'ON_SITE',
  COLLECTED_TO_WS = 'COLLECTED_TO_WS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
  RESCHEDULED = 'RESCHEDULED',
}

// Coverage category - what financial/contract coverage this appointment falls under.
// Unchanged by the 2026-09-16 overhaul; see JobType below for the new, deliberately
// separate "what work is being done" axis (spec doc decision #1 - Option 1, two
// independent fields rather than conflating coverage with work type in one enum).
export enum AppointmentType {
  WARRANTY = 'WARRANTY',
  OUT_OF_WARRANTY = 'OUT_OF_WARRANTY',
  AMC = 'AMC',
  PREVENTIVE = 'PREVENTIVE',
  DISMANTLING = 'DISMANTLING',
  // Added 2026-09-17 to match the frontend's APPOINTMENT_TYPES list
  // (appointmentsTypes.ts) - this enum, not that array, is what
  // CreateAppointmentDto's @IsEnum(AppointmentType) actually validates against,
  // and what the `type` column's Postgres enum type is generated from.
  ACTIVITY = 'ACTIVITY',
}

// Appointment/Mobile/Job Card overhaul (2026-09-16) Phase 1, req. 1a: what work is being
// done, orthogonal to AppointmentType's coverage category above. REPAIR is the default -
// every appointment created before this field existed, and every existing consumer of
// this app that doesn't yet pass one, behaves exactly as before (a repair visit).
// Installation/Delivery+Installation's cost/rate logic stays parked per the request.
// (JobType itself is now defined in master-data/entities/service-price-list.entity.ts
// and imported/re-exported above - see that import's own comment.)

// Appointment/Mobile/Job Card overhaul (2026-09-16) Phase 1, req. 1d/5: purely
// informational going forward - VAT stays Service Centre-driven, unchanged (spec doc
// decision #5). Kept as a small fixed enum rather than a master-data table since only
// these two values were ever asked for.
export enum AppointmentCountry {
  UAE = 'UAE',
  KSA = 'KSA',
}

export enum CustomerType {
  B2C = 'B2C',
  B2B = 'B2B',
  B2B_SALES_CHANNEL = 'B2B_SALES_CHANNEL',
}

// Service Desk gap flagged in REDTRA360_REVIEW.md - the vendor's demo had a single
// channel-agnostic triage inbox (phone/email/WhatsApp/walk-in/portal-dealer all landing in
// one list) that Jacky's had no equivalent of: every appointment looked the same regardless
// of how the request actually came in, so there was no way to see where the day's intake
// was coming from. This enum plus the `channel` column below is the minimum needed for that
// triage value - it does NOT wire up live WhatsApp/email intake (that stays correctly
// parked behind the business's own WhatsApp Business account plan, per the review).
export enum AppointmentChannel {
  PHONE = 'PHONE',
  EMAIL = 'EMAIL',
  WHATSAPP = 'WHATSAPP',
  WALK_IN = 'WALK_IN',
  PORTAL = 'PORTAL',
  DEALER = 'DEALER',
}

@Entity('appointments')
@Index(['serviceCentreId', 'scheduledAt'])
@Index(['technicianId', 'scheduledAt'])
@Index(['status', 'scheduledAt'])
export class Appointment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  appointmentNumber: string;

  @Column({ type: 'enum', enum: AppointmentType })
  type: AppointmentType;

  // Req. 1a - defaults REPAIR at the DB level (same reasoning as `channel` defaulting
  // PHONE above) so every pre-existing row and every caller that doesn't yet pass this
  // field keeps behaving exactly as before.
  @Column({ type: 'enum', enum: JobType, default: JobType.REPAIR })
  jobType: JobType;

  @Column({ type: 'enum', enum: AppointmentStatus, default: AppointmentStatus.SCHEDULED })
  status: AppointmentStatus;

  @Column({ type: 'enum', enum: CustomerType })
  customerType: CustomerType;

  // Defaults to PHONE at the DB level (not just in the DTO) so every pre-existing row and
  // every caller that doesn't yet know about this field - Swagger scripts, the mobile app's
  // own appointment lookups, this app's own tests - keeps working unchanged rather than
  // getting a NULL that the triage list then has to special-case.
  @Column({ type: 'enum', enum: AppointmentChannel, default: AppointmentChannel.PHONE })
  channel: AppointmentChannel;

  @Column()
  customerName: string;

  @Column()
  customerPhone: string;

  @Column({ nullable: true })
  customerEmail: string;

  @Column({ nullable: true })
  customerAddress: string;

  // The user's own idea from the REDTRA360 review call (10:29-11:08): accept the short link
  // a customer shares from Google Maps and resolve it server-side into coordinates, instead
  // of asking anyone to type latitude/longitude by hand. These two columns are the resolved
  // output only - the raw link the CCE pasted isn't persisted (nothing downstream needs it
  // once it's been resolved, and keeping it around would just be another stale copy to go
  // out of sync with the coordinates). `double precision`, not `decimal`: TypeORM maps
  // Postgres `decimal`/`numeric` columns to JS strings, not numbers (a well-known gotcha),
  // and these are plotted/used as numbers everywhere they're read (frontend "View on
  // Google Maps" link, any future distance/routing use) - see
  // google-maps-link.util.ts for how they get populated.
  @Column({ type: 'double precision', nullable: true })
  customerLat: number | null;

  @Column({ type: 'double precision', nullable: true })
  customerLng: number | null;

  @Column({ nullable: true })
  customerCity: string;

  @Column({ nullable: true })
  customerCountry: string;

  @Column({ nullable: true })
  customerVatNumber: string;

  // Req. 1c/1d - proper FK/enum replacements for the plain customerCity/customerCountry
  // strings above, added by the 2026-09-16 overhaul. Nullable so existing rows (and any
  // caller not yet updated to send them) stay valid; customerCity/customerCountry are
  // kept as-is for backward read-compat rather than migrated/dropped. `country` is
  // informational only - see AppointmentCountry's own doc comment; VAT stays Service
  // Centre-driven.
  @ManyToOne(() => City, { nullable: true, eager: true })
  @JoinColumn({ name: 'cityId' })
  city: City | null;

  @Column({ type: 'uuid', nullable: true })
  cityId: string | null;

  @Column({ type: 'enum', enum: AppointmentCountry, default: AppointmentCountry.UAE })
  country: AppointmentCountry;

  @Column({ nullable: true })
  brand: string;

  @Column({ nullable: true })
  modelNumber: string;

  // Req. 1e - proper FK replacement for the plain brand/modelNumber strings above.
  // Nullable for the same backward-compat reason as cityId.
  @ManyToOne(() => ApplianceModel, { nullable: true, eager: true })
  @JoinColumn({ name: 'applianceModelId' })
  applianceModel: ApplianceModel | null;

  @Column({ type: 'uuid', nullable: true })
  applianceModelId: string | null;

  // Phase 5 (2026-09-22) - the New Appointment popup's "Billing Channel" dropdown the
  // original request's point #4 asked for, but that Phases 1-4 never actually built (see
  // billing-channel-resolution.util.ts's own doc comment for the full gap and the fix).
  // Nullable/optional exactly like cityId/applianceModelId above: most appointments never
  // set this, and InvoicingService/DebitNotesService fall back to the Price List row's
  // own channel (or plain B2B/B2C/warranty pricing) when it's unset. Eager for the same
  // reason as city/applianceModel - read everywhere an Appointment is loaded, never worth
  // a manual join at every call site - EXCEPT AppointmentsService.findAll(), which uses
  // createQueryBuilder() and therefore needs an explicit .leftJoinAndSelect() for this
  // too (see that method's own comment on why eager doesn't apply there).
  @ManyToOne(() => BillingChannel, { nullable: true, eager: true })
  @JoinColumn({ name: 'billingChannelId' })
  billingChannel: BillingChannel | null;

  @Column({ type: 'uuid', nullable: true })
  billingChannelId: string | null;

  @Column({ nullable: true })
  serialNumber: string;

  @Column({ nullable: true })
  purchaseDate: Date;

  // The customer's ORIGINAL PURCHASE invoice/receipt number (used for S/N-vs-invoice
  // warranty verification) - NOT related to the billing Invoice entity added in Phase 7
  // (src/invoicing/entities/invoice.entity.ts), which is the bill WE issue for an
  // out-of-warranty repair. Two unrelated documents that happen to share the word
  // "invoice" - easy to conflate, so flagging it here and on that entity's own doc comment.
  @Column({ nullable: true })
  invoiceNumber: string;

  @Column({ type: 'text', nullable: true })
  problemDescription: string;

  @Column({ nullable: true })
  preferredDate: Date;

  @Column({ nullable: true })
  preferredTimeSlot: string;

  @Column()
  scheduledAt: Date;

  @Column({ nullable: true })
  estimatedDurationMinutes: number;

  // Field technician scheduling split (2026-09-10): a CCE drag-reorder on the Field
  // Technician Schedule board changes ONLY this column, never scheduledAt - per the
  // business's own decision, reprioritizing what a field technician sees in their mobile
  // app is deliberately independent of the customer's actual promised appointment time.
  // Null (the default, for every appointment created before this column existed and every
  // appointment nobody has manually reordered yet) sorts last under Postgres's own ASC-
  // NULLS-LAST default, so getTechnicianSchedule() falls back to scheduledAt ordering
  // exactly as before until a CCE actually reorders that technician's day.
  @Column({ type: 'int', nullable: true })
  priorityOrder: number | null;

  @Column({ nullable: true })
  actualStartAt: Date;

  @Column({ nullable: true })
  actualEndAt: Date;

  @Column({ nullable: true })
  notes: string;

  @Column({ nullable: true })
  cancellationReason: string;

  // Req. 3f - the mobile Cancellation action's DB-backed reason. Existing free-text
  // `cancellationReason` above stays for the web/CCE-initiated cancel path (unchanged);
  // this FK is set only when the cancellation came from the new mobile reason dropdown.
  @ManyToOne(() => CancellationReason, { nullable: true, eager: true })
  @JoinColumn({ name: 'cancellationReasonId' })
  cancellationReasonEntity: CancellationReason | null;

  @Column({ type: 'uuid', nullable: true })
  cancellationReasonId: string | null;

  @ManyToOne(() => ServiceCentre, { eager: true })
  @JoinColumn({ name: 'serviceCentreId' })
  serviceCentre: ServiceCentre;

  @Column()
  serviceCentreId: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'technicianId' })
  technician: User;

  @Column({ nullable: true })
  technicianId: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @Column({ nullable: true })
  createdById: string;

  // Post-MVP AMC phase: set when this appointment is a system-generated PM visit
  // belonging to an AMC contract's schedule (AmcService.createContract()/renewContract()),
  // rather than a customer-booked appointment. Null for every ordinary appointment.
  //
  // Deliberately a PLAIN column, no @ManyToOne relation/JoinColumn to AmcContract - the
  // amc module's entities already import CustomerType from THIS file, so a relation
  // pointing back the other way (importing AmcContract's class here) would be a real
  // circular module dependency, not just a type-only one: at require-time, whichever
  // file loads second sees the other's exports as still-undefined (this bit Phase 9's
  // first build - CustomerType came back undefined inside amc-contract.entity.ts's own
  // decorator). AmcService queries Appointment by amcContractId directly instead of
  // relying on a loaded relation.
  @Column({ type: 'uuid', nullable: true })
  amcContractId: string | null;

  @OneToOne(() => JobCard, (jobCard) => jobCard.appointment)
  jobCard: JobCard;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}