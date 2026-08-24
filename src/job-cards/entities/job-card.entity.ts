import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Appointment } from '../../appointments/entities/appointment.entity';
import { User } from '../../auth/entities/user.entity';
import { WarrantyStatus } from '../../technician/entities/technician-visit.entity';

export enum JobCardStatus {
  OPEN = 'OPEN',
  SN_VALIDATED = 'SN_VALIDATED',
  SECTION_ASSIGNED = 'SECTION_ASSIGNED',
  CANCELLED = 'CANCELLED',
}

export enum JobCardSection {
  ON_SITE_REPAIR = 'ON_SITE_REPAIR',
  WORKSHOP = 'WORKSHOP',
}

@Entity('job_cards')
@Index(['appointmentId'], { unique: true })
export class JobCard {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  jobCardNumber: string;

  @OneToOne(() => Appointment)
  @JoinColumn({ name: 'appointmentId' })
  appointment: Appointment;

  @Column({ type: 'uuid' })
  appointmentId: string;

  @Column({ type: 'enum', enum: JobCardStatus, default: JobCardStatus.OPEN })
  status: JobCardStatus;

  @Column({ type: 'enum', enum: JobCardSection, nullable: true })
  section: JobCardSection | null;

  // Snapshotted from TechnicianVisit at creation time - deliberately NOT re-read live from
  // the visit afterwards, so a Job Card's record of what was found on-site can't silently
  // drift if the visit is ever revisited.
  @Column({ type: 'varchar', length: 100 })
  serialNumber: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  brand: string | null;

  @Column({ type: 'varchar', length: 20 })
  faultCode: string;

  @Column({ type: 'varchar', length: 20 })
  symptomCode: string;

  // Immutable snapshot of the warranty badge the technician captured on-site. Never
  // mutated after creation - `warrantyStatus` below is the effective/current one.
  @Column({ type: 'enum', enum: WarrantyStatus })
  originalWarrantyStatus: WarrantyStatus;

  @Column({ type: 'enum', enum: WarrantyStatus })
  warrantyStatus: WarrantyStatus;

  // Gate 2: a CCE (or above) manually confirms the captured S/N matches the physical
  // invoice. Business rule: "no Job Card without invoice verification."
  @Column({ type: 'boolean', default: false })
  snValidatedAgainstInvoice: boolean;

  @Column({ type: 'text', nullable: true })
  snValidationNotes: string | null;

  // Warranty override (FR-17/AC-18): TL approval required, full audit trail. Can be
  // called more than once - overrideCount tracks how many times, each one also writes an
  // AuditLog row (see JobCardsController) so the full history survives even though this
  // entity itself only holds the *latest* override's details.
  @Column({ type: 'boolean', default: false })
  warrantyOverridden: boolean;

  @Column({ type: 'text', nullable: true })
  warrantyOverrideReason: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'warrantyOverrideBy' })
  warrantyOverrideByUser: User;

  @Column({ type: 'uuid', nullable: true })
  warrantyOverrideBy: string | null;

  @Column({ type: 'timestamp', nullable: true })
  warrantyOverrideAt: Date | null;

  @Column({ type: 'int', default: 0 })
  overrideCount: number;

  // FR-06 stopgap: the real Estimate/shareable-approval-link flow is a later phase. Until
  // then, an OOW job card cannot move to SECTION_ASSIGNED without this manual flag being
  // set by a CCE/TL/above. Deliberately reset to false whenever an override flips the
  // *effective* status to OOW after the fact, so a stale approval can't cover new terms.
  @Column({ type: 'boolean', default: false })
  customerApproved: boolean;

  @Column({ type: 'text', nullable: true })
  customerApprovalNotes: string | null;

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
