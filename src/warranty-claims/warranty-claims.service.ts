import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { WarrantyClaim, WarrantyClaimStatus } from './entities/warranty-claim.entity';
import { WarrantyClaimLine } from './entities/warranty-claim-line.entity';
import { InventoryReservation, ReservationStatus } from '../inventory/entities/inventory-reservation.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { AggregateWarrantyClaimDto } from './dto/aggregate-warranty-claim.dto';
import { SubmitWarrantyClaimDto } from './dto/submit-warranty-claim.dto';
import { RecordCreditNoteDto } from './dto/record-credit-note.dto';
import { CancelWarrantyClaimDto } from './dto/cancel-warranty-claim.dto';
import { GlLedgerService } from '../gl-ledger/gl-ledger.service';

/**
 * BRD Workflow 12 (EPIC-007 partial, "[Optional]"): Warranty Claims & Vendor Management.
 * See WarrantyClaim's own doc comment for the DRAFT -> SUBMITTED -> CREDIT_RECEIVED (or
 * DRAFT -> CANCELLED) lifecycle. This service is the only writer of WarrantyClaim /
 * WarrantyClaimLine rows.
 */
@Injectable()
export class WarrantyClaimsService {
  constructor(
    @InjectRepository(WarrantyClaim) private warrantyClaimRepository: Repository<WarrantyClaim>,
    @InjectRepository(WarrantyClaimLine) private warrantyClaimLineRepository: Repository<WarrantyClaimLine>,
    @InjectDataSource() private dataSource: DataSource,
    private glLedgerService: GlLedgerService,
  ) {}

