import { NotFoundException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { InventoryService, STALE_HOURS, BLOCK_HOURS } from './inventory.service';
import { InventoryStock, InventoryLocation } from './entities/inventory-stock.entity';
import { InventoryReservation, ReservationStatus, ReviewDecision, NeedSpareReviewDecision } from './entities/inventory-reservation.entity';
import { UserStatus } from '../auth/entities/user.entity';
import { JobCard, JobCardStatus } from '../job-cards/entities/job-card.entity';

describe('InventoryService', () => {
  let service: InventoryService;
  let stockRepository: any;
  let reservationRepository: any;
  let sparePartRepository: any;
  let dataSource: any;
  let manager: any;

  const NOW = new Date('2026-08-25T12:00:00.000Z');

  const stock = (overrides: any = {}) =>
    ({
      id: 'stock-1',
      sparePartId: 'part-1',
      location: InventoryLocation.MAIN_STORE,
      quantityOnHand: 10,
      quantityReserved: 0,
      ...overrides,
    } as any);

  const reservation = (overrides: any = {}) =>
    ({
      id: 'res-1',
      sparePartId: 'part-1',
      jobCardId: 'jc-1',
      custodianUserId: 'tech-1',
      quantityRequested: 3,
      quantityReserved: 3,
      status: ReservationStatus.HELD,
      requestedByUserId: 'tech-1',
      requestedAt: NOW,
      lastReviewedAt: null,
      reviewedByUserId: null,
      reviewDecision: null,
      notes: null,
      quantityReturned: null,
      ...overrides,
    } as any);

  beforeEach(() => {
    manager = {
      query: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(),
      find: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn((entity) => Promise.resolve(entity)),
      create: jest.fn((_cls, data) => data),
    };
    dataSource = { transaction: jest.fn((cb) => cb(manager)) };
    stockRepository = { findOne: jest.fn() };
    reservationRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((data: any) => data),
      save: jest.fn((entity) => Promise.resolve(entity)),
      count: jest.fn(),
    };
    sparePartRepository = { findOne: jest.fn() };

    service = new InventoryService(stockRepository, reservationRepository, sparePartRepository, dataSource);
  });

  describe('grn', () => {
    it('blocks (AC-17) receiving stock for a spare with no linked model', async () => {
      sparePartRepository.findOne.mockResolvedValue({ id: 'part-1', code: 'P-1', models: [] });

      await expect(service.grn('part-1', 10, undefined, 'clerk-1')).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('creates a new stock row at MAIN_STORE when none exists yet', async () => {
      sparePartRepository.findOne.mockResolvedValue({ id: 'part-1', code: 'P-1', models: [{ id: 'model-1' }] });
      manager.findOne.mockResolvedValue(null);

      const result = await service.grn('part-1', 25, 'first delivery', 'clerk-1');

      expect(result.quantityOnHand).toBe(25);
      expect(result.location).toBe(InventoryLocation.MAIN_STORE);
    });

    it('adds to existing on-hand stock rather than replacing it', async () => {
      sparePartRepository.findOne.mockResolvedValue({ id: 'part-1', code: 'P-1', models: [{ id: 'model-1' }] });
      manager.findOne.mockResolvedValue(stock({ quantityOnHand: 5 }));

      const result = await service.grn('part-1', 20, undefined, 'clerk-1');

      expect(result.quantityOnHand).toBe(25);
    });
  });

  describe('reserve', () => {
    it('fully reserves when stock is sufficient - status HELD, quantityReserved equals request', async () => {
      manager.findOne.mockResolvedValue(stock({ quantityOnHand: 10, quantityReserved: 0 }));

      const result = await service.reserve('part-1', 4, 'jc-1', 'tech-1', 'tech-1', NOW);

      expect(result.status).toBe(ReservationStatus.HELD);
      expect(result.quantityReserved).toBe(4);
      expect(result.requestedAt).toBe(NOW);
    });

    it('partially reserves when stock is short - quantityReserved is the AVAILABLE amount, not the requested amount', async () => {
      manager.findOne.mockResolvedValue(stock({ quantityOnHand: 10, quantityReserved: 7 })); // 3 available

      const result = await service.reserve('part-1', 5, 'jc-1', 'tech-1', 'tech-1', NOW);

      expect(result.status).toBe(ReservationStatus.PARTIALLY_RESERVED);
      expect(result.quantityReserved).toBe(3);
      expect(result.quantityRequested).toBe(5);
    });

    it('reserves zero (still creates a trackable record) when nothing is available', async () => {
      manager.findOne.mockResolvedValue(stock({ quantityOnHand: 5, quantityReserved: 5 }));

      const result = await service.reserve('part-1', 2, 'jc-1', 'tech-1', 'tech-1', NOW);

      expect(result.status).toBe(ReservationStatus.PARTIALLY_RESERVED);
      expect(result.quantityReserved).toBe(0);
    });

    it('throws NotFoundException when no stock record exists yet for the spare part', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(service.reserve('part-1', 1, 'jc-1', 'tech-1', 'tech-1', NOW)).rejects.toThrow(NotFoundException);
    });

    it('acquires the advisory lock keyed on the spare part before touching stock', async () => {
      manager.findOne.mockResolvedValue(stock());

      await service.reserve('part-1', 1, 'jc-1', 'tech-1', 'tech-1', NOW);

      expect(manager.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', ['part-1']);
    });

    it('Phase 6: persists rework sign-off fields when a rework re-request is being reserved', async () => {
      manager.findOne.mockResolvedValue(stock());

      const result = await service.reserve('part-1', 1, 'jc-1', 'tech-1', 'tech-1', NOW, 'tl-approver-1');

      expect(result.reworkApprovedByUserId).toBe('tl-approver-1');
      expect(result.reworkVerbalOverrideBy).toBeNull();
    });

    it('Phase 6: persists verbal-override fields when that fallback is used instead', async () => {
      manager.findOne.mockResolvedValue(stock());

      const result = await service.reserve('part-1', 1, 'jc-1', 'tech-1', 'tech-1', NOW, undefined, 'Supervisor Raj (phone)', 'No TL reachable, urgent customer pickup');

      expect(result.reworkApprovedByUserId).toBeNull();
      expect(result.reworkVerbalOverrideBy).toBe('Supervisor Raj (phone)');
      expect(result.reworkVerbalOverrideNotes).toBe('No TL reachable, urgent customer pickup');
    });

    it('an ordinary (non-rework) reserve leaves all three rework fields null', async () => {
      manager.findOne.mockResolvedValue(stock());

      const result = await service.reserve('part-1', 1, 'jc-1', 'tech-1', 'tech-1', NOW);

      expect(result.reworkApprovedByUserId).toBeNull();
      expect(result.reworkVerbalOverrideBy).toBeNull();
      expect(result.reworkVerbalOverrideNotes).toBeNull();
    });
  });

  describe('hasPriorReservationForPart - Phase 6 rework-gate support', () => {
    it('returns true when any reservation (regardless of status) already exists for this job+part', async () => {
      reservationRepository.count = jest.fn().mockResolvedValue(1);

      const result = await service.hasPriorReservationForPart('jc-1', 'part-1');

      expect(result).toBe(true);
      expect(reservationRepository.count).toHaveBeenCalledWith({ where: { jobCardId: 'jc-1', sparePartId: 'part-1' } });
    });

    it('returns false when this part has never been requested on this job before', async () => {
      reservationRepository.count = jest.fn().mockResolvedValue(0);

      const result = await service.hasPriorReservationForPart('jc-1', 'part-new');

      expect(result).toBe(false);
    });
  });

  describe('confirmReturn - the only mutation point invariant', () => {
    it('increments quantityOnHand and decrements quantityReserved on a valid confirm', async () => {
      reservationRepository.findOne.mockResolvedValue(reservation({ status: ReservationStatus.RETURN_PENDING, quantityReserved: 3 }));
      manager.findOne.mockResolvedValue(stock({ quantityOnHand: 7, quantityReserved: 3 }));

      const result = await service.confirmReturn('res-1', 3, 'clerk-1', NOW);

      expect(result.status).toBe(ReservationStatus.RETURNED);
      expect(manager.save).toHaveBeenCalledWith(expect.objectContaining({ quantityOnHand: 10, quantityReserved: 0 }));
    });

    it('rejects confirming from any status other than RETURN_PENDING', async () => {
      reservationRepository.findOne.mockResolvedValue(reservation({ status: ReservationStatus.HELD }));

      await expect(service.confirmReturn('res-1', 3, 'clerk-1', NOW)).rejects.toThrow(BadRequestException);
    });

    it('rejects returning more than was ever reserved', async () => {
      reservationRepository.findOne.mockResolvedValue(reservation({ status: ReservationStatus.RETURN_PENDING, quantityReserved: 2 }));

      await expect(service.confirmReturn('res-1', 5, 'clerk-1', NOW)).rejects.toThrow(BadRequestException);
    });

    it.each([
      ['review/APPROVE_REALLOCATION', () => {
        reservationRepository.findOne.mockResolvedValue(reservation({ status: ReservationStatus.HELD }));
        return service.review('res-1', ReviewDecision.APPROVE_REALLOCATION, 'tl-1', undefined, NOW);
      }],
      ['review/REJECT', () => {
        reservationRepository.findOne.mockResolvedValue(reservation({ status: ReservationStatus.HELD }));
        return service.review('res-1', ReviewDecision.REJECT, 'tl-1', undefined, NOW);
      }],
      ['requestReturn', () => {
        reservationRepository.findOne.mockResolvedValue(reservation({ status: ReservationStatus.HELD }));
        return service.requestReturn('res-1', 'tech-1', false);
      }],
    ])('%s never touches quantityOnHand - only confirmReturn does', async (_name, run) => {
      await run();
      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  describe('review - snooze not exemption', () => {
    it('APPROVE_REALLOCATION moves to RETURN_PENDING without touching stock', async () => {
      reservationRepository.findOne.mockResolvedValue(reservation({ status: ReservationStatus.HELD }));

      const result = await service.review('res-1', ReviewDecision.APPROVE_REALLOCATION, 'tl-1', 'checked with tech', NOW);

      expect(result.status).toBe(ReservationStatus.RETURN_PENDING);
    });

    it('REJECT leaves status unchanged but resets lastReviewedAt', async () => {
      reservationRepository.findOne.mockResolvedValue(reservation({ status: ReservationStatus.HELD, lastReviewedAt: null }));

      const result = await service.review('res-1', ReviewDecision.REJECT, 'tl-1', 'still needed', NOW);

      expect(result.status).toBe(ReservationStatus.HELD);
      expect(result.lastReviewedAt).toBe(NOW);
    });

    it('a rejected reservation is NOT stale immediately after review', async () => {
      const r = reservation({ status: ReservationStatus.HELD, lastReviewedAt: NOW, requestedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 100) });
      reservationRepository.find.mockResolvedValue([r]);

      const stale = await service.getStaleReservations(NOW);

      expect(stale).toHaveLength(0);
    });

    it('a rejected reservation resurfaces as stale once another STALE_HOURS pass from lastReviewedAt', async () => {
      const reviewedAt = new Date(NOW.getTime() - (STALE_HOURS + 1) * 60 * 60 * 1000);
      const r = reservation({ status: ReservationStatus.HELD, lastReviewedAt: reviewedAt });
      reservationRepository.find.mockResolvedValue([r]);

      const stale = await service.getStaleReservations(NOW);

      expect(stale).toHaveLength(1);
      expect(stale[0].id).toBe('res-1');
    });

    it('rejects reviewing a reservation already RETURN_PENDING or RETURNED', async () => {
      reservationRepository.findOne.mockResolvedValue(reservation({ status: ReservationStatus.RETURNED }));

      await expect(service.review('res-1', ReviewDecision.REJECT, 'tl-1', undefined, NOW)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getStaleReservations - inactive custodian surfaced first', () => {
    it('surfaces an inactive-custodian reservation even when it is brand new (age 0)', async () => {
      const fresh = reservation({ id: 'res-fresh', requestedAt: NOW, custodian: { status: UserStatus.INACTIVE } });
      const old = reservation({
        id: 'res-old',
        requestedAt: new Date(NOW.getTime() - (STALE_HOURS + 5) * 60 * 60 * 1000),
        custodian: { status: UserStatus.ACTIVE },
      });
      reservationRepository.find.mockResolvedValue([fresh, old]);

      const stale = await service.getStaleReservations(NOW);

      expect(stale[0].id).toBe('res-fresh');
      expect(stale[0].custodianActive).toBe(false);
    });
  });

  describe('getPendingNeedSpareRequests (2026-09-07 fix - the previously-missing listing)', () => {
    it('returns only PENDING_REVIEW reservations, oldest first, with sparePart/jobCard/requestedBy relations requested', async () => {
      reservationRepository.find.mockResolvedValue([reservation({ id: 'res-1', status: ReservationStatus.PENDING_REVIEW })]);

      const result = await service.getPendingNeedSpareRequests();

      expect(reservationRepository.find).toHaveBeenCalledWith({
        where: { status: ReservationStatus.PENDING_REVIEW },
        relations: { sparePart: true, jobCard: true, requestedBy: true },
        order: { requestedAt: 'ASC' },
      });
      expect(result).toEqual([reservation({ id: 'res-1', status: ReservationStatus.PENDING_REVIEW })]);
    });

    it('returns an empty array when nothing is pending review', async () => {
      reservationRepository.find.mockResolvedValue([]);

      const result = await service.getPendingNeedSpareRequests();

      expect(result).toEqual([]);
    });
  });

  describe('findLatestNeedSpareRequestForJobCard (2026-09-07 mobile "forgotten request" fix)', () => {
    it('queries scoped to this job card and idempotencyKey IS NOT NULL, ordered newest first', async () => {
      reservationRepository.findOne.mockResolvedValue(reservation({ idempotencyKey: 'a1b2c3-tap-1' }));

      await service.findLatestNeedSpareRequestForJobCard('jc-1');

      const call = reservationRepository.findOne.mock.calls[0][0];
      expect(call.where.jobCardId).toBe('jc-1');
      expect(call.order).toEqual({ requestedAt: 'DESC' });
      expect(call.relations).toEqual({ sparePart: true });
      // Not() + IsNull() compiles to an operator object, not a plain value - just confirm
      // the where clause isn't accidentally scoping on a literal null/undefined instead.
      expect(call.where.idempotencyKey).toBeDefined();
    });

    it('returns null when this job card has no mobile-originated Need Spare request', async () => {
      reservationRepository.findOne.mockResolvedValue(null);

      const result = await service.findLatestNeedSpareRequestForJobCard('jc-1');

      expect(result).toBeNull();
    });
  });

  describe('hasUnresolvedStaleReservation - the request-spare block gate', () => {
    it('returns null when nothing on the job is past BLOCK_HOURS', async () => {
      const r = reservation({ requestedAt: new Date(NOW.getTime() - (STALE_HOURS + 1) * 60 * 60 * 1000) });
      reservationRepository.find.mockResolvedValue([r]);

      const blocking = await service.hasUnresolvedStaleReservation('jc-1', NOW);

      expect(blocking).toBeNull();
    });

    it('returns the blocking reservation once it passes BLOCK_HOURS unreviewed', async () => {
      const r = reservation({ requestedAt: new Date(NOW.getTime() - (BLOCK_HOURS + 1) * 60 * 60 * 1000) });
      reservationRepository.find.mockResolvedValue([r]);

      const blocking = await service.hasUnresolvedStaleReservation('jc-1', NOW);

      expect(blocking?.id).toBe('res-1');
    });
  });

  describe('requestReturn', () => {
    it('the custodian can request their own return', async () => {
      reservationRepository.findOne.mockResolvedValue(reservation({ custodianUserId: 'tech-1', status: ReservationStatus.HELD }));

      const result = await service.requestReturn('res-1', 'tech-1', false);

      expect(result.status).toBe(ReservationStatus.RETURN_PENDING);
    });

    it('a non-custodian, non-privileged caller is forbidden', async () => {
      reservationRepository.findOne.mockResolvedValue(reservation({ custodianUserId: 'tech-1', status: ReservationStatus.HELD }));

      await expect(service.requestReturn('res-1', 'someone-else', false)).rejects.toThrow(ForbiddenException);
    });

    it('a privileged caller (TL+) can request a return on the technician\'s behalf', async () => {
      reservationRepository.findOne.mockResolvedValue(reservation({ custodianUserId: 'tech-1', status: ReservationStatus.HELD }));

      const result = await service.requestReturn('res-1', 'tl-1', true);

      expect(result.status).toBe(ReservationStatus.RETURN_PENDING);
    });
  });

  describe('cancelReservationsForJobCard', () => {
    it('moves every active reservation on the job to RETURN_PENDING, never touching stock', async () => {
      const active = [reservation({ id: 'res-a', status: ReservationStatus.HELD }), reservation({ id: 'res-b', status: ReservationStatus.PARTIALLY_RESERVED })];
      reservationRepository.find.mockResolvedValue(active);
      reservationRepository.save.mockImplementation((entities: any) => Promise.resolve(entities));

      const result = await service.cancelReservationsForJobCard('jc-1');

      expect(result).toHaveLength(2);
      expect(result.every((r: any) => r.status === ReservationStatus.RETURN_PENDING)).toBe(true);
      expect(manager.save).not.toHaveBeenCalled(); // quantityOnHand untouched
    });

    it('is a no-op when the job has no active reservations', async () => {
      reservationRepository.find.mockResolvedValue([]);

      const result = await service.cancelReservationsForJobCard('jc-1');

      expect(result).toEqual([]);
      expect(reservationRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('consumeReservationsOnQcApproval - Phase 6 (FR-10), one atomic transaction', () => {
    const readyJobCard = (overrides: any = {}) =>
      ({
        id: 'jc-1',
        status: JobCardStatus.READY_FOR_QC,
        qcApprovedByUserId: null,
        qcApprovedAt: null,
        ...overrides,
      } as any);

    // Wires manager.findOne to dispatch by entity class, the way the real TypeORM
    // EntityManager does - JobCard lookups return `jobCard`, InventoryStock lookups
    // return whatever `stocks` has keyed by `${sparePartId}:${location}` (undefined/null
    // when the row doesn't exist yet, mirroring a fresh DAMAGE_LOCATION row).
    function wireManager(jobCard: any, stocks: Record<string, any>) {
      manager.findOne.mockImplementation((entityClass: any, opts: any) => {
        if (entityClass === JobCard) {
          return Promise.resolve(jobCard);
        }
        if (entityClass === InventoryStock) {
          const key = `${opts.where.sparePartId}:${opts.where.location}`;
          return Promise.resolve(stocks[key] ?? null);
        }
        return Promise.resolve(null);
      });
    }

    // manager.find is called twice by consumeReservationsOnQcApproval - once for active
    // (HELD/PARTIALLY_RESERVED) reservations (an array `where`, matching either status),
    // once for PENDING_REVIEW ones (a plain object `where`). Dispatch on that shape rather
    // than call order, and default pendingReview to [] so every existing test in this
    // describe block (written before the orphan fix) keeps its original behavior untouched.
    function wireReservations(active: any[], pendingReview: any[] = []) {
      manager.find.mockImplementation((_entityClass: any, opts: any) => {
        if (Array.isArray(opts?.where)) {
          return Promise.resolve(active);
        }
        return Promise.resolve(pendingReview);
      });
    }

    it('happy path: consumes the reservation, moves stock Main Store -> Damage Location, and passes the job - all in one transaction', async () => {
      const jc = readyJobCard();
      wireManager(jc, {
        'part-1:MAIN_STORE': stock({ sparePartId: 'part-1', quantityOnHand: 10, quantityReserved: 3 }),
      });
      wireReservations([reservation({ sparePartId: 'part-1', status: ReservationStatus.HELD, quantityReserved: 3 })]);

      const result = await service.consumeReservationsOnQcApproval('jc-1', 'qc-officer-1', NOW);

      expect(result.status).toBe(JobCardStatus.QC_PASSED);
      expect(result.qcApprovedByUserId).toBe('qc-officer-1');
      expect(result.qcApprovedAt).toBe(NOW);

      expect(manager.save).toHaveBeenCalledWith(expect.objectContaining({ sparePartId: 'part-1', location: InventoryLocation.MAIN_STORE, quantityOnHand: 7, quantityReserved: 0 }));
      expect(manager.save).toHaveBeenCalledWith(expect.objectContaining({ sparePartId: 'part-1', location: InventoryLocation.DAMAGE_LOCATION, quantityOnHand: 3 }));
      expect(manager.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'res-1', status: ReservationStatus.CONSUMED, consumedByUserId: 'qc-officer-1', consumedAt: NOW }));
    });

    it('creates a fresh DAMAGE_LOCATION stock row the first time a part is ever consumed', async () => {
      const jc = readyJobCard();
      wireManager(jc, {
        'part-1:MAIN_STORE': stock({ sparePartId: 'part-1', quantityOnHand: 5, quantityReserved: 2 }),
        // no 'part-1:DAMAGE_LOCATION' entry - simulates it not existing yet
      });
      wireReservations([reservation({ sparePartId: 'part-1', status: ReservationStatus.HELD, quantityReserved: 2 })]);

      await service.consumeReservationsOnQcApproval('jc-1', 'qc-officer-1', NOW);

      // manager.create() is called with a fresh {quantityOnHand: 0, quantityReserved: 0}
      // row - checked via the mock's own arguments below, not the mutated result (the
      // returned object is subsequently incremented in-place by the same code path, same
      // as a real TypeORM entity would be, so asserting only sparePartId/location here
      // avoids coupling this test to that later mutation).
      const createCall = manager.create.mock.calls.find((c: any) => c[0] === InventoryStock && c[1]?.location === InventoryLocation.DAMAGE_LOCATION);
      expect(createCall[1]).toEqual(expect.objectContaining({ sparePartId: 'part-1', location: InventoryLocation.DAMAGE_LOCATION }));
      // and the final saved state reflects the consumption having been applied on top of that fresh row
      expect(manager.save).toHaveBeenCalledWith(expect.objectContaining({ sparePartId: 'part-1', location: InventoryLocation.DAMAGE_LOCATION, quantityOnHand: 2 }));
    });

    it('rejects a job that is not READY_FOR_QC', async () => {
      wireManager(readyJobCard({ status: JobCardStatus.IN_PROGRESS }), {});

      await expect(service.consumeReservationsOnQcApproval('jc-1', 'qc-officer-1', NOW)).rejects.toThrow(BadRequestException);
      expect(manager.save).not.toHaveBeenCalled();
    });

    // independent test-master QA pass (2026-09-07): confirms the orphan fix's auto-reject
    // loop only ever runs AFTER every existing blocking check (status guard, shortfall
    // gate) has already passed - a blocked approval must never prematurely auto-reject a
    // Need Spare request that's still genuinely awaiting Team Leader review, since the job
    // hasn't actually reached QC_PASSED at all in that case.
    it('a shortfall block on a DIFFERENT part leaves a still-PENDING_REVIEW reservation completely untouched', async () => {
      const jc = readyJobCard();
      wireManager(jc, { 'part-short:MAIN_STORE': stock({ sparePartId: 'part-short', quantityOnHand: 10, quantityReserved: 2 }) });
      wireReservations(
        [reservation({ id: 'res-short', sparePartId: 'part-short', status: ReservationStatus.PARTIALLY_RESERVED, quantityRequested: 5, quantityReserved: 2 })],
        [reservation({ id: 'res-pending', sparePartId: 'part-pending', status: ReservationStatus.PENDING_REVIEW })],
      );

      await expect(service.consumeReservationsOnQcApproval('jc-1', 'qc-officer-1', NOW)).rejects.toThrow(ConflictException);

      expect(manager.update).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('a Job Card not READY_FOR_QC never touches a PENDING_REVIEW reservation on it either', async () => {
      wireManager(readyJobCard({ status: JobCardStatus.IN_PROGRESS }), {});
      wireReservations([], [reservation({ id: 'res-pending', sparePartId: 'part-1', status: ReservationStatus.PENDING_REVIEW })]);

      await expect(service.consumeReservationsOnQcApproval('jc-1', 'qc-officer-1', NOW)).rejects.toThrow(BadRequestException);

      expect(manager.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the Job Card does not exist', async () => {
      wireManager(null, {});

      await expect(service.consumeReservationsOnQcApproval('missing', 'qc-officer-1', NOW)).rejects.toThrow(NotFoundException);
    });

    it('the negative-inventory gate: blocks approval when a spare part is still short overall (a lone PARTIALLY_RESERVED row, no top-up)', async () => {
      const jc = readyJobCard();
      wireManager(jc, { 'part-1:MAIN_STORE': stock({ sparePartId: 'part-1', quantityOnHand: 10, quantityReserved: 2 }) });
      wireReservations([
        reservation({ sparePartId: 'part-1', status: ReservationStatus.PARTIALLY_RESERVED, quantityReserved: 2, quantityRequested: 5 }),
      ]);

      await expect(service.consumeReservationsOnQcApproval('jc-1', 'qc-officer-1', NOW)).rejects.toThrow(ConflictException);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('does NOT block when a Phase 5 top-up (a separate follow-up reservation row) already fully covers the original shortfall', async () => {
      // Original request for 10 only got 3 (PARTIALLY_RESERVED, never mutated after the
      // fact) - then more stock arrived and the technician topped up the remaining 7 as a
      // brand new reservation row (HELD). Together they cover the original 10 - QC
      // approval must NOT be blocked just because the old row still says PARTIALLY_RESERVED.
      const jc = readyJobCard();
      wireManager(jc, { 'part-1:MAIN_STORE': stock({ sparePartId: 'part-1', quantityOnHand: 20, quantityReserved: 10 }) });
      const earlier = new Date(NOW.getTime() - 60 * 60 * 1000);
      wireReservations([
        reservation({ id: 'res-original', sparePartId: 'part-1', status: ReservationStatus.PARTIALLY_RESERVED, quantityRequested: 10, quantityReserved: 3, requestedAt: earlier }),
        reservation({ id: 'res-topup', sparePartId: 'part-1', status: ReservationStatus.HELD, quantityRequested: 7, quantityReserved: 7, requestedAt: NOW }),
      ]);

      const result = await service.consumeReservationsOnQcApproval('jc-1', 'qc-officer-1', NOW);

      expect(result.status).toBe(JobCardStatus.QC_PASSED);
      // both rows get consumed together - 3 + 7 = 10 total moved to Damage Location
      expect(manager.save).toHaveBeenCalledWith(expect.objectContaining({ sparePartId: 'part-1', location: InventoryLocation.DAMAGE_LOCATION, quantityOnHand: 10 }));
    });

    it('defensive invariant: blocks (rather than going negative) if recorded on-hand stock is somehow less than what is reserved', async () => {
      const jc = readyJobCard();
      wireManager(jc, { 'part-1:MAIN_STORE': stock({ sparePartId: 'part-1', quantityOnHand: 1, quantityReserved: 1 }) });
      wireReservations([reservation({ sparePartId: 'part-1', status: ReservationStatus.HELD, quantityReserved: 3 })]);

      await expect(service.consumeReservationsOnQcApproval('jc-1', 'qc-officer-1', NOW)).rejects.toThrow(ConflictException);
    });

    it('a job with no spare reservations at all still passes QC (a repair needing no parts)', async () => {
      const jc = readyJobCard();
      wireManager(jc, {});
      wireReservations([]);

      const result = await service.consumeReservationsOnQcApproval('jc-1', 'qc-officer-1', NOW);

      expect(result.status).toBe(JobCardStatus.QC_PASSED);
    });

    it('blocks on a still-short part even when a DIFFERENT, unrelated part on the same job was fully reserved (closes a Phase 5 gap: the job-level SPARE_PENDING/IN_PROGRESS flip only ever looks at the latest request, not per-part)', async () => {
      const jc = readyJobCard();
      wireManager(jc, {
        'part-short:MAIN_STORE': stock({ sparePartId: 'part-short', quantityOnHand: 10, quantityReserved: 2 }),
        'part-ok:MAIN_STORE': stock({ sparePartId: 'part-ok', quantityOnHand: 10, quantityReserved: 1 }),
      });
      wireReservations([
        reservation({ id: 'res-short', sparePartId: 'part-short', status: ReservationStatus.PARTIALLY_RESERVED, quantityRequested: 5, quantityReserved: 2 }),
        // this unrelated part being fully held is what flipped the Job Card back to
        // IN_PROGRESS in WorkshopService, letting it reach READY_FOR_QC at all
        reservation({ id: 'res-ok', sparePartId: 'part-ok', status: ReservationStatus.HELD, quantityRequested: 1, quantityReserved: 1 }),
      ]);

      await expect(service.consumeReservationsOnQcApproval('jc-1', 'qc-officer-1', NOW)).rejects.toThrow(ConflictException);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('locking order (the-fool fix #1): locks the job card first, then every distinct spare part sorted alphabetically', async () => {
      const jc = readyJobCard();
      wireManager(jc, {
        'part-b:MAIN_STORE': stock({ sparePartId: 'part-b', quantityOnHand: 10, quantityReserved: 1 }),
        'part-a:MAIN_STORE': stock({ sparePartId: 'part-a', quantityOnHand: 10, quantityReserved: 1 }),
      });
      wireReservations([
        reservation({ id: 'res-b', sparePartId: 'part-b', status: ReservationStatus.HELD, quantityReserved: 1 }),
        reservation({ id: 'res-a', sparePartId: 'part-a', status: ReservationStatus.HELD, quantityReserved: 1 }),
      ]);

      await service.consumeReservationsOnQcApproval('jc-1', 'qc-officer-1', NOW);

      const lockCalls = manager.query.mock.calls.map((c: any) => c[1][0]);
      expect(lockCalls).toEqual(['jobcard:jc-1', 'part-a', 'part-b']);
    });

    // --- 2026-09-07: the orphaned Need Spare reservation fix ---------------------------
    describe('auto-rejects still-PENDING_REVIEW reservations (the orphaned Need Spare fix)', () => {
      it('auto-rejects a PENDING_REVIEW reservation nobody reviewed, with no stock movement', async () => {
        const jc = readyJobCard();
        wireManager(jc, {});
        wireReservations(
          [],
          [reservation({ id: 'res-pending', sparePartId: 'part-1', status: ReservationStatus.PENDING_REVIEW, quantityReserved: 0 })],
        );

        const result = await service.consumeReservationsOnQcApproval('jc-1', 'qc-officer-1', NOW);

        expect(result.status).toBe(JobCardStatus.QC_PASSED);
        expect(manager.update).toHaveBeenCalledWith(
          InventoryReservation,
          { id: 'res-pending', status: ReservationStatus.PENDING_REVIEW },
          expect.objectContaining({
            status: ReservationStatus.REJECTED,
            reviewedByUserId: 'qc-officer-1',
            lastReviewedAt: NOW,
            notes: expect.stringContaining('Auto-rejected'),
          }),
        );
        // No InventoryStock lookup/save for a part that only ever had a PENDING_REVIEW
        // request - nothing was ever reserved, so there's nothing to consume.
        expect(manager.findOne).not.toHaveBeenCalledWith(InventoryStock, expect.anything());
      });

      it('auto-rejects every PENDING_REVIEW reservation on the job when there is more than one', async () => {
        const jc = readyJobCard();
        wireManager(jc, {});
        wireReservations(
          [],
          [
            reservation({ id: 'res-pending-1', sparePartId: 'part-1', status: ReservationStatus.PENDING_REVIEW }),
            reservation({ id: 'res-pending-2', sparePartId: 'part-2', status: ReservationStatus.PENDING_REVIEW }),
          ],
        );

        await service.consumeReservationsOnQcApproval('jc-1', 'qc-officer-1', NOW);

        expect(manager.update).toHaveBeenCalledWith(InventoryReservation, { id: 'res-pending-1', status: ReservationStatus.PENDING_REVIEW }, expect.anything());
        expect(manager.update).toHaveBeenCalledWith(InventoryReservation, { id: 'res-pending-2', status: ReservationStatus.PENDING_REVIEW }, expect.anything());
      });

      it('does NOT touch an already-HELD reservation for the same part a PENDING_REVIEW request also exists for', async () => {
        // A job can have both a fully-held reservation (from a reviewed request) AND a
        // separate still-pending one for the same part (a technician tapped Need Spare
        // twice) - only the PENDING_REVIEW row should be auto-rejected; the HELD one
        // still gets consumed normally.
        const jc = readyJobCard();
        wireManager(jc, { 'part-1:MAIN_STORE': stock({ sparePartId: 'part-1', quantityOnHand: 10, quantityReserved: 3 }) });
        wireReservations(
          [reservation({ id: 'res-held', sparePartId: 'part-1', status: ReservationStatus.HELD, quantityReserved: 3 })],
          [reservation({ id: 'res-pending', sparePartId: 'part-1', status: ReservationStatus.PENDING_REVIEW })],
        );

        const result = await service.consumeReservationsOnQcApproval('jc-1', 'qc-officer-1', NOW);

        expect(result.status).toBe(JobCardStatus.QC_PASSED);
        expect(manager.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'res-held', status: ReservationStatus.CONSUMED }));
        expect(manager.update).toHaveBeenCalledWith(InventoryReservation, { id: 'res-pending', status: ReservationStatus.PENDING_REVIEW }, expect.anything());
      });

      it('folds PENDING_REVIEW spare parts into the same sorted advisory-lock set as active reservations (race safety)', async () => {
        // part-a only has a PENDING_REVIEW request, part-b only has a HELD one - both must
        // be locked (in sorted order) so a concurrent reviewNeedSpareRequest(APPROVE) on
        // part-a's reservation can never interleave with this auto-reject.
        const jc = readyJobCard();
        wireManager(jc, { 'part-b:MAIN_STORE': stock({ sparePartId: 'part-b', quantityOnHand: 10, quantityReserved: 1 }) });
        wireReservations(
          [reservation({ id: 'res-b', sparePartId: 'part-b', status: ReservationStatus.HELD, quantityReserved: 1 })],
          [reservation({ id: 'res-a', sparePartId: 'part-a', status: ReservationStatus.PENDING_REVIEW })],
        );

        await service.consumeReservationsOnQcApproval('jc-1', 'qc-officer-1', NOW);

        const lockCalls = manager.query.mock.calls.map((c: any) => c[1][0]);
        expect(lockCalls).toEqual(['jobcard:jc-1', 'part-a', 'part-b']);
      });

      it('never throws or looks up MAIN_STORE stock for a part that only ever had a PENDING_REVIEW request (no GRN done yet)', async () => {
        // Regression guard for a bug caught in review: folding PENDING_REVIEW spare parts
        // into the CONSUME loop (rather than just the lock-acquisition set) would wrongly
        // throw "no stock record" for a part nobody ever actually reserved stock for.
        const jc = readyJobCard();
        wireManager(jc, {}); // no InventoryStock row exists for 'part-never-grnd' at all
        wireReservations(
          [],
          [reservation({ id: 'res-pending', sparePartId: 'part-never-grnd', status: ReservationStatus.PENDING_REVIEW })],
        );

        const result = await service.consumeReservationsOnQcApproval('jc-1', 'qc-officer-1', NOW);

        expect(result.status).toBe(JobCardStatus.QC_PASSED);
      });

      it('a job with only a PENDING_REVIEW reservation and nothing else still passes QC', async () => {
        const jc = readyJobCard();
        wireManager(jc, {});
        wireReservations([], [reservation({ id: 'res-pending', sparePartId: 'part-1', status: ReservationStatus.PENDING_REVIEW })]);

        const result = await service.consumeReservationsOnQcApproval('jc-1', 'qc-officer-1', NOW);

        expect(result.status).toBe(JobCardStatus.QC_PASSED);
        expect(result.qcApprovedByUserId).toBe('qc-officer-1');
      });

      it('does not error or double-process if the guarded update reports 0 rows affected (a TL/technician already resolved it in a genuine race)', async () => {
        const jc = readyJobCard();
        wireManager(jc, {});
        wireReservations([], [reservation({ id: 'res-pending', sparePartId: 'part-1', status: ReservationStatus.PENDING_REVIEW })]);
        manager.update.mockResolvedValue({ affected: 0 });

        const result = await service.consumeReservationsOnQcApproval('jc-1', 'qc-officer-1', NOW);

        expect(result.status).toBe(JobCardStatus.QC_PASSED);
      });
    });
  });

  // --- Mobile Phase 5: Need Spare + reassignment-guardrail support ---------------------

  describe('requestNeedSpare', () => {
    it('creates a PENDING_REVIEW reservation with no stock movement', async () => {
      sparePartRepository.findOne.mockResolvedValue({ id: 'part-1', code: 'P-1' });

      const result = await service.requestNeedSpare('part-1', 2, 'jc-1', 'tech-1', 'tech-1', 'tap-key-1', NOW);

      expect(result.status).toBe(ReservationStatus.PENDING_REVIEW);
      expect(result.quantityReserved).toBe(0);
      expect(result.quantityRequested).toBe(2);
      expect(result.idempotencyKey).toBe('tap-key-1');
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(stockRepository.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown spare part', async () => {
      sparePartRepository.findOne.mockResolvedValue(null);

      await expect(
        service.requestNeedSpare('missing-part', 1, 'jc-1', 'tech-1', 'tech-1', 'tap-key-1', NOW),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the original row instead of erroring on a retried offline-queue sync (same idempotencyKey)', async () => {
      sparePartRepository.findOne.mockResolvedValue({ id: 'part-1', code: 'P-1' });
      const duplicateError: any = new Error('duplicate key value violates unique constraint');
      duplicateError.code = '23505';
      reservationRepository.save.mockRejectedValueOnce(duplicateError);
      const original = reservation({ id: 'res-1', status: ReservationStatus.PENDING_REVIEW, idempotencyKey: 'tap-key-1' });
      reservationRepository.findOne.mockResolvedValue(original);

      const result = await service.requestNeedSpare('part-1', 2, 'jc-1', 'tech-1', 'tech-1', 'tap-key-1', NOW);

      expect(result).toEqual(original);
      expect(reservationRepository.findOne).toHaveBeenCalledWith({ where: { jobCardId: 'jc-1', idempotencyKey: 'tap-key-1' } });
    });

    it('re-throws a non-duplicate database error rather than swallowing it', async () => {
      sparePartRepository.findOne.mockResolvedValue({ id: 'part-1', code: 'P-1' });
      reservationRepository.save.mockRejectedValueOnce(new Error('connection reset'));

      await expect(
        service.requestNeedSpare('part-1', 2, 'jc-1', 'tech-1', 'tech-1', 'tap-key-1', NOW),
      ).rejects.toThrow('connection reset');
    });
  });

  describe('reviewNeedSpareRequest', () => {
    const pending = (overrides: any = {}) => reservation({ status: ReservationStatus.PENDING_REVIEW, quantityReserved: 0, ...overrides });

    it('REJECT closes the request with no stock touched', async () => {
      reservationRepository.findOne.mockResolvedValue(pending());

      const result = await service.reviewNeedSpareRequest('res-1', NeedSpareReviewDecision.REJECT, 'lead-1', 'Not actually needed', NOW);

      expect(result.status).toBe(ReservationStatus.REJECTED);
      expect(result.needSpareDecision).toBe(NeedSpareReviewDecision.REJECT);
      expect(result.reviewedByUserId).toBe('lead-1');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('APPROVE moves real stock and fully reserves when available - status HELD', async () => {
      reservationRepository.findOne.mockResolvedValue(pending({ quantityRequested: 2 }));
      manager.findOne.mockResolvedValue(stock({ quantityOnHand: 10, quantityReserved: 0 }));

      const result = await service.reviewNeedSpareRequest('res-1', NeedSpareReviewDecision.APPROVE, 'lead-1', undefined, NOW);

      expect(result.status).toBe(ReservationStatus.HELD);
      expect(result.quantityReserved).toBe(2);
      expect(result.needSpareDecision).toBe(NeedSpareReviewDecision.APPROVE);
      expect(manager.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', ['part-1']);
    });

    it('APPROVE with insufficient stock reserves what is available - status PARTIALLY_RESERVED', async () => {
      reservationRepository.findOne.mockResolvedValue(pending({ quantityRequested: 5 }));
      manager.findOne.mockResolvedValue(stock({ quantityOnHand: 3, quantityReserved: 0 }));

      const result = await service.reviewNeedSpareRequest('res-1', NeedSpareReviewDecision.APPROVE, 'lead-1', undefined, NOW);

      expect(result.status).toBe(ReservationStatus.PARTIALLY_RESERVED);
      expect(result.quantityReserved).toBe(3);
    });

    it('throws NotFoundException on APPROVE when no stock record exists yet', async () => {
      reservationRepository.findOne.mockResolvedValue(pending());
      manager.findOne.mockResolvedValue(null);

      await expect(
        service.reviewNeedSpareRequest('res-1', NeedSpareReviewDecision.APPROVE, 'lead-1', undefined, NOW),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the reservation is not PENDING_REVIEW', async () => {
      reservationRepository.findOne.mockResolvedValue(reservation({ status: ReservationStatus.HELD }));

      await expect(
        service.reviewNeedSpareRequest('res-1', NeedSpareReviewDecision.APPROVE, 'lead-1', undefined, NOW),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('releaseReservation - the reassignment-guardrail escape hatch', () => {
    it('closes a still-PENDING_REVIEW reservation directly to REJECTED - nothing to physically return', async () => {
      reservationRepository.findOne.mockResolvedValue(reservation({ status: ReservationStatus.PENDING_REVIEW, quantityReserved: 0 }));

      const result = await service.releaseReservation('res-1', 'lead-1', 'Reassigning job', NOW);

      expect(result.status).toBe(ReservationStatus.REJECTED);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('moves a HELD reservation to RETURN_PENDING and frees the stock-level quantityReserved', async () => {
      reservationRepository.findOne.mockResolvedValue(reservation({ status: ReservationStatus.HELD, quantityReserved: 4 }));
      manager.findOne.mockResolvedValue(stock({ quantityOnHand: 10, quantityReserved: 4 }));

      const result = await service.releaseReservation('res-1', 'lead-1', undefined, NOW);

      expect(result.status).toBe(ReservationStatus.RETURN_PENDING);
      const savedStock = manager.save.mock.calls[0][0];
      expect(savedStock.quantityReserved).toBe(0);
    });

    it('floors quantityReserved at zero rather than going negative on a data mismatch', async () => {
      reservationRepository.findOne.mockResolvedValue(reservation({ status: ReservationStatus.PARTIALLY_RESERVED, quantityReserved: 10 }));
      manager.findOne.mockResolvedValue(stock({ quantityOnHand: 10, quantityReserved: 3 }));

      await service.releaseReservation('res-1', 'lead-1', undefined, NOW);

      const savedStock = manager.save.mock.calls[0][0];
      expect(savedStock.quantityReserved).toBe(0);
    });

    it('throws BadRequestException for a reservation already RETURNED/CONSUMED/REJECTED', async () => {
      reservationRepository.findOne.mockResolvedValue(reservation({ status: ReservationStatus.CONSUMED }));

      await expect(service.releaseReservation('res-1', 'lead-1', undefined, NOW)).rejects.toThrow(BadRequestException);
    });
  });

  describe('hasActiveReservationInCustody - the reassignment guardrail\'s read side', () => {
    it('returns true when the technician holds a PENDING_REVIEW/HELD/PARTIALLY_RESERVED reservation on the Job Card', async () => {
      reservationRepository.count.mockResolvedValue(1);

      const result = await service.hasActiveReservationInCustody('jc-1', 'tech-1');

      expect(result).toBe(true);
      expect(reservationRepository.count).toHaveBeenCalledWith({
        where: [
          { jobCardId: 'jc-1', custodianUserId: 'tech-1', status: ReservationStatus.PENDING_REVIEW },
          { jobCardId: 'jc-1', custodianUserId: 'tech-1', status: ReservationStatus.HELD },
          { jobCardId: 'jc-1', custodianUserId: 'tech-1', status: ReservationStatus.PARTIALLY_RESERVED },
        ],
      });
    });

    it('returns false when no matching reservation exists (e.g. only a RETURN_PENDING one)', async () => {
      reservationRepository.count.mockResolvedValue(0);

      const result = await service.hasActiveReservationInCustody('jc-1', 'tech-1');

      expect(result).toBe(false);
    });
  });
});
