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