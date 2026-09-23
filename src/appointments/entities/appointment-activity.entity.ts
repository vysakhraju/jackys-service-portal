import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToOne, ManyToOne, JoinColumn } from 'typeorm';
import { Appointment } from './appointment.entity';
import { User } from '../../auth/entities/user.entity';

// Job Type split (2026-09-22) Phase 8 - lightweight activity tracking for the field
// technician's Start Work / Pause / Resume / Activity Finished flow on Installation/
// Delivery Installation appointments. These 2 job types skip the REPAIR flow's
// TechnicianVisit/on-site Job Card entirely (they come from a separate ERP process, no
// S/N validation or fault/symptom capture applies) until Phase 10's own Job Card
// creation path exists for them - this is the minimum record needed to answer "has work
// started, is it paused, is it finished" in the meantime.
//
// One row per appointment (unique appointmentId), not a session log - mirrors
// TechnicianVisit's own one-row-per-appointment shape. Point 8 of the original request
// ("block starting a NEW activity until the current one is marked finished") is a
// cross-appointment guard enforced in AppointmentsService.startActivity() by querying for
// any OTHER open row belonging to the same technician, not something this entity itself
// needs to represent.
//
// "Currently paused"/"in progress"/"finished" is never a stored status column - same
// "computed, never stored" philosophy as JobCardTaskPause/job-card-progress.util.ts (see
// appointment-activity-progress.util.ts#computeActivityStatus) - derived from
// finishedAt plus whether an AppointmentActivityPause row with resumedAt IS NULL exists.
@Entity('appointment_activities')
export class AppointmentActivity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Appointment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'appointmentId' })
  appointment: Appointment;

  @Column({ type: 'uuid', unique: true })
  appointmentId: string;

  @CreateDateColumn()
  startedAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'startedByUserId' })
  startedByUser: User;

  @Column({ type: 'uuid' })
  startedByUserId: string;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'finishedByUserId' })
  finishedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  finishedByUserId: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
