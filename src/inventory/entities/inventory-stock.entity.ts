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
  // Only location populated in Phase 5. Schema allows more (van stock, damage location,
  // per-service-centre stores) to be added later as data, not a code change - see
  // InventoryReservation.custodianUserId for how technician custody is modeled instead
  // of a location row per technician (dynamic with technician count, per design).
  MAIN_STORE = 'MAIN_STORE',
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
  // transaction. The ONLY method allowed to change quantityOnHand is confirmReturn() /
  // grn() - everything else (job cancellation, TL-approved reallocation, a technician's
  // own return request) only moves a reservation to RETURN_PENDING and never touches
  // this column. See InventoryService for the full invariant.
  @Column({ type: 'int', default: 0 })
  quantityReserved: number;

  @UpdateDateColumn()
  lastUpdatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
