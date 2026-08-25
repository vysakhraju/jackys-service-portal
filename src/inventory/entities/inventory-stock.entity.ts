import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SparePart } from '../../master-data/entities/spare-part.entity';

export enum InventoryLocation {
  // Where stock lives while it's genuinely available to reserve.
  MAIN_STORE = 'MAIN_STORE',
  // Phase 6 (FR-10): where a spare's quantity moves TO when a Job Card QC-passes and its
  // reservations are permanently consumed - "Main Store -> Damage Location" per the spec.
  // Modeled as a real second InventoryStock row (same shape, different location) rather
  // than just decrementing MAIN_STORE, so consumption is a real double-entry movement:
  // the numbers always balance and "how much of X did we actually use" stays queryable
  // without mining audit logs. See InventoryService.consumeReservationsOnQcApproval().
  DAMAGE_LOCATION = 'DAMAGE_LOCATION',
}

@Entity('inventory_stock')
@Index(['sparePartId', 'location'], { unique: true })
export class InventoryStock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => SparePart)
  @JoinColumn({ name: 'sparePartId' })
  sparePart: SparePart;

  @Column({ type: 'uuid' })
  sparePartId: string;

  @Column({ type: 'enum', enum: InventoryLocation, default: InventoryLocation.MAIN_STORE })
  location: InventoryLocation;

  @Column({ type: 'int', default: 0 })
  quantityOnHand: number;

  // Denormalized running total of everything currently HELD/PARTIALLY_RESERVED against
  // this stock row. Available-to-reserve = quantityOnHand - quantityReserved. Kept on the
  // stock row itself (not derived by summing reservations on every read) so
  // InventoryService.reserve() can check + update it inside one advisory-locked
  // transaction. Only MAIN_STORE rows ever carry a nonzero quantityReserved -
  // DAMAGE_LOCATION only ever receives quantityOnHand from consumption.
  @Column({ type: 'int', default: 0 })
  quantityReserved: number;

  @UpdateDateColumn()
  lastUpdatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