  private async generateClaimNumber(): Promise<string> {
    const prefix = 'WC-';
    const last = await this.warrantyClaimRepository
      .createQueryBuilder('c')
      .where('c.claimNumber LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('c.claimNumber', 'DESC')
      .getOne();
    let sequence = 1;
    if (last) sequence = parseInt(last.claimNumber.replace(prefix, ''), 10) + 1;
    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }

  /**
   * BRD 12.1: "System groups all warranty spares used for each vendor" for a given
   * period. Eligibility, resolved fresh at aggregation time:
   *   - InventoryReservation.status = CONSUMED (permanently deducted at QC approval,
   *     Main Store -> Damage Location - the same signal DebitNotesService already uses
   *     as "this repair genuinely cost the company money").
   *   - The owning JobCard's CURRENT warrantyStatus = IN_WARRANTY (not
   *     originalWarrantyStatus) - a Team Leader's warrantyOverride() is a real, audited
   *     determination of coverage (e.g. a manufacturer extended-warranty card this app's
   *     own WarrantyMaster table didn't know about) and is authoritative for whether the
   *     vendor is actually liable, not just cosmetic.
   *   - JobCard.warrantySupplier matches the requested supplier exactly.
   *   - InventoryReservation.consumedAt falls within [periodStart, periodEnd] - the
   *     moment the cost was actually realized, matching how every other GL-adjacent
   *     posting in this app anchors to the moment of financial realization (QC approval
   *     for DebitNote, price-and-post for DismantlingRecord).
   *   - Not already referenced by any WarrantyClaimLine, live or cancelled - the
   *     unique index on WarrantyClaimLine.inventoryReservationId is the hard backstop,
   *     this query-level filter is what keeps normal (non-racing) calls efficient and
   *     also what makes two overlapping period windows for the same vendor naturally
   *     non-double-counting: whichever reservation was claimed first is simply absent
   *     from the pool the second call sees.
   *
   * The entire read-then-insert runs inside one transaction, serialized per-supplier via
   * a Postgres advisory lock (the-fool pre-mortem finding: without this, two concurrent
   * aggregate() calls for the same vendor could both read the same "unclaimed" set before
   * either has written its lines; the unique index would still stop a genuine double
   * count, but only by aborting the whole transaction with an opaque constraint-violation
   * error rather than a clear message).
   */
  async aggregate(dto: AggregateWarrantyClaimDto, generatedByUserId: string): Promise<WarrantyClaim> {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    periodEnd.setHours(23, 59, 59, 999); // inclusive end-of-day, since periodEnd is a plain date
    if (periodStart > periodEnd) {
      throw new BadRequestException('periodStart must not be after periodEnd.');
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`warranty-claim-aggregate:${dto.supplier}`]);

      const alreadyClaimedReservationIds = (
        await manager
          .createQueryBuilder(WarrantyClaimLine, 'line')
          .select('line.inventoryReservationId', 'id')
          .getRawMany<{ id: string }>()
      ).map((r) => r.id);

      const candidates = await manager
        .createQueryBuilder(InventoryReservation, 'r')
        .innerJoinAndSelect('r.jobCard', 'jc')
        .innerJoinAndSelect('r.sparePart', 'sp')
        .where('r.status = :status', { status: ReservationStatus.CONSUMED })
        .andWhere('jc.warrantyStatus = :iw', { iw: WarrantyStatus.IN_WARRANTY })
        .andWhere('jc.warrantySupplier = :supplier', { supplier: dto.supplier })
        .andWhere('r.consumedAt BETWEEN :start AND :end', { start: periodStart, end: periodEnd })
        .andWhere(alreadyClaimedReservationIds.length ? 'r.id NOT IN (:...claimed)' : '1=1', {
          claimed: alreadyClaimedReservationIds,
        })
        .getMany();

      if (candidates.length === 0) {
        throw new BadRequestException(
          `No unclaimed warranty spares found for ${dto.supplier} between ${dto.periodStart} and ${dto.periodEnd}.`,
        );
      }

      const claimNumber = await this.generateClaimNumber();
      const totalClaimedAmount = candidates.reduce(
        (sum, r) => sum + Number(r.sparePart.unitCost) * r.quantityReserved,
        0,
      );

      const claim = manager.create(WarrantyClaim, {
        claimNumber,
        supplier: dto.supplier,
        periodStart,
        periodEnd,
        status: WarrantyClaimStatus.DRAFT,
        totalClaimedAmount,
        generatedByUserId,
      });
      const savedClaim = await manager.save(claim);

      const lines = candidates.map((r) =>
        manager.create(WarrantyClaimLine, {
          warrantyClaimId: savedClaim.id,
          inventoryReservationId: r.id,
          jobCardId: r.jobCardId,
          jobCardNumber: r.jobCard.jobCardNumber,
          serialNumber: r.jobCard.serialNumber,
          sparePartCode: r.sparePart.code,
          sparePartName: r.sparePart.name,
          quantity: r.quantityReserved,
          unitCost: r.sparePart.unitCost,
          lineAmount: Number(r.sparePart.unitCost) * r.quantityReserved,
          consumedAt: r.consumedAt as Date,
        }),
      );
      // The unique index on inventoryReservationId is the hard backstop against a
      // double-claim slipping through even under a race the advisory lock above didn't
      // fully serialize (e.g. a lock-wait timeout) - a 23505 here aborts the whole
      // transaction, so the caller gets a clean "nothing was created" rather than a
      // half-built claim.
      await manager.save(lines);

      return this.findById(savedClaim.id);
    });
  }

  async findById(id: string): Promise<WarrantyClaim> {
    const claim = await this.warrantyClaimRepository.findOne({ where: { id }, relations: { lines: true } });
    if (!claim) {
      throw new NotFoundException(`Warranty claim ${id} not found`);
    }
    return claim;
  }

  async findAll(filters: { supplier?: string; status?: WarrantyClaimStatus }): Promise<WarrantyClaim[]> {
    return this.warrantyClaimRepository.find({
      where: {
        ...(filters.supplier ? { supplier: filters.supplier } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      order: { createdAt: 'DESC' },
    });
  }

  /** BRD 12.3: a Warranty Clerk has uploaded the claim to the vendor's own portal
   * (no real portal integration exists - this just records that it happened). */
  async submit(id: string, dto: SubmitWarrantyClaimDto, submittedByUserId: string): Promise<WarrantyClaim> {
    const claim = await this.findById(id);
    if (claim.status !== WarrantyClaimStatus.DRAFT) {
      throw new BadRequestException(`Cannot submit: claim is ${claim.status}, not DRAFT.`);
    }
    claim.status = WarrantyClaimStatus.SUBMITTED;
    claim.claimReferenceNumber = dto.claimReferenceNumber;
    claim.notes = dto.notes ?? claim.notes;
    claim.submittedByUserId = submittedByUserId;
    claim.submittedAt = new Date();
    await this.warrantyClaimRepository.save(claim);
    return this.findById(id);
  }

  /**
   * The-fool pre-mortem finding: without a way back out of a mistaken DRAFT claim, its
   * lines would permanently lock their reservations out of ever being claimed again
   * (aggregate() never re-offers a reservation that already has a WarrantyClaimLine).
   * Only DRAFT can be cancelled - once SUBMITTED, the claim is out in the vendor's own
   * portal and this app has no authority to unilaterally cancel it (same "blocked once
   * it's left your hands" precedent as DismantlingRecord's cancel being blocked once
   * VERIFIED). Cancelling deletes this claim's lines (not the claim itself, which stays
   * as an audit record with its status flipped) so their reservations return to the pool
   * the next aggregate() call for this supplier will see.
   */
  async cancel(id: string, dto: CancelWarrantyClaimDto): Promise<WarrantyClaim> {
    const claim = await this.findById(id);
    if (claim.status !== WarrantyClaimStatus.DRAFT) {
      throw new BadRequestException(`Cannot cancel: claim is ${claim.status}, not DRAFT.`);
    }
    await this.warrantyClaimLineRepository.delete({ warrantyClaimId: id });
    claim.status = WarrantyClaimStatus.CANCELLED;
    claim.cancellationReason = dto.reason;
    await this.warrantyClaimRepository.save(claim);
    return this.findById(id);
  }

  /** BRD 12.4: an Accountant records the vendor's credit note; posts to the GL
   * (Debit Vendor Payable / Credit Warranty Recovery Account, per the BRD's own wording). */
  async recordCreditNote(id: string, dto: RecordCreditNoteDto, creditReceivedByUserId: string): Promise<WarrantyClaim> {
    const claim = await this.findById(id);
    if (claim.status !== WarrantyClaimStatus.SUBMITTED) {
      throw new BadRequestException(`Cannot record a credit note: claim is ${claim.status}, not SUBMITTED.`);
    }

    return this.dataSource.transaction(async (manager) => {
      claim.status = WarrantyClaimStatus.CREDIT_RECEIVED;
      claim.creditNoteNumber = dto.creditNoteNumber;
      claim.creditNoteAmount = dto.creditNoteAmount;
      claim.creditReceivedByUserId = creditReceivedByUserId;
      claim.creditReceivedAt = new Date();
      await manager.save(claim);

      await this.glLedgerService.postWarrantyCreditNote({
        warrantyClaimId: claim.id,
        claimNumber: claim.claimNumber,
        amount: dto.creditNoteAmount,
      });

      return this.findById(id);
    });
  }

  /**
   * BRD 12.5: "Amount Recovered / Total Warranty Spares Cost * 100." Numerator is
   * creditNoteAmount summed across CREDIT_RECEIVED claims only (money actually back).
   * Denominator is totalClaimedAmount summed across SUBMITTED + CREDIT_RECEIVED claims
   * (money formally claimed - DRAFT excluded, since a draft isn't a real claim yet, and
   * CANCELLED excluded, since it never became one). This reads as "how much of what
   * we've claimed have we recovered", which is the only interpretation of the BRD's
   * phrase that stays meaningful before every claim has been credited. `rate: null`
   * when there's nothing claimed yet, matching reports.service.ts's own null-guard
   * convention for ratios with no denominator.
   */
  async recoveryRate(filters: { supplier?: string }): Promise<{
    supplier: string | null;
    totalClaimed: number;
    totalRecovered: number;
    rate: number | null;
  }> {
    const claimed = await this.warrantyClaimRepository.find({
      where: {
        status: WarrantyClaimStatus.SUBMITTED,
        ...(filters.supplier ? { supplier: filters.supplier } : {}),
      },
    });
    const credited = await this.warrantyClaimRepository.find({
      where: {
        status: WarrantyClaimStatus.CREDIT_RECEIVED,
        ...(filters.supplier ? { supplier: filters.supplier } : {}),
      },
    });

    const totalClaimed =
      claimed.reduce((sum, c) => sum + Number(c.totalClaimedAmount), 0) +
      credited.reduce((sum, c) => sum + Number(c.totalClaimedAmount), 0);
    const totalRecovered = credited.reduce((sum, c) => sum + Number(c.creditNoteAmount ?? 0), 0);

    return {
      supplier: filters.supplier ?? null,
      totalClaimed: Math.round(totalClaimed * 100) / 100,
      totalRecovered: Math.round(totalRecovered * 100) / 100,
      rate: totalClaimed > 0 ? Math.round((totalRecovered / totalClaimed) * 10000) / 100 : null,
    };
  }
}
