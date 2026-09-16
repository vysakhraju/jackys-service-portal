import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToOne, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Appointment } from '../../appointments/entities/appointment.entity';
import { User } from '../../auth/entities/user.entity';
import { WarrantyStatus } from '../../technician/entities/technician-visit.entity';

/**
 * Appointment/Mobile/Job Card overhaul Phase 4 (2026-09-16) - see
 * claude/APPOINTMENT_MOBILE_JOBCARD_SPEC.md section 3.4. A `COLLECTED_TO_WS` appointment
 * was never visited on-site (the unit was collected from the field, or walked in/driven
 * in, straight to the workshop), so it has no TechnicianVisit row - JobCardsService.create()
 * can never read serial number/warranty/fault/symptom from one for these. This is the
 * workshop equivalent: the same FR-02/FR-03/FR-04 data (minus GPS, which has no meaning for
 * a unit that's already inside the workshop), captured on the WEB by a role holding
 * `WORKSHOP_INTAKE_SN_VALIDATE` instead of on mobile by the field technician.
 *
 * One row per Appointment (upsert on re-capture, same pattern as TechnicianVisit) - created
 * by the "Mark Received" step (`receivedByUserId`/`receivedAt`), then filled in by the
 * serial-number and fault/symptom capture steps. JobCardsService.create() reads this row
 * instead of TechnicianVisit whenever the originating appointment is COLLECTED_TO_WS.
 */
@Entity('workshop_intakes')
@Index(['appointmentId'], { unique: true })
export class WorkshopIntake {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Appointment)
  @JoinColumn({ name: 'appointmentId' })
  appointment: Appointment;

  @Column({ type: 'uuid' })
  appointmentId: string;

  // "Mark Received" - who logged this unit as physically arrived at the workshop, and when.
  @ManyToOne(() => User)
  @JoinColumn({ name: 'receivedByUserId' })
  receivedBy: User;

  @Column({ type: 'uuid' })
  receivedByUserId: string;

  @Column({ type: 'timestamp' })
  receivedAt: Date;

  // --- Serial Number capture + Warranty Master lookup (mirrors TechnicianVisit FR-03) ---
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

  // --- Fault Code + Symptom Code, only recordable once S/N is captured (mirrors FR-04) ---
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
