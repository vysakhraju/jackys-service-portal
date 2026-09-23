import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { AppointmentActivity } from './appointment-activity.entity';
import { User } from '../../auth/entities/user.entity';
// Reuses the job-cards module's TaskPauseReason as-is (a plain type-only import, not a
// NestJS module import - safe the same way appointment.entity.ts already imports JobCard
// directly from job-cards/entities) rather than inventing a second, appointment-scoped
// reason enum for what is conceptually the same "why did the clock stop" question a Job
// Card's own task timer already answers. This app already lived through the two-copies-
// drift bug that duplicating an enum like this caused once before (the ACTIVITY
// appointment-type incident, see STATUS_TRACKER.md and appointment.entity.ts's own
// JobType-consolidation comment) - importing the single source of truth is the deliberate
// fix for that lesson, not an oversight. The request's own "carry-forward-to-next-day"
// framing for a pause maps cleanly onto BREAK/OTHER + a free-text note below, not a
// distinct reason code of its own.
import { TaskPauseReason } from '../../job-cards/entities/job-card-task-pause.entity';
export { TaskPauseReason };

// Job Type split (2026-09-22) Phase 8. One row per pause on an AppointmentActivity -
// exact same shape/rules as JobCardTaskPause (see that entity's own doc comment): never a
// stored "is this activity currently paused" flag, always derived by finding the row (if
// any) with resumedAt IS NULL.
@Entity('appointment_activity_pauses')
@Index(['appointmentActivityId', 'resumedAt'])
export class AppointmentActivityPause {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => AppointmentActivity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'appointmentActivityId' })
  appointmentActivity: AppointmentActivity;

  @Column({ type: 'uuid' })
  appointmentActivityId: string;

  @Column({ type: 'enum', enum: TaskPauseReason })
  reason: TaskPauseReason;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'pausedByUserId' })
  pausedByUser: User;

  @Column({ type: 'uuid' })
  pausedByUserId: string;

  @CreateDateColumn()
  pausedAt: Date;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'resumedByUserId' })
  resumedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  resumedByUserId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  resumedAt: Date | null;
}
