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
import { User } from '../../auth/entities/user.entity';
import { JobCard } from '../../job-cards/entities/job-card.entity';

export enum AppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  CONFIRMED = 'CONFIRMED',
  TECHNICIAN_ASSIGNED = 'TECHNICIAN_ASSIGNED',
  ON_SITE = 'ON_SITE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
  RESCHEDULED = 'RESCHEDULED',
}

export enum AppointmentType {
  WARRANTY = 'WARRANTY',
  OUT_OF_WARRANTY = 'OUT_OF_WARRANTY',
  AMC = 'AMC',
  PREVENTIVE = 'PREVENTIVE',
  DISMANTLING = 'DISMANTLING',
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

  @Column({ nullable: true })
  brand: string;

  @Column({ nullable: true })
  modelNumber: string;

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

  @Column({ nullable: true })
  actualStartAt: Date;

  @Column({ nullable: true })
  actualEndAt: Date;

  @Column({ nullable: true })
  notes: string;

  @Column({ nullable: true })
  cancellationReason: string;

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