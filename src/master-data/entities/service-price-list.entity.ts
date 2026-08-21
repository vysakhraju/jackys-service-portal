import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum ServiceActivityType {
  INSTALL = 'INSTALL',
  REPAIR = 'REPAIR',
  DEMO = 'DEMO',
  ON_SITE = 'ON_SITE',
  PM = 'PM',
  DISMANTLE = 'DISMANTLE',
}

@Entity('service_price_lists')
@Index(['activityType', 'modelId'])
export class ServicePriceList {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ServiceActivityType })
  activityType: ServiceActivityType;

  @Column({ length: 50, nullable: true })
  modelId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  priceB2B: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  priceB2C: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  warrantyLaborCost: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  interdepartmentLaborCost: number;

  @Column({ length: 100, nullable: true })
  currency: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}