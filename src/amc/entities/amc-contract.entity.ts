import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ServiceCentre } from '../../master-data/entities/service-centre.entity';
import { User } from '../../auth/entities/user.entity';
import { CustomerType } from '../../appointments/entities/appointment.entity';

export enum AmcContractStatus {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
  RENEWED = 'RENEWED',
}

export enum CoverageType {
  COMPREHENSIVE = 'COMPREHENSIVE', // parts + labor
  LABOR_ONLY = 'LABOR_ONLY',
}

export enum VisitFrequency {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  HALF_YEARLY = 'HALF_YEARLY',
}

export enum AmcPaymentTerms {
  FULL_UPFRONT = 'FULL_UPFRONT',
  HALF_YEARLY = 'HALF_YEARLY',
  QUARTERLY = 'QUARTERLY',
}

/**
 * Post-MVP Phase (BRD Workflow 13). An AMC Contract is the parent record for a
 * customer's Annual Maintenance Contract: it covers one or more serial-numbered units,
 * runs for a fixed startDate-endDate window, and auto-generates its own Preventive
 * Maintenance (PM) visit schedule as `Appointment` rows (type=AMC) the moment it's
 * created - see AmcService.createContract(). Those generated appointments are capped at
 * 60 per contract (a defensive sanity limit, not a business rule) and deliberately
 * bypass AppointmentsService.create()'s capacity-check gate (AmcService injects the
 * Appointment repository directly) - a signed AMC contract's obligatory maintenance
 * cadence should never be spuriously rejected by an unrelated day's booking load.
 *
 * Billing is separate from the contract record itself - see AmcBillingInvoice. Renewal
 * is a forward-only chain (previousContractId), mirroring Estimate.previousEstimateId:
 * the old contract is marked RENEWED, never mutated in place, so history stays intact.
 *
 * Known limitation (documented, not fixed here): there is no cron/scheduler
 * infrastructure anywhere in this app, so "auto-fire a reminder 30 days before expiry"
 * per the BRD is not actually automatable this pass. AmcController exposes a manual
 * `send-renewal-reminder` endpoint plus a query-based `expiring` list endpoint instead -
 * the same honesty pattern already used for the GL-posting and notification stubs.
 */
@Entity('amc_contracts')
export class AmcContract {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  contractNumber: string;

  @Column()
  customerName: string;

  @Column()
  customerPhone: string;

  @Column({ nullable: true })
  customerEmail: string;

  @Column({ type: 'text', nullable: true })
  customerAddress: string;

  @Column({ type: 'enum', enum: CustomerType, default: CustomerType.B2C })
  customerType: CustomerType;

  @ManyToOne(() => ServiceCentre, { eager: true })
  @JoinColumn({ name: 'serviceCentreId' })
  serviceCentre: ServiceCentre;

  @Column()
  serviceCentreId: string;

  // The unit(s) covered by this contract. A contract can cover more than one serial
  // number (e.g. a fleet/site AMC), so this is a plain string array, not a single field.
  @Column({ type: 'jsonb', default: [] })
  coveredSerialNumbers: string[];

  @Column({ nullable: true })
  brand: string;

  @Column({ nullable: true })
  modelNumber: string;

  @Column({ type: 'enum', enum: CoverageType, default: CoverageType.COMPREHENSIVE })
  coverageType: CoverageType;

  @Column({ nullable: true })
  serviceLevel: string;

  @Column({ type: 'enum', enum: VisitFrequency })
  visitFrequency: VisitFrequency;

  @Column({ type: 'timestamp' })
  startDate: Date;

  @Column({ type: 'timestamp' })
  endDate: Date;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalAmount: number;

  @Column({ type: 'enum', enum: AmcPaymentTerms, default: AmcPaymentTerms.FULL_UPFRONT })
  paymentTerms: AmcPaymentTerms;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'assignedTechnicianId' })
  assignedTechnician: User;

  @Column({ nullable: true })
  assignedTechnicianId: string;

  @Column({ type: 'enum', enum: AmcContractStatus, default: AmcContractStatus.ACTIVE })
  status: AmcContractStatus;

  @Column({ type: 'text', nullable: true })
  cancellationReason: string | null;

  @Column({ type: 'timestamp', nullable: true })
  renewalReminderSentAt: Date | null;

  // Kept as two DISTINCT arrays, never collapsed into one flag - same pattern as
  // Estimate.channelsAttempted/channelsDelivered. See NotificationsService's class doc.
  @Column({ type: 'jsonb', default: [] })
  renewalReminderChannelsAttempted: string[];

  @Column({ type: 'jsonb', default: [] })
  renewalReminderChannelsDelivered: string[];

  // Forward-only renewal chain - see class doc comment above.
  @Column({ type: 'uuid', nullable: true })
  previousContractId: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @Column({ type: 'uuid' })
  createdById: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
