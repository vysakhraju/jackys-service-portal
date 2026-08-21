import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
} from 'typeorm';
import { SparePart } from './spare-part.entity';

@Entity('spare_part_models')
export class SparePartModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50, unique: true })
  modelId: string;

  @Column({ length: 100 })
  brand: string;

  @Column({ length: 100 })
  modelName: string;

  @Column({ type: 'jsonb', default: {} })
  attributes: Record<string, any>;

  @ManyToMany(() => SparePart, (sparePart) => sparePart.models)
  spareParts: SparePart[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}