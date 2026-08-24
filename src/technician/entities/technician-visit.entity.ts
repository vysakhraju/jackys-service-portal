import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Appointment } from '../../appointments/entities/appointment.entity';
import { User } from '../../auth/entities/user.entity';

/**
 * IW/OOW badge shown to the technician after Serial Number validation (FR-03).
 */
export enum WarrantyStatus {
  IN_WARRANTY = 'IW',
  OUT_OF_WARRANTY = 'OOW',
}

/**
 * Captures everything a Field Technician records during an on-site visit, ahead of
 * Job Card creation (Phase 3): GPS + timestamp at visit start (FR-02), Serial Number
 * + warranty check (FR-03), and Fault/Symptom codes gated on a validated S/N (FR-04).
 *
 * One row per Appointment (a technician can restart/re-capture; we upsert rather than
 * append). Phase 3's Job Card module will read this row to decide IW/OOW routing and
 * block Job Card creation when the S/N was never captured (FR-05).
 */
@Entity('technician_visits')
@Index(['appointmentId'], { unique: true })
@Index(['technicianId'])
export class TechnicianVisit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Appointment)
  @JoinColumn({ name: 'appointmentId' })
  appointment: Appointment;

  @Column({ type: 'uuid' })
  appointmentId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'technicianId' })
  technician: User;

  @Column({ type: 'uuid' })
  technicianId: string;

  // --- FR-02: GPS + timestamp captured when the technician starts the visit ---
  @Column({ type: 'decimal', precision: 10, scale: 7 })
  startGpsLat: number;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  startGpsLng: number;

  @Column()
  startedAt: Date;

  // --- FR-03: Serial Number capture + Warranty Master lookup ---
  // Explicit `type` on every nullable `X | null` column below: TypeORM's reflect-metadata
  // inference reads a union type as "Object" and throws DataTypeNotSupportedError without it
  // (same issue fixed on AuditLog.entityId/oldValues/newValues in Phase 1).
  @Column({ type: 'varchar', length: 100, nullable: true })
  serialNumber: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  brand: string | null;

  @Column({ type: 'enum', enum: WarrantyStatus, nullable: true })
  warrantyStatus: WarrantyStatus | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  warrantySupplier: string | null;

  @Column({ type: 'int', nullable: true })
  warrantyPeriodMonths: number | null;

  @Column({ type: 'timestamp', nullable: true })
  serialNumberCapturedAt: Date | null;

  // --- FR-04: Fault Code + Symptom Code, only recordable once S/N is captured ---
  @Column({ type: 'varchar', length: 20, nullable: true })
  faultCode: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  symptomCode: string | null;

  @Column({ type: 'timestamp', nullable: true })
  faultSymptomCapturedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
