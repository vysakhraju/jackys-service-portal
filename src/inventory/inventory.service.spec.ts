import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InventoryService, STALE_HOURS, BLOCK_HOURS } from './inventory.service';
import { InventoryLocation } from './entities/inventory-stock.entity';
import { ReservationStatus, ReviewDecision } from './entities/inventory-reservation.entity';
import { UserStatus } from '../auth/entities/user.entity';

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
      save: jest.fn((entity) => Promise.resolve(entity)),
      create: jest.fn((_cls, data) => data),
    };
    dataSource = { transaction: jest.fn((cb) => cb(manager)) };
    stockRepository = { findOne: jest.fn() };
    reservationRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn((entity) => Promise.resolve(entity)),
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
});
