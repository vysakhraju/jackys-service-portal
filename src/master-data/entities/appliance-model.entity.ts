import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ApplianceCategory } from './fault-symptom.entity';

// Appointment/Mobile/Job Card overhaul (2026-09-16), req. 1e: the appliance brand/model
// SKU master backing the New Appointment popup's Brand + Model dropdowns. Deliberately
// separate from SparePartModel (that master is spare-part-specific, keyed by a business
// modelId string used by Price Lists/Component Yield - see those DTOs' @IsString
// modelId validation - and is the wrong shape for "what appliance is this appointment
// for"). Columns kept minimal per the request ("columns we can decide later or add
// later") - brand/model/description now, extensible via bulkImportFromCsv (CSV/Excel)
// or the plain CRUD API, same pattern as every other master here.
@Entity('appliance_models')
@Index(['brand', 'model'], { unique: true })
export class ApplianceModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  brand: string;

  @Column({ length: 100 })
  model: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // Req #301 (2026-09-21): links this model to the Fault & Symptoms master's own category
  // enum, so the appointment's chosen model can filter which fault/symptom rows show in
  // the picker. Nullable - the models seeded before this field existed have none set yet;
  // callers treat a null category as "show everything, not nothing" (see fault-symptom
  // picker), not as a dead end.
  @Column({ type: 'enum', enum: ApplianceCategory, nullable: true })
  category: ApplianceCategory | null;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
