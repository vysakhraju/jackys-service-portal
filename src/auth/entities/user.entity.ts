import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Role } from './role.entity';
import { AuditLog } from './audit-log.entity';
import { Exclude } from 'class-transformer';

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
}

@Entity('users')
@Index(['email'], { unique: true })
@Index(['employeeId'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  firstName: string;

  @Column({ length: 100 })
  lastName: string;

  @Column({ length: 255, unique: true })
  email: string;

  @Column({ length: 50, unique: true, nullable: true })
  employeeId: string;

  @Column({ length: 20, nullable: true })
  phone: string;

  @Exclude()
  @Column({ select: false })
  passwordHash: string;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @Column({ type: 'jsonb', nullable: true })
  preferences: Record<string, any>;

  @Column({ nullable: true })
  lastLoginAt: Date;

  @Column({ nullable: true })
  refreshTokenHash: string;

  @ManyToOne(() => Role, (role) => role.users, { eager: true })
  @JoinColumn({ name: 'roleId' })
  role: Role;

  @Column({ type: 'uuid' })
  roleId: string;

  // Field/workshop technician scheduling split (2026-09-10): only meaningful for a
  // TECHNICIAN_WORKSHOP user - a planning-visibility number CCE/TL set per technician for
  // the Workshop Queue board, NOT an enforced cap. Per the business's own decision, a unit
  // that physically arrives at capacity still gets accepted and queues (FIFO via
  // JobCard.workshopAssignedAt) - this column only drives the queue's over/under-capacity
  // gauge, it never blocks WorkshopService.assign()/reassign(). Defaults to 6, the same
  // number appointment-scheduling-grid.util.ts's DAILY_TECHNICIAN_APPOINTMENT_CAP already
  // uses for field technicians, for a consistent "6 open jobs" mental model across both
  // technician types even though the two caps mean different things (hard cap vs. gauge).
  @Column({ type: 'int', default: 6 })
  workshopDailyCapacity: number;

  @OneToMany(() => AuditLog, (audit) => audit.user)
  auditLogs: AuditLog[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  get fullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }
}