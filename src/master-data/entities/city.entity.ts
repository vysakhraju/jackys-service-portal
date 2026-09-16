import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

// Appointment/Mobile/Job Card overhaul (2026-09-16), req. 1c: backs the New Appointment
// popup's City dropdown. Seeded with the 7 UAE emirates named in the request (DXB, SHJ,
// AUH, AL-AIN, RAK, UAQ, FUJ) but deliberately a real admin-manageable master, not a fixed
// enum - the request explicitly asked for Super Admin to be able to add/deactivate/delete
// entries. Purely descriptive - NOT used for any VAT calculation (that stays Service
// Centre-driven, unchanged - see the spec doc's decision #5).
@Entity('cities')
@Index(['name'], { unique: true })
export class City {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
