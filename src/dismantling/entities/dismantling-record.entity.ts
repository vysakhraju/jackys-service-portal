import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { RecoveryCategory } from '../../master-data/entities/component-yield-matrix.entity';

/**
 * BRD Workflow 15 (v2.1, Defective/DOA Appliance Dismantling & Component Recovery), FR-19,
 * AC-29/AC-30/AC-31. Pre-condition per the BRD: "The appliance exists in the 'Damage
 * Location / Return Stock' warehouse and has been officially flagged as a Defective, DOA
 * or DAP unit." Deliberately standalone from JobCard - this is recovery of a whole
 * write-off appliance already sitting in damage stock, not a step of an active repair.
 *
 * ASSUMPTION (documented, not silently swallowed): the BRD's "system stock should be
 * available" (step 15.1) and AC-30's "reduce the appliance asset count in the Damage
 * Location" both imply a whole-appliance inventory ledger (how many defective units of
 * this model currently sit in Damage Location) - no such ledger exists anywhere in this
 * codebase (InventoryStock/InventoryLocation.DAMAGE_LOCATION tracks SPARE PART quantities
 * consumed off a repair, never whole appliances). Rather than invent a parallel
 * appliance-asset-count entity nothing else references, this record's own existence is
 * treated as ex-post documentation that a physical, already-inspected (offline, steps
 * 15.1-15.3) defective appliance is being dismantled - the same simplification this
 * project already applies elsewhere (e.g. an AMC visit's customer signature is captured,
 * not validated against anything). A real appliance-asset ledger, if ever needed for a
 * "how many DOA units are currently in Damage Location" report, can be derived later from
 * DismantlingRecord rows not yet POSTED, or added as a proper entity - not invented here
 * as a guess.
 *
 * Status machine (PENDING_HARVEST -> COMPONENTS_LOGGED -> VERIFIED -> POSTED) exists
 * specifically to satisfy AC-31's three-distinct-actor audit trail (harvest, verify,
 * price+post) - the BRD's own 6-step table blends "Technician / Team Leader" across
 * 15.1-15.3, but AC-31 explicitly names three separate people ("the technician who
 * harvested the part, the supervisor who verified it, and the manager who priced it"), so
 * DismantlingService enforces verifiedByUserId != harvestedByUserId and
 * pricedByUserId != harvestedByUserId - a real segregation-of-duties gate, not just three
 * optional columns.
 *
 * harvestedComponents is a jsonb snapshot array, not a child table - mirrors the
 * Estimate.lineItems / GlPosting-adjacent "small, self-contained, doesn't need its own
 * repository" precedent already used elsewhere in this codebase. Each entry starts with
 * only what step 15.3 captures (originalBomItemCode, testedCondition, quantity), gets
 * itemName/category/convertedSparePartCode snapshotted from ComponentYieldMatrix at
 * harvest time (so a later master-data edit can't retroactively change what a harvested
 * unit "was" at the time), and gets selectedForConversion/recoveryUnitPrice/
 * convertedSparePartId filled in only at price-and-post time (AC-39: no financial value or
 * live-inventory entry before the Service Manager explicitly prices and authorizes it).
 */
export enum DismantlingStatus {
  PENDING_HARVEST = 'PENDING_HARVEST',
  COMPONENTS_LOGGED = 'COMPONENTS_LOGGED',
  VERIFIED = 'VERIFIED',
  // Terminal (success): inventory adjusted, GL posted, all three AC-31 actors recorded.
  POSTED = 'POSTED',
  // Terminal (abandoned): e.g. the physical inspection found nothing worth recovering.
  CANCELLED = 'CANCELLED',
}

export enum HarvestedComponentCondition {
  GOOD_WORKING = 'GOOD_WORKING',
  DAMAGED = 'DAMAGED',
}

export interface HarvestedComponent {
  originalBomItemCode: string;
  // Snapshotted from ComponentYieldMatrix at harvest time (nullable - a component the
  // technician logs may not have a matching master-data row yet, which is itself useful
  // signal: it can never be selected for conversion at price-and-post since there's no
  // convertedSparePartCode to resolve).
  itemName: string | null;
  category: RecoveryCategory | null;
  convertedSparePartCode: string | null;
  testedCondition: HarvestedComponentCondition;
  quantity: number;
  // Consumables are excluded from selection per BRD step 15.5 - enforced in the service,
  // reflected here so the read model shows exactly what was and wasn't eligible.
  eligibleForConversion: boolean;
  // Everything below stays null/false until price-and-post (AC-39).
  selectedForConversion: boolean;
  recoveryUnitPrice: number | null;
  quantityConverted: number | null;
  convertedSparePartId: string | null;
}

@Entity('dismantling_records')
@Index(['applianceSerialNumber'])
export class DismantlingRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  recordNumber: string;

  @Column({ type: 'varchar', length: 100 })
  applianceSerialNumber: string;

  // Plain string, not a FK - mirrors ComponentYieldMatrix.modelId, which this record's
  // harvest step joins against (BOM lookup is by modelId + originalBomItemCode).
  @Column({ type: 'varchar', length: 50 })
  modelId: string;

  @Column({ type: 'text', nullable: true })
  damageLocationNotes: string | null;

  @Column({ type: 'enum', enum: DismantlingStatus, default: DismantlingStatus.PENDING_HARVEST })
  status: DismantlingStatus;

  @Column({ type: 'jsonb', default: [] })
  harvestedComponents: HarvestedComponent[];

  // Step 15.1 actor.
  @ManyToOne(() => User)
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @Column({ type: 'uuid' })
  createdById: string;

  // AC-31 actor #1: "the technician who harvested the part."
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'harvestedByUserId' })
  harvestedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  harvestedByUserId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  harvestedAt: Date | null;

  // AC-31 actor #2: "the supervisor who verified it" - must differ from harvestedByUserId
  // (enforced in DismantlingService.verify()).
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'verifiedByUserId' })
  verifiedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  verifiedByUserId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  verifiedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  verificationNotes: string | null;

  // AC-31 actor #3: "the manager who priced it" - the Service Manager who does BOM-to-
  // spare conversion, manual pricing, AND final posting in one combined action (BRD step
  // 15.6 is one screen/action, not two) - must differ from both actors above.
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'pricedByUserId' })
  pricedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  pricedByUserId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  postedAt: Date | null;

  // Sum of (quantityConverted * recoveryUnitPrice) across every converted component -
  // snapshotted at posting time, also the amount posted to the GL (GlSourceType.
  // DISMANTLING_RECOVERY).
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalRecoveredValue: number;

  @Column({ type: 'text', nullable: true })
  cancellationReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
