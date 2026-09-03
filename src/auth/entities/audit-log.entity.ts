import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum AuditAction {
  CREATE = 'CREATE',
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  CANCEL = 'CANCEL',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  ROLE_CHANGE = 'ROLE_CHANGE',
  STATUS_CHANGE = 'STATUS_CHANGE',
  WARRANTY_OVERRIDE = 'WARRANTY_OVERRIDE',
  INVENTORY_RESERVE = 'INVENTORY_RESERVE',
  INVENTORY_DEDUCT = 'INVENTORY_DEDUCT',
  ESTIMATE_APPROVE = 'ESTIMATE_APPROVE',
  ESTIMATE_REJECT = 'ESTIMATE_REJECT',
  PAYMENT_RECORD = 'PAYMENT_RECORD',
  INVOICE_FINALIZE = 'INVOICE_FINALIZE',
  // Phase 6
  QC_APPROVE = 'QC_APPROVE',
  QC_REJECT = 'QC_REJECT',
  PERMISSION_GRANT = 'PERMISSION_GRANT',
  PERMISSION_REVOKE = 'PERMISSION_REVOKE',
  // Phase 7
  DELIVERY_DISPATCH = 'DELIVERY_DISPATCH',
  DELIVERY_POD = 'DELIVERY_POD',
  // Extra role access grants (2026-09-03)
  ROLE_ACCESS_GRANT = 'ROLE_ACCESS_GRANT',
  ROLE_ACCESS_REVOKE = 'ROLE_ACCESS_REVOKE',
}

@Entity('audit_logs')
@Index(['entityType', 'entityId'])
@Index(['userId', 'createdAt'])
@Index(['action', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: AuditAction })
  action: AuditAction;

  @Column({ length: 100 })
  entityType: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  entityId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  oldValues: Record<string, any> | null;

  @Column({ type: 'jsonb', nullable: true })
  newValues: Record<string, any> | null;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ nullable: true })
  ipAddress: string;

  @Column({ nullable: true })
  userAgent: string;

  @ManyToOne(() => User, (user) => user.auditLogs)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid', nullable: true })
  userId: string;

  @CreateDateColumn()
  createdAt: Date;
}
