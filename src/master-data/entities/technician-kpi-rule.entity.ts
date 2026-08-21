import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('technician_kpi_rules')
@Index(['kpiName'], { unique: true })
export class TechnicianKpiRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100, unique: true })
  kpiName: string;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  weightage: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  target: number;

  @Column({ type: 'int' })
  incentivePoints: number;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}