import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

// Appointment/Mobile/Job Card overhaul (2026-09-16), req. 3f: backs the mobile
// Cancellation action's reason dropdown. Seeded with "Customer not available", "Not
// agreed for repair", "BER" as named in the request; admin-manageable so more reasons
// can be added later without a code change.
@Entity('cancellation_reasons')
@Index(['label'], { unique: true })
export class CancellationReason {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 150 })
  label: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
