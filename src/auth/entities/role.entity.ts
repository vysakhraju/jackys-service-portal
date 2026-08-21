import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { User } from './user.entity';

export enum RoleName {
  SUPER_ADMIN = 'SUPER_ADMIN',
  SERVICE_HEAD = 'SERVICE_HEAD',
  TECHNICAL_TEAM_LEADER = 'TECHNICAL_TEAM_LEADER',
  CCE = 'CCE',
  TECHNICIAN_FIELD = 'TECHNICIAN_FIELD',
  TECHNICIAN_WORKSHOP = 'TECHNICIAN_WORKSHOP',
  QC_OFFICER = 'QC_OFFICER',
  ACCOUNTANT = 'ACCOUNTANT',
  FINANCE_MANAGER = 'FINANCE_MANAGER',
  LOGISTICS_DISPATCHER = 'LOGISTICS_DISPATCHER',
  DRIVER = 'DRIVER',
  WAREHOUSE_CLERK = 'WAREHOUSE_CLERK',
  WARRANTY_CLERK = 'WARRANTY_CLERK',
  CUSTOMER = 'CUSTOMER',
}

@Entity('roles')
@Index(['name'], { unique: true })
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: RoleName, unique: true })
  name: RoleName;

  @Column({ length: 255 })
  displayName: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'jsonb', default: [] })
  permissions: string[];

  @Column({ default: false })
  isSystem: boolean;

  @OneToMany(() => User, (user) => user.role)
  users: User[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}