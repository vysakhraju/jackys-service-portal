import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  DismantlingRecord,
  DismantlingStatus,
  HarvestedComponent,
  HarvestedComponentCondition,
} from './entities/dismantling-record.entity';
import { ComponentYieldMatrix, RecoveryCategory } from '../master-data/entities/component-yield-matrix.entity';
import { SparePart } from '../master-data/entities/spare-part.entity';
// Cross-module entity-class imports for typing/transaction use only (not a @Module
// import) - the same established pattern InventoryService uses for JobCard and AmcService
// uses for Appointment/ServiceCentre/Estimate.
import { InventoryStock, InventoryLocation } from '../inventory/entities/inventory-stock.entity';
import { GlLedgerService } from '../gl-ledger/gl-ledger.service';
import { CreateDismantlingRecordDto } from './dto/create-dismantling-record.dto';
import { HarvestComponentsDto } from './dto/harvest-components.dto';
import { PriceAndPostDismantlingDto } from './dto/price-and-post-dismantling.dto';

@Injectable()
export class DismantlingService {
  constructor(
    @InjectRepository(DismantlingRecord) private dismantlingRecordRepository: Repository<DismantlingRecord>,
    @InjectRepository(ComponentYieldMatrix) private componentYieldMatrixRepository: Repository<ComponentYieldMatrix>,
    @InjectRepository(SparePart) private sparePartRepository: Repository<SparePart>,
    @InjectDataSource() private dataSource: DataSource,
    private glLedgerService: GlLedgerService,
  ) {}

  private async generateRecordNumber(): Promise<string> {
    const prefix = 'DISM-';
    const last = await this.dismantlingRecordRepository
      .createQueryBuilder('d')
      .where('d.recordNumber LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('d.recordNumber', 'DESC')
      .getOne();
    let sequence = 1;
    if (last) sequence = parseInt(last.recordNumber.replace(prefix, ''), 10) + 1;
    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }

  async findById(id: string): Promise<DismantlingRecord> {
    const record = await this.dismantlingRecordRepository.findOne({ where: { id } });
    if (!record) {
      throw new NotFoundException(`Dismantling record ${id} not found`);
    }
    return record;
  }

  async findAll(status?: DismantlingStatus): Promise<DismantlingRecord[]> {
    return this.dismantlingRecordRepository.find({
      where: status ? { status } : {},
      order: { createdAt: 'DESC' },
    });
  }

  async findByApplianceSerial(applianceSerialNumber: string): Promise<DismantlingRecord[]> {
    return this.dismantlingRecordRepository.find({
      where: { applianceSerialNumber },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * BRD step 15.1 (Verify Defective Location). No hard "stock available" gate - see the
   * entity's class doc comment for why (no whole-appliance inventory ledger exists to
   * check against). This just opens the record; the physical verification is the offline
   * activity the BRD describes.
   */
  async create(dto: CreateDismantlingRecordDto, createdById: string): Promise<DismantlingRecord> {
    const recordNumber = await this.generateRecordNumber();
    const record = this.dismantlingRecordRepository.create({
      recordNumber,
      applianceSerialNumber: dto.applianceSerialNumber,
      modelId: dto.modelId,
      damageLocationNotes: dto.damageLocationNotes ?? null,
      status: DismantlingStatus.PENDING_HARVEST,
      harvestedComponents: [],
      createdById,
    });
    return this.dismantlingRecordRepository.save(record);
  }

  /**
   * BRD steps 15.2-15.3 (Strip-Down & Inspection; Log Recovered Components). One-shot -
   * only callable while PENDING_HARVEST, mirroring the BRD's linear step order. Looks up
   * each component against ComponentYieldMatrix (modelId + originalBomItemCode) and
   * snapshots itemName/category/convertedSparePartCode onto the record so a later
   * master-data edit can't retroactively change what was harvested. A component with no
   * matching matrix row is still logged (visibility) but is never eligible for
   * conversion. Consumables are excluded from selection per step 15.5 - computed here as
   * `eligibleForConversion`, enforced again (defensively) at price-and-post.
   */
  async harvest(id: string, dto: HarvestComponentsDto, harvestedByUserId: string): Promise<DismantlingRecord> {
    const record = await this.findById(id);
    if (record.status !== DismantlingStatus.PENDING_HARVEST) {
      throw new BadRequestException(`Cannot log harvested components: record is ${record.status}, not PENDING_HARVEST.`);
    }

    const harvestedComponents: HarvestedComponent[] = [];
    for (const item of dto.components) {
      const matrixEntry = await this.componentYieldMatrixRepository.findOne({
        where: { modelId: record.modelId, originalBomItemCode: item.originalBomItemCode, isActive: true },
      });
      const category = matrixEntry?.category ?? null;
      const convertedSparePartCode = matrixEntry?.convertedSparePartCode ?? null;
      const eligibleForConversion =
        item.testedCondition === HarvestedComponentCondition.GOOD_WORKING &&
        category === RecoveryCategory.RECOVERABLE_SPARE &&
        !!convertedSparePartCode;

      harvestedComponents.push({
        originalBomItemCode: item.originalBomItemCode,
        itemName: matrixEntry?.itemName ?? null,
        category,
        convertedSparePartCode,
        testedCondition: item.testedCondition,
        quantity: item.quantity,
        eligibleForConversion,
        selectedForConversion: false,
        recoveryUnitPrice: null,
        quantityConverted: null,
        convertedSparePartId: null,
      });
    }

    record.harvestedComponents = harvestedComponents;
    record.harvestedByUserId = harvestedByUserId;
    record.harvestedAt = new Date();
    record.status = DismantlingStatus.COMPONENTS_LOGGED;
    return this.dismantlingRecordRepository.save(record);
  }

  /**
   * AC-31's second required actor. Not an explicit numbered BRD step - the acceptance
   * criterion requires a supervisor distinct from whoever harvested, so this is a real
   * segregation-of-duties gate, not just an optional extra column.
   */
  async verify(id: string, notes: string | undefined, verifiedByUserId: string): Promise<DismantlingRecord> {
    const record = await this.findById(id);
    if (record.status !== DismantlingStatus.COMPONENTS_LOGGED) {
      throw new BadRequestException(`Cannot verify: record is ${record.status}, not COMPONENTS_LOGGED.`);
    }
    if (verifiedByUserId === record.harvestedByUserId) {
      throw new BadRequestException('AC-31 requires the verifier to be different from the technician who harvested the components.');
    }

    record.verifiedByUserId = verifiedByUserId;
    record.verifiedAt = new Date();
    record.verificationNotes = notes ?? null;
    record.status = DismantlingStatus.VERIFIED;
    return this.dismantlingRecordRepository.save(record);
  }

  /**
   * BRD steps 15.4-15.6 (Access Dismantle Module; BOM to Spare Conversion; Manual Pricing
   * & Final Posting) - one combined action, matching the BRD's single "Manual Pricing &
   * Final Posting" step. AC-39: no financial value or live-inventory entry before this
   * point. AC-30: inventory adjustment happens atomically (one DB transaction) with the
   * posting itself. AC-31's third actor - must differ from both the harvester and the
   * verifier.
   *
   * Locking order mirrors InventoryService.consumeReservationsOnQcApproval(): a
   * per-record advisory lock first (guards two concurrent posts on the same record), then
   * every distinct resolved spare part, sorted by id, so two concurrent posts touching
   * overlapping parts in different order can't deadlock.
   */
  async priceAndPost(id: string, dto: PriceAndPostDismantlingDto, pricedByUserId: string): Promise<DismantlingRecord> {
    const record = await this.findById(id);
    if (record.status !== DismantlingStatus.VERIFIED) {
      throw new BadRequestException(`Cannot price and post: record is ${record.status}, not VERIFIED.`);
    }
    if (pricedByUserId === record.harvestedByUserId || pricedByUserId === record.verifiedByUserId) {
      throw new BadRequestException('AC-31 requires the person pricing and posting to be different from both the harvester and the verifier.');
    }

    // Resolve every conversion line against the harvested log up front (outside the
    // transaction) so a bad request fails fast with a clear message before any locks are
    // taken.
    const resolved: Array<{
      componentIndex: number;
      quantityToConvert: number;
      recoveryUnitPrice: number;
      sparePart: SparePart;
    }> = [];

    for (const conversion of dto.conversions) {
      const componentIndex = record.harvestedComponents.findIndex((c) => c.originalBomItemCode === conversion.originalBomItemCode);
      if (componentIndex === -1) {
        throw new BadRequestException(`No harvested component logged with code ${conversion.originalBomItemCode}.`);
      }
      const component = record.harvestedComponents[componentIndex];
      if (!component.eligibleForConversion) {
        throw new BadRequestException(
          `Component ${conversion.originalBomItemCode} is not eligible for conversion (must be GOOD_WORKING, category RECOVERABLE_SPARE, and linked to a converted spare part code - consumables/scrap are excluded per BRD step 15.5).`,
        );
      }
      if (component.selectedForConversion) {
        throw new BadRequestException(`Component ${conversion.originalBomItemCode} has already been converted on this record.`);
      }
      const quantityToConvert = conversion.quantityToConvert ?? component.quantity;
      if (quantityToConvert > component.quantity) {
        throw new BadRequestException(
          `Cannot convert ${quantityToConvert} units of ${conversion.originalBomItemCode} - only ${component.quantity} were harvested.`,
        );
      }

      const sparePart = await this.sparePartRepository.findOne({
        where: { code: component.convertedSparePartCode as string },
        relations: { models: true },
      });
      if (!sparePart) {
        throw new NotFoundException(
          `Converted spare part code ${component.convertedSparePartCode} (from ComponentYieldMatrix) does not match any SparePart master-data record - create it first.`,
        );
      }
      if (!sparePart.models || sparePart.models.length === 0) {
        throw new BadRequestException(
          `Cannot post recovered stock for ${sparePart.code}: it isn't linked to any SparePartModel yet (same AC-17 integrity rule GRN enforces). Link it to a model first.`,
        );
      }

      resolved.push({ componentIndex, quantityToConvert, recoveryUnitPrice: conversion.recoveryUnitPrice, sparePart });
    }

    const totalRecoveredValue = resolved.reduce((sum, r) => sum + r.quantityToConvert * r.recoveryUnitPrice, 0);

    const posted = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`dismantling:${id}`]);

      const sparePartIds = Array.from(new Set(resolved.map((r) => r.sparePart.id))).sort();
      for (const sparePartId of sparePartIds) {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [sparePartId]);
      }

      const current = await manager.findOne(DismantlingRecord, { where: { id } });
      if (!current || current.status !== DismantlingStatus.VERIFIED) {
        throw new ConflictException('Record status changed before posting completed - reload and retry.');
      }

      for (const r of resolved) {
        let stock = await manager.findOne(InventoryStock, { where: { sparePartId: r.sparePart.id, location: InventoryLocation.MAIN_STORE } });
        if (!stock) {
          stock = manager.create(InventoryStock, { sparePartId: r.sparePart.id, location: InventoryLocation.MAIN_STORE, quantityOnHand: 0, quantityReserved: 0 });
        }
        stock.quantityOnHand += r.quantityToConvert;
        await manager.save(stock);

        const component = current.harvestedComponents[r.componentIndex];
        component.selectedForConversion = true;
        component.recoveryUnitPrice = r.recoveryUnitPrice;
        component.quantityConverted = r.quantityToConvert;
        component.convertedSparePartId = r.sparePart.id;
      }

      current.status = DismantlingStatus.POSTED;
      current.pricedByUserId = pricedByUserId;
      current.postedAt = new Date();
      current.totalRecoveredValue = totalRecoveredValue;
      return manager.save(current);
    });

    // GL posting is intentionally outside the inventory transaction, the same way
    // AmcService's notification send happens after its own persistence commits - the
    // journal log is a record OF what happened, not a precondition for it.
    await this.glLedgerService.postDismantlingRecovery({
      dismantlingRecordId: posted.id,
      recordNumber: posted.recordNumber,
      amount: posted.totalRecoveredValue,
    });

    return posted;
  }

  /** Only while nothing irreversible has happened yet - once VERIFIED, cancelling would
   * discard a supervisor's sign-off with no compensating record, so it's blocked past
   * that point (mirrors DeliveryService.cancel()'s "only while PENDING" gate). */
  async cancel(id: string, reason: string): Promise<DismantlingRecord> {
    const record = await this.findById(id);
    if (record.status !== DismantlingStatus.PENDING_HARVEST && record.status !== DismantlingStatus.COMPONENTS_LOGGED) {
      throw new BadRequestException(`Cannot cancel: record is ${record.status}. Only PENDING_HARVEST or COMPONENTS_LOGGED records can be cancelled.`);
    }
    record.status = DismantlingStatus.CANCELLED;
    record.cancellationReason = reason;
    return this.dismantlingRecordRepository.save(record);
  }
}
