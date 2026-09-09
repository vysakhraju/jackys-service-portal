import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { JobCard } from './job-card.entity';
import { User } from '../../auth/entities/user.entity';

/**
 * A second (or third...) technician helping on a Job Card, on top of its single
 * `assignedWorkshopTechnicianId` - added 2026-09-09 for the Gantt-style technician
 * assignment board's "add crew helper" action. Deliberately its own row per helper
 * (many-to-one on jobCardId) rather than a second FK column on JobCard, since a job can
 * need more than one extra pair of hands and this codebase already prefers "a status, not
 * a hard delete" for anything that needs an audit trail (see DeliveryStatus.CANCELLED's
 * own doc comment for the precedent) - `removedAt` follows the same idea rather than
 * deleting the row when a helper is taken off a job.
 *
 * Deliberately WORKSHOP-only for now: field (on-site) appointments already carry a single
 * `technicianId` with existing double-booking prevention
 * (AppointmentsService.checkTechnicianAvailability) - a "helper on a field visit" concept
 * would need its own design (a second person travelling to the same address) and wasn't
 * part of what was asked for; can be extended later if that need comes up.
 */
@Entity('job_card_crew_helpers')
@Index(['jobCardId', 'removedAt'])
export class JobCardCrewHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => JobCard, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobCardId' })
  jobCard: JobCard;

  @Column({ type: 'uuid' })
  jobCardId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'technicianId' })
  technician: User;

  @Column({ type: 'uuid' })
  technicianId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'addedByUserId' })
  addedBy: User;

  @Column({ type: 'uuid' })
  addedByUserId: string;

  @CreateDateColumn()
  addedAt: Date;

  // Who took the helper off the job, and when - null while still actively helping. Kept
  // as a row (not deleted) so the Job Card Journey / audit trail can still show "X helped
  // on this job from ... to ..." after the fact.
  @Column({ type: 'uuid', nullable: true })
  removedByUserId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  removedAt: Date | null;
}
