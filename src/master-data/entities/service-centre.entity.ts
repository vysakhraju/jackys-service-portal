import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';

export enum Country {
  UAE = 'UAE',
  KSA = 'KSA',
}

@Entity('service_centres')
@Index(['code'], { unique: true })
@Index(['country'])
export class ServiceCentre {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 20, unique: true })
  code: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'enum', enum: Country })
  country: Country;

  @Column({ type: 'text', nullable: true })
  address: string;

  @Column({ length: 50, nullable: true })
  city: string;

  @Column({ type: 'jsonb', default: {} })
  schedule: Record<string, {
    isOpen: boolean;
    startTime: string;
    endTime: string;
    maxJobsPerDay: number;
    breakStart: string;
    breakEnd: string;
  }>;

  @Column({ type: 'jsonb', default: [] })
  assignedTechnicianIds: string[];

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 5.0 })
  vatRate: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}