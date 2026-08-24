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
import { JobCard } from '../../job-cards/entities/job-card.entity';
import { User } from '../../auth/entities/user.entity';

export enum EstimateStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export enum RespondedVia {
  CUSTOMER_LINK = 'CUSTOMER_LINK',
  STAFF_RECORDED = 'STAFF_RECORDED',
}

export enum ContactMethod {
  PHONE_CALL = 'PHONE_CALL',
  WHATSAPP = 'WHATSAPP',
  EMAIL_REPLY = 'EMAIL_REPLY',
  IN_PERSON = 'IN_PERSON',
}

export interface EstimateLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

@Entity('estimates')
@Index(['accessToken'], { unique: true })
export class Estimate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => JobCard)
  @JoinColumn({ name: 'jobCardId' })
  jobCard: JobCard;

  @Column({ type: 'uuid' })
  jobCardId: string;

  @Column({ type: 'jsonb' })
  lineItems: EstimateLineItem[];

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  subtotal: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  vatAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalAmount: number;

  @Column({ type: 'enum', enum: EstimateStatus, default: EstimateStatus.DRAFT })
  status: EstimateStatus;

  // Public shareable-link token (FR-06). Only set once send() is called - a DRAFT has no
  // live link yet, so there's nothing for a customer to guess or replay.
  @Column({ type: 'varchar', length: 64, nullable: true })
  accessToken: string | null;

  @Column({ type: 'timestamp', nullable: true })
  tokenExpiresAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  respondedAt: Date | null;

  @Column({ type: 'enum', enum: RespondedVia, nullable: true })
  respondedVia: RespondedVia | null;

  // Staff-recorded response fields only (null for CUSTOMER_LINK responses).
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'recordedByUserId' })
  recordedByUser: User;

  @Column({ type: 'uuid', nullable: true })
  recordedByUserId: string | null;

  @Column({ type: 'enum', enum: ContactMethod, nullable: true })
  contactMethod: ContactMethod | null;

  // Anti-consent-laundering guard: this must match appointment.customerPhone or
  // appointment.customerEmail exactly (case-insensitive for email) before a
  // staff-recorded response is accepted - see EstimatesService.recordResponse(). Stored
  // here for the audit trail, not re-validated on read.
  @Column({ type: 'varchar', length: 255, nullable: true })
  contactValue: string | null;

  @Column({ type: 'text', nullable: true })
  responseNotes: string | null;

  // Kept as two DISTINCT arrays - never collapse to one "sent" flag. See
  // NotificationsService's class doc comment for why.
  @Column({ type: 'jsonb', default: [] })
  channelsAttempted: string[];

  @Column({ type: 'jsonb', default: [] })
  channelsDelivered: string[];

  // Set when this estimate was created by revise() to replace a rejected one. The
  // previous estimate stays REJECTED permanently - this is a forward-only chain, never
  // mutated after creation.
  @Column({ type: 'uuid', nullable: true })
  previousEstimateId: string | null;

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
