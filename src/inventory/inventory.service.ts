import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { InventoryStock, InventoryLocation } from './entities/inventory-stock.entity';
import { InventoryReservation, ReservationStatus, ReviewDecision } from './entities/inventory-reservation.entity';
import { SparePart } from '../master-data/entities/spare-part.entity';
import { UserStatus } from '../auth/entities/user.entity';

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

  async getStock(sparePartId: string): Promise<InventoryStock | null> {
    return this.stockRepository.findOne({ where: { sparePartId, location: InventoryLocation.MAIN_STORE } });
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
   */
  async reserve(
    sparePartId: string,
    quantity: number,
    jobCardId: string,
    custodianUserId: string,
    requestedByUserId: string,
    now: Date = new Date(),
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
      });
      return manager.save(reservation);
    });
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
