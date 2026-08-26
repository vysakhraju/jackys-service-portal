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

/**
 * FR-15/AC-15: "Interdepartment warranty job passes QC -> Internal Debit Note (spare
 * cost + internal labor rate)." A Debit Note is the internal-recharge counterpart to
 * Invoice: it exists ONLY for a Job Card whose Appointment.customerType is
 * B2B_SALES_CHANNEL AND whose (effective) warrantyStatus is IN_WARRANTY. Every other
 * combination (B2C/B2B of either warranty status, or a B2B_SALES_CHANNEL job that's OOW)
 * is billed the normal way through Invoice instead - an OOW job always means "the
 * external customer/channel owes money", which is exactly what Invoice already models;
 * a Debit Note is specifically for recharging a warranty repair internally between
 * departments, where no external customer invoice exists at all.
 *
 * sparePartsCost is the sum of unitCost * quantityReserved across every CONSUMED
 * InventoryReservation for this Job Card (the same reservations Phase 6's QC-approval
 * step permanently moved Main Store -> Damage Location) - i.e. what this repair actually
 * cost the company in parts, not what a customer would have been charged
 * (unitPriceB2B/B2C). laborCost is looked up from ServicePriceList.interdepartmentLaborCost
 * (see DebitNotesService.resolveLaborCost for the matching rule and its documented
 * assumption, since no direct Job-Card-to-ServicePriceList link exists yet).
 *
 * Lazily created on first read (mirrors Invoice's getOrCreateForJobCard exactly, same
 * race-safety via the unique index + 23505 retry) - never touches Phase 6's QC-approval
 * code path.
 */
export enum DebitNoteStatus {
  DRAFT = 'DRAFT',
  POSTED = 'POSTED',
}

@Entity('debit_notes')
@Index(['jobCardId'], { unique: true })
export class DebitNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  debitNoteNumber: string;

  @ManyToOne(() => JobCard)
  @JoinColumn({ name: 'jobCardId' })
  jobCard: JobCard;

  @Column({ type: 'uuid' })
  jobCardId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  sparePartsCost: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  laborCost: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalAmount: number;

  @Column({ type: 'enum', enum: DebitNoteStatus, default: DebitNoteStatus.DRAFT })
  status: DebitNoteStatus;

  @Column({ type: 'timestamp', nullable: true })
  postedAt: Date | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'postedByUserId' })
  postedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  postedByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
