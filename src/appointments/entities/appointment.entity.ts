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
import { ServiceCentre } from '../../master-data/entities/service-centre.entity';
import { User } from '../../auth/entities/user.entity';
import { JobCard } from '../../job-cards/entities/job-card.entity';

export enum AppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  CONFIRMED = 'CONFIRMED',
  TECHNICIAN_ASSIGNED = 'TECHNICIAN_ASSIGNED',
  ON_SITE = 'ON_SITE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
  RESCHEDULED = 'RESCHEDULED',
}

export enum AppointmentType {
  WARRANTY = 'WARRANTY',
  OUT_OF_WARRANTY = 'OUT_OF_WARRANTY',
  AMC = 'AMC',
  PREVENTIVE = 'PREVENTIVE',
  DISMANTLING = 'DISMANTLING',
}

export enum CustomerType {
  B2C = 'B2C',
  B2B = 'B2B',
  B2B_SALES_CHANNEL = 'B2B_SALES_CHANNEL',
}

@Entity('appointments')
@Index(['serviceCentreId', 'scheduledAt'])
@Index(['technicianId', 'scheduledAt'])
@Index(['status', 'scheduledAt'])
export class Appointment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  appointmentNumber: string;

  @Column({ type: 'enum', enum: AppointmentType })
  type: AppointmentType;

  @Column({ type: 'enum', enum: AppointmentStatus, default: AppointmentStatus.SCHEDULED })
  status: AppointmentStatus;

  @Column({ type: 'enum', enum: CustomerType })
  customerType: CustomerType;

  @Column()
  customerName: string;

  @Column()
  customerPhone: string;

  @Column({ nullable: true })
  customerEmail: string;

  @Column({ nullable: true })
  customerAddress: string;

  @Column({ nullable: true })
  customerCity: string;

  @Column({ nullable: true })
  customerCountry: string;

  @Column({ nullable: true })
  customerVatNumber: string;

  @Column({ nullable: true })
  brand: string;

  @Column({ nullable: true })
  modelNumber: string;

  @Column({ nullable: true })
  serialNumber: string;

  @Column({ nullable: true })
  purchaseDate: Date;

  @Column({ nullable: true })
  invoiceNumber: string;

  @Column({ type: 'text', nullable: true })
  problemDescription: string;

  @Column({ nullable: true })
  preferredDate: Date;

  @Column({ nullable: true })
  preferredTimeSlot: string;

  @Column()
  scheduledAt: Date;

  @Column({ nullable: true })
  estimatedDurationMinutes: number;

  @Column({ nullable: true })
  actualStartAt: Date;

  @Column({ nullable: true })
  actualEndAt: Date;

  @Column({ nullable: true })
  notes: string;

  @Column({ nullable: true })
  cancellationReason: string;

  @ManyToOne(() => ServiceCentre, { eager: true })
  @JoinColumn({ name: 'serviceCentreId' })
  serviceCentre: ServiceCentre;

  @Column()
  serviceCentreId: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'technicianId' })
  technician: User;

  @Column({ nullable: true })
  technicianId: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @Column({ nullable: true })
  createdById: string;

  @OneToMany(() => JobCard, (jobCard) => jobCard.appointment)
  jobCards: JobCard[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}