import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { WarrantyClaim } from './warranty-claim.entity';
import { InventoryReservation } from '../../inventory/entities/inventory-reservation.entity';

/**
 * One line per CONSUMED InventoryReservation swept into a WarrantyClaim by
 * WarrantyClaimsService.aggregate(). `inventoryReservationId` is UNIQUE - this is the
 * mechanism that makes double-claiming structurally impossible: once a reservation has a
 * line here, no future aggregate() run will ever offer it again (see that method's query),
 * and the DB itself would reject a second line for the same reservation even if two
 * aggregate() calls somehow raced past the application-level check.
 *
 * All the descriptive fields below (job card number, serial number, spare part code/name,
 * unit cost) are snapshots taken at the moment this line was created - deliberately never
 * re-read live from JobCard/SparePart afterwards, same reasoning as JobCard.serialNumber's
 * own snapshot: a claim that's already been submitted to (or credited by) a vendor must
 * read exactly as it did at that moment, regardless of what happens to the underlying
 * records later (a warranty override, a spare part's cost being corrected, etc.).
 */
@Entity('warranty_claim_lines')
@Index(['inventoryReservationId'], { unique: true })
export class WarrantyClaimLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => WarrantyClaim, (claim) => claim.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'warrantyClaimId' })
  warrantyClaim: WarrantyClaim;

  @Column({ type: 'uuid' })
  warrantyClaimId: string;

  @ManyToOne(() => InventoryReservation)
  @JoinColumn({ name: 'inventoryReservationId' })
  inventoryReservation: InventoryReservation;

  @Column({ type: 'uuid' })
  inventoryReservationId: string;

  @Column({ type: 'uuid' })
  jobCardId: string;

  @Column({ type: 'varchar', length: 50 })
  jobCardNumber: string;

  @Column({ type: 'varchar', length: 100 })
  serialNumber: string;

  @Column({ type: 'varchar', length: 50 })
  sparePartCode: string;

  @Column({ type: 'varchar', length: 255 })
  sparePartName: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  unitCost: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  lineAmount: number;

  // The moment the underlying reservation became CONSUMED (InventoryReservation.consumedAt)
  // - kept here too so a claim line's own aggregation-period membership stays auditable
  // even after the reservation itself is queried for other purposes.
  @Column({ type: 'timestamp' })
  consumedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
