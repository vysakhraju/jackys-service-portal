import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { JobCard } from './job-card.entity';
import { User } from '../../auth/entities/user.entity';

// Reason codes selected when a task timer pauses - either by a technician (manual pause)
// or by the system itself (MATERIAL_SHORTAGE only, auto-opened/closed from
// JobCardsService.setSparePending()/resumeFromSparePending() - see those methods).
// MATERIAL_SHORTAGE is the only SLA-exempt reason (SLA_EXEMPT_PAUSE_REASONS below):
// OperationalReportsService.getSlaBreach() subtracts only its paused duration from the
// elapsed-hours calculation, since a job waiting on the warehouse isn't the service
// centre being slow. Every other reason still counts against SLA, but is tracked here so
// it finally shows up in that report - see its class doc comment, which flags "reason
// codes... are not tracked" as a known, deliberate gap this fills.
export enum TaskPauseReason {
  MATERIAL_SHORTAGE = 'MATERIAL_SHORTAGE',
  AWAITING_CUSTOMER_APPROVAL = 'AWAITING_CUSTOMER_APPROVAL',
  CUSTOMER_UNAVAILABLE = 'CUSTOMER_UNAVAILABLE',
  BREAK = 'BREAK',
  OTHER = 'OTHER',
}

export const SLA_EXEMPT_PAUSE_REASONS: ReadonlySet<TaskPauseReason> = new Set([TaskPauseReason.MATERIAL_SHORTAGE]);

// One row per pause. Deliberately never a stored boolean/flag on JobCard - "is this job
// currently paused" is always a computed property, derived by querying for a row on this
// job with resumedAt IS NULL (this codebase's established "computed, never stored"
// philosophy - see job-card-progress.util.ts's doc comment on lane/nextStepText).
// autoCreated distinguishes a MATERIAL_SHORTAGE pause the system opened itself from a
// technician's own manual pause/resume call - purely informational for display, doesn't
// change how the row is treated by the SLA calculation.
@Entity('job_card_task_pauses')
@Index(['jobCardId', 'resumedAt'])
export class JobCardTaskPause {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => JobCard, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobCardId' })
  jobCard: JobCard;

  @Column({ type: 'uuid' })
  jobCardId: string;

  @Column({ type: 'enum', enum: TaskPauseReason })
  reason: TaskPauseReason;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // Null for a system-auto-created MATERIAL_SHORTAGE pause - nobody manually paused it.
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'pausedByUserId' })
  pausedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  pausedByUserId: string | null;

  @CreateDateColumn()
  pausedAt: Date;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'resumedByUserId' })
  resumedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  resumedByUserId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  resumedAt: Date | null;

  @Column({ type: 'boolean', default: false })
  autoCreated: boolean;
}
