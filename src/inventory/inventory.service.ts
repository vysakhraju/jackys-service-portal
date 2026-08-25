import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { InventoryStock, InventoryLocation } from './entities/inventory-stock.entity';
import { InventoryReservation, ReservationStatus, ReviewDecision } from './entities/inventory-reservation.entity';
import { SparePart } from '../master-data/entities/spare-part.entity';
import { UserStatus } from '../auth/entities/user.entity';
// Cross-module entity-class import for typing/transaction use only (not a @Module import,
// so this does not create a Nest DI circular-module dependency) - the same established
// pattern AuthService already uses for JobCard/InventoryReservation.
import { JobCard, JobCardStatus } from '../job-cards/entities/job-card.entity';

// The idle-reservation review cadence (mitigation for the-fool failure #3/#4): a
// reservation sitting untouched this long shows up on GET /inventory/reservations/stale
// and on the Job Card/Workshop view a TL already checks daily. Crossing STALE_HOURS is a
// visibility signal only - crossing BLOCK_HOURS is the structural forcing function
// (WorkshopService.requestSpare refuses further requests on that job until reviewed).
export const STALE_HOURS = 24;
export const BLOCK_HOURS = 48;

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryStock)
    private stockRepository: Repository<InventoryStock>,
    @InjectRepository(InventoryReservation)
    private reservationRepository: Repository<InventoryReservation>,
    @InjectRepository(SparePart)
    private sparePartRepository: Repository<SparePart>,
    @InjectDataSource()
    private dataSource: DataSource,
  ) {}

  private ageHours(reservation: InventoryReservation, now: Date): number {
    const since = reservation.lastReviewedAt ?? reservation.requestedAt;
    return (now.getTime() - since.getTime()) / (1000 * 60 * 60);
  }

  async findReservationById(id: string): Promise<InventoryReservation> {
    const reservation = await this.reservationRepository.findOne({ where: { id } });
    if (!reservation) {
      throw new NotFoundException(`Inventory reservation ${id} not found`);
    }
    return reservation;
  }

  async getStock(sparePartId: string, location: InventoryLocation = InventoryLocation.MAIN_STORE): Promise<InventoryStock | null> {
    return this.stockRepository.findOne({ where: { sparePartId, location } });
  }

  /**
   * AC-17: GRN blocked if the spare isn't linked to at least one SparePartModel. Genuine
   * new stock entering the building - increments quantityOnHand directly (the only other
   * method allowed to do that is confirmReturn()). Wrapped in the same advisory lock as
   * reserve()/confirmReturn() so a GRN landing at the same moment as a reservation being
   * requested can't interleave and produce a wrong on-hand number.
   */
  async grn(sparePartId: string, quantity: number, notes: string | undefined, recordedByUserId: string): Promise<InventoryStock> {
    const sparePart = await this.sparePartRepository.findOne({ where: { id: sparePartId }, relations: { models: true } });
    if (!sparePart) {
      throw new NotFoundException(`Spare part ${sparePartId} not found`);
    }
    if (!sparePart.models || sparePart.models.length === 0) {
      throw new BadRequestException(
        `Cannot receive stock for ${sparePart.code}: it isn't linked to any SparePartModel yet (AC-17). Link it to a model first.`,
      );
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [sparePartId]);

      let stock = await manager.findOne(InventoryStock, { where: { sparePartId, location: InventoryLocation.MAIN_STORE } });
      if (!stock) {
        stock = manager.create(InventoryStock, { sparePartId, location: InventoryLocation.MAIN_STORE, quantityOnHand: 0, quantityReserved: 0 });
      }
      stock.quantityOnHand += quantity;
      return manager.save(stock);
    });
  }

  /**
   * FR-09: reserve (not deduct) stock from Main Store for a job in WIP. Wrapped in a
   * Postgres advisory lock keyed on the spare part (NFR-06) so two concurrent requests
   * against the same low-stock part can't both read the same "available" number and
   * over-reserve - the lock is transaction-scoped (pg_advisory_xact_lock), so it releases
   * automatically at commit/rollback, including if the request crashes mid-transaction.
   * If less is available than requested, reserves what's available (PARTIALLY_RESERVED)
   * rather than failing outright - the caller (WorkshopService) decides what that means
   * for the Job Card's status.
   *
   * Phase 6: the three rework* params are set only when WorkshopService has determined
   * this request is a same-part rework re-request (the job already had a QC rejection AND
   * a prior reservation exists for this exact part on this exact job) - either a real
   * supervisor/TL sign-off (reworkApprovedByUserId) or a verbal-override fallback
   * (reworkVerbalOverrideBy/Notes). InventoryService itself does not enforce the gate -
   * it just persists whatever WorkshopService already validated, keeping the
   * access-control decision in one place (PermissionsService.requireActiveGrant, called
   * from WorkshopService) rather than duplicated here.
   */
  async reserve(
    sparePartId: string,
    quantity: number,
    jobCardId: string,
    custodianUserId: string,
    requestedByUserId: string,
    now: Date = new Date(),
    reworkApprovedByUserId?: string,
    reworkVerbalOverrideBy?: string,
    reworkVerbalOverrideNotes?: string,
  ): Promise<InventoryReservation> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [sparePartId]);

      const stock = await manager.findOne(InventoryStock, { where: { sparePartId, location: InventoryLocation.MAIN_STORE } });
      if (!stock) {
        throw new NotFoundException(`No stock on hand for spare part ${sparePartId} yet - receive it via GRN first.`);
      }

      const available = stock.quantityOnHand - stock.quantityReserved;
      const quantityReserved = Math.max(0, Math.min(quantity, available));

      stock.quantityReserved += quantityReserved;
      await manager.save(stock);

      const reservation = manager.create(InventoryReservation, {
        sparePartId,
        jobCardId,
        custodianUserId,
        quantityRequested: quantity,
        quantityReserved,
        status: quantityReserved >= quantity ? ReservationStatus.HELD : ReservationStatus.PARTIALLY_RESERVED,
        requestedByUserId,
        requestedAt: now,
        reworkApprovedByUserId: reworkApprovedByUserId ?? null,
        reworkVerbalOverrideBy: reworkVerbalOverrideBy ?? null,
        reworkVerbalOverrideNotes: reworkVerbalOverrideNotes ?? null,
      });
      return manager.save(reservation);
    });
  }

  /**
   * Phase 6 rework gate support: has this exact spare part ever been requested/reserved
   * before on this exact Job Card, regardless of the reservation's current status? Used
   * by WorkshopService.requestSpare() together with JobCard.qcRejectionCount > 0 to decide
   * whether THIS request is a same-part rework re-request that needs sign-off. Both
   * conditions must hold - a same-part top-up before any QC rejection is ordinary Phase 5
   * behaviour and must NOT trigger this gate.
   */
  async hasPriorReservationForPart(jobCardId: string, sparePartId: string): Promise<boolean> {
    const count = await this.reservationRepository.count({ where: { jobCardId, sparePartId } });
    return count > 0;
  }

  /**
   * TL+ review of a HELD/PARTIALLY_RESERVED reservation flagged as idle.
   * APPROVE_REALLOCATION moves it to RETURN_PENDING - quantityOnHand does NOT change here
   * (the-fool failure #1: nothing moves stock except a physically-confirmed return).
   * REJECT keeps the reservation exactly as it was, but resets lastReviewedAt so the
   * staleness clock restarts - a reject is a snooze, not a permanent exemption (failure #4).
   */
  async review(reservationId: string, decision: ReviewDecision, reviewerId: string, notes: string | undefined, now: Date = new Date()): Promise<InventoryReservation> {
    const reservation = await this.findReservationById(reservationId);

    if (reservation.status !== ReservationStatus.HELD && reservation.status !== ReservationStatus.PARTIALLY_RESERVED) {
      throw new BadRequestException(`Cannot review a reservation that is already ${reservation.status}.`);
    }

    reservation.reviewedByUserId = reviewerId;
    reservation.reviewDecision = decision;
    reservation.notes = notes ?? reservation.notes;
    reservation.lastReviewedAt = now;

    if (decision === ReviewDecision.APPROVE_REALLOCATION) {
      reservation.status = ReservationStatus.RETURN_PENDING;
    }
    // REJECT: status intentionally unchanged - see method doc above.

    return this.reservationRepository.save(reservation);
  }

  /**
   * The custodian technician voluntarily returning an unused reservation - doesn't wait
   * for a staleness flag or a TL decision. Also usable by a privileged caller (TL+) on
   * the technician's behalf. Either way this only ever reaches RETURN_PENDING.
   */
  async requestReturn(reservationId: string, callerId: string, callerIsPrivileged: boolean): Promise<InventoryReservation> {
    const reservation = await this.findReservationById(reservationId);

    if (!callerIsPrivileged && reservation.custodianUserId !== callerId) {
      throw new ForbiddenException('Only the technician currently holding this reservation (or a Team Leader+) can request its return.');
    }

    if (reservation.status !== ReservationStatus.HELD && reservation.status !== ReservationStatus.PARTIALLY_RESERVED) {
      throw new BadRequestException(`Cannot request a return for a reservation that is already ${reservation.status}.`);
    }

    reservation.status = ReservationStatus.RETURN_PENDING;
    return this.reservationRepository.save(reservation);
  }

  /**
   * The ONLY method in this module that increments InventoryStock.quantityOnHand for a
   * return. Everything else - job cancellation, a TL-approved reallocation, a
   * technician's own return request - only ever gets a reservation to RETURN_PENDING.
   * Locked the same way as reserve()/grn() so a return confirmation and a fresh
   * reservation request against the same spare part can't interleave.
   */
  async confirmReturn(reservationId: string, quantityReturned: number, confirmedByUserId: string, now: Date = new Date()): Promise<InventoryReservation> {
    const reservation = await this.findReservationById(reservationId);

    if (reservation.status !== ReservationStatus.RETURN_PENDING) {
      throw new BadRequestException(
        `Cannot confirm a return for a reservation that is ${reservation.status} - it must go through a review approval or a return request first (RETURN_PENDING).`,
      );
    }
    if (quantityReturned > reservation.quantityReserved) {
      throw new BadRequestException(
        `Cannot confirm returning ${quantityReturned} units - only ${reservation.quantityReserved} were ever reserved against this record.`,
      );
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [reservation.sparePartId]);

      const stock = await manager.findOne(InventoryStock, { where: { sparePartId: reservation.sparePartId, location: InventoryLocation.MAIN_STORE } });
      if (stock) {
        stock.quantityOnHand += quantityReturned;
        stock.quantityReserved = Math.max(0, stock.quantityReserved - reservation.quantityReserved);
        await manager.save(stock);
      }

      reservation.status = ReservationStatus.RETURNED;
      reservation.quantityReturned = quantityReturned;
      reservation.returnConfirmedByUserId = confirmedByUserId;
      reservation.returnConfirmedAt = now;
      return manager.save(reservation);
    });
  }

  /**
   * Cancelling a Job Card moves every active reservation against it to RETURN_PENDING -
   * never auto-increments quantityOnHand (same physical-confirmation gate as everything
   * else). Called by JobCardsService.cancel().
   */
  async cancelReservationsForJobCard(jobCardId: string): Promise<InventoryReservation[]> {
    const active = await this.reservationRepository.find({
      where: [
        { jobCardId, status: ReservationStatus.HELD },
        { jobCardId, status: ReservationStatus.PARTIALLY_RESERVED },
      ],
    });
    if (active.length === 0) {
      return [];
    }
    active.forEach((r) => (r.status = ReservationStatus.RETURN_PENDING));
    return this.reservationRepository.save(active);
  }

  /**
   * Phase 6 (FR-09/FR-10): the QC-approval gate and consumption, both in ONE atomic
   * transaction - deliberately NOT split into "transition the Job Card" then "consume the
   * stock" as two separate calls (that anti-pattern already exists in
   * JobCardsController.cancel() and is low-stakes there; it would NOT be low-stakes here,
   * since this deducts real, permanent stock). Everything below either all commits or all
   * rolls back together.
   *
   * Hard stock-sufficiency gate (the negative-inventory requirement): for every spare
   * part this job has an active reservation against, look at the MOST RECENT (by
   * requestedAt) active reservation for that part - if it is still PARTIALLY_RESERVED,
   * QC approval is blocked outright (409) with the specific parts named.
   *
   * Why "latest per part" and not "any row" or "sum requested vs reserved": a technician
   * who gets a partial reservation and later tops up the shortfall makes a SEPARATE
   * follow-up reserve() call (Phase 5 never mutates the original row), so the original
   * PARTIALLY_RESERVED row sits there forever even after the part is fully covered.
   * Blocking on "any row is PARTIALLY_RESERVED" would then block that job's QC approval
   * permanently despite the shortfall being resolved. Summing quantityRequested across
   * rows doesn't work either - a top-up's quantityRequested is "how much more I still
   * need," not a repeat of the original ask, so summing double-counts. The one signal
   * that's actually reliable is: for this part, did the LAST time anyone asked for it
   * come back short? That mirrors the exact same logic WorkshopService.requestSpare()
   * already uses to flip the whole Job Card between IN_PROGRESS/SPARE_PENDING (the latest
   * request's outcome), just scoped per spare part instead of per job - which additionally
   * closes a real gap in that job-level check: today a job can flip back to IN_PROGRESS
   * because an unrelated second part's request was fully held, even while a different
   * part is still genuinely short. This gate catches that case per part.
   *
   * Locking order (the-fool fix #1): a per-job-card advisory lock first (guards against
   * two concurrent approve calls on the SAME job double-consuming), then every distinct
   * spare part this job touches, sorted alphabetically by id, so two concurrent
   * QC-approvals on different jobs that happen to share parts in reverse order can never
   * deadlock against each other.
   */
  async consumeReservationsOnQcApproval(jobCardId: string, approvedByUserId: string, now: Date = new Date()): Promise<JobCard> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`jobcard:${jobCardId}`]);

      const jobCard = await manager.findOne(JobCard, { where: { id: jobCardId } });
      if (!jobCard) {
        throw new NotFoundException(`Job Card ${jobCardId} not found`);
      }
      if (jobCard.status !== JobCardStatus.READY_FOR_QC) {
        throw new BadRequestException(
          `Cannot QC-approve a Job Card that is ${jobCard.status}, not READY_FOR_QC.`,
        );
      }

      const activeReservations = await manager.find(InventoryReservation, {
        where: [
          { jobCardId, status: ReservationStatus.HELD },
          { jobCardId, status: ReservationStatus.PARTIALLY_RESERVED },
        ],
      });

      const latestByPart = new Map<string, InventoryReservation>();
      for (const r of activeReservations) {
        const current = latestByPart.get(r.sparePartId);
        if (!current || r.requestedAt > current.requestedAt) {
          latestByPart.set(r.sparePartId, r);
        }
      }

      const shortfalls = Array.from(latestByPart.values())
        .filter((r) => r.status === ReservationStatus.PARTIALLY_RESERVED)
        .map((r) => ({ reservationId: r.id, sparePartId: r.sparePartId, quantityRequested: r.quantityRequested, quantityReserved: r.quantityReserved }));

      if (shortfalls.length > 0) {
        throw new ConflictException({
          message: 'Cannot QC-approve: this job has spare part(s) whose most recent request was never fully reserved (stock shortfall). Complete the GRN/top-up first.',
          blockers: shortfalls,
        });
      }

      if (activeReservations.length === 0) {
        // No spares were ever reserved against this job (e.g. a repair needing no parts) -
        // valid, just nothing to consume. Fall through to the status transition below.
      }

      const sparePartIds = Array.from(new Set(activeReservations.map((r) => r.sparePartId))).sort();
      for (const sparePartId of sparePartIds) {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [sparePartId]);
      }

      for (const sparePartId of sparePartIds) {
        const mainStock = await manager.findOne(InventoryStock, { where: { sparePartId, location: InventoryLocation.MAIN_STORE } });
        const reservationsForPart = activeReservations.filter((r) => r.sparePartId === sparePartId);
        const totalToConsume = reservationsForPart.reduce((sum, r) => sum + r.quantityReserved, 0);

        // Defensive invariant check - reserve() should already guarantee
        // quantityReserved never exceeds quantityOnHand, so this should never trip in
        // practice. It exists purely so a data-integrity bug throws loudly here instead
        // of ever silently pushing quantityOnHand negative.
        if (!mainStock || mainStock.quantityOnHand < totalToConsume) {
          throw new ConflictException(
            `Cannot QC-approve: recorded stock for spare part ${sparePartId} (${mainStock?.quantityOnHand ?? 0} on hand) is less than what this job has reserved (${totalToConsume}). This indicates a stock data problem - resolve before approving.`,
          );
        }

        let damageStock = await manager.findOne(InventoryStock, { where: { sparePartId, location: InventoryLocation.DAMAGE_LOCATION } });
        if (!damageStock) {
          damageStock = manager.create(InventoryStock, {
            sparePartId,
            location: InventoryLocation.DAMAGE_LOCATION,
            quantityOnHand: 0,
            quantityReserved: 0,
          });
        }

        mainStock.quantityOnHand -= totalToConsume;
        mainStock.quantityReserved = Math.max(0, mainStock.quantityReserved - totalToConsume);
        damageStock.quantityOnHand += totalToConsume;

        await manager.save(mainStock);
        await manager.save(damageStock);

        for (const reservation of reservationsForPart) {
          reservation.status = ReservationStatus.CONSUMED;
          reservation.consumedAt = now;
          reservation.consumedByUserId = approvedByUserId;
          await manager.save(reservation);
        }
      }

      jobCard.status = JobCardStatus.QC_PASSED;
      jobCard.qcApprovedByUserId = approvedByUserId;
      jobCard.qcApprovedAt = now;
      return manager.save(jobCard);
    });
  }

  /**
   * GET /inventory/reservations/stale. Sorted oldest-first by the age computed above. A
   * reservation whose custodian is no longer ACTIVE is surfaced first regardless of age -
   * the-fool failure #2's mitigation: deactivation doesn't hide custody, it escalates it.
   */
  async getStaleReservations(now: Date = new Date()): Promise<Array<InventoryReservation & { ageHours: number; custodianActive: boolean }>> {
    const active = await this.reservationRepository.find({
      where: [
        { status: ReservationStatus.HELD },
        { status: ReservationStatus.PARTIALLY_RESERVED },
      ],
      relations: { custodian: true },
    });

    const withAge = active
      .filter((r) => this.ageHours(r, now) >= STALE_HOURS || (r.custodian && r.custodian.status !== UserStatus.ACTIVE))
      .map((r) => ({
        ...r,
        ageHours: this.ageHours(r, now),
        custodianActive: !r.custodian || r.custodian.status === UserStatus.ACTIVE,
      }));

    return withAge.sort((a, b) => {
      if (a.custodianActive !== b.custodianActive) {
        return a.custodianActive ? 1 : -1; // inactive-custodian reservations first
      }
      return b.ageHours - a.ageHours; // oldest first
    });
  }

  /**
   * The structural gate behind WorkshopService.requestSpare(): a Job Card with a
   * reservation idle past BLOCK_HOURS with no review decision since can't request more
   * spares until a TL reviews it. Returns the blocking reservation, or null if clear.
   */
  async hasUnresolvedStaleReservation(jobCardId: string, now: Date = new Date()): Promise<InventoryReservation | null> {
    const active = await this.reservationRepository.find({
      where: [
        { jobCardId, status: ReservationStatus.HELD },
        { jobCardId, status: ReservationStatus.PARTIALLY_RESERVED },
      ],
    });
    const blocking = active.find((r) => this.ageHours(r, now) >= BLOCK_HOURS);
    return blocking ?? null;
  }

  /** Any user's still-open custody, for the deactivation guard in AuthService. */
  async findOpenReservationsForCustodian(custodianUserId: string): Promise<InventoryReservation[]> {
    return this.reservationRepository.find({
      where: [
        { custodianUserId, status: ReservationStatus.HELD },
        { custodianUserId, status: ReservationStatus.PARTIALLY_RESERVED },
        { custodianUserId, status: ReservationStatus.RETURN_PENDING },
      ],
    });
  }
}
