import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';

export enum ApplianceCategory {
  REFRIGERATOR = 'REFRIGERATOR',
  WASHING_MACHINE = 'WASHING_MACHINE',
  AC = 'AC',
  MICROWAVE = 'MICROWAVE',
  OVEN = 'OVEN',
  COOKING_RANGE = 'COOKING_RANGE',
  DISHWASHER = 'DISHWASHER',
  WATER_HEATER = 'WATER_HEATER',
  DRYER = 'DRYER',
  OTHER = 'OTHER',
}

@Entity('fault_symptoms')
@Index(['faultCode'], { unique: true })
@Index(['category'])
export class FaultSymptom {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 20, unique: true })
  faultCode: string;

  @Column({ length: 255 })
  faultDescription: string;

  @Column({ length: 20, unique: true })
  symptomCode: string;

  @Column({ length: 255 })
  symptomDescription: string;

  @Column({ type: 'enum', enum: ApplianceCategory })
  category: ApplianceCategory;

  @Column({ default: false })
  requiresWorkshop: boolean;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}