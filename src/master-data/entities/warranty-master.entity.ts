import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('warranty_master')
@Index(['serialNumberRange', 'brand', 'model'])
export class WarrantyMaster {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  serialNumberRange: string;

  @Column({ length: 100 })
  brand: string;

  @Column({ length: 100 })
  model: string;

  @Column({ type: 'int' })
  warrantyPeriodMonths: number;

  @Column({ length: 100 })
  supplier: string;

  @Column({ type: 'date', nullable: true })
  effectiveFrom: Date;

  @Column({ type: 'date', nullable: true })
  effectiveTo: Date;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}