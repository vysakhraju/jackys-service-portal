import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToMany,
  JoinTable,
  OneToMany,
} from 'typeorm';
import { SparePartModel } from './spare-part-model.entity';

@Entity('spare_parts')
@Index(['code'], { unique: true })
@Index(['category'])
export class SparePart {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50, unique: true })
  code: string;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 100 })
  category: string;

  @Column({ length: 100, nullable: true })
  brand: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  unitCost: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  unitPriceB2B: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  unitPriceB2C: number;

  @Column({ default: 0 })
  minStockLevel: number;

  @Column({ default: 0 })
  vanStockLevel: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'jsonb', nullable: true })
  attributes: Record<string, any>;

  @ManyToMany(() => SparePartModel, (model) => model.spareParts)
  @JoinTable({
    name: 'spare_part_models',
    joinColumn: { name: 'sparePartId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'modelId', referencedColumnName: 'id' },
  })
  models: SparePartModel[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}