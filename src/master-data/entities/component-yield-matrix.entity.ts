import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum RecoveryCategory {
  RECOVERABLE_SPARE = 'RECOVERABLE_SPARE',
  CONSUMABLE = 'CONSUMABLE',
  SCRAP = 'SCRAP',
}

@Entity('component_yield_matrix')
@Index(['modelId', 'originalBomItemCode'])
export class ComponentYieldMatrix {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50 })
  modelId: string;

  @Column({ length: 100 })
  originalBomItemCode: string;

  @Column({ length: 255 })
  itemName: string;

  @Column({ type: 'enum', enum: RecoveryCategory })
  category: RecoveryCategory;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  defaultRecoveryEvaluation: number;

  @Column({ length: 50, nullable: true })
  convertedSparePartCode: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}