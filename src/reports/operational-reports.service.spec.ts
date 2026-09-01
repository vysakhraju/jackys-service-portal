import { OperationalReportsService } from './operational-reports.service';
import { ReservationStatus } from '../inventory/entities/inventory-reservation.entity';

function makeQb(result: any = []) {
  const qb: any = {};
  const chain = ['select', 'addSelect', 'innerJoin', 'where', 'andWhere', 'groupBy', 'addGroupBy', 'orderBy'];
  for (const m of chain) qb[m] = jest.fn(() => qb);
  qb.getMany = jest.fn().mockResolvedValue(result);
  qb.getRawMany = jest.fn().mockResolvedValue(result);
  return qb;
}

describe('OperationalReportsService', () => {
  let service: OperationalReportsService;
  let jobCardRepo: any;
  let visitRepo: any;
  let appointmentRepo: any;
  let userRepo: any;
  let reservationRepo: any;
  let sparePartRepo: any;

  beforeEach(() => {
    jobCardRepo = { createQueryBuilder: jest.fn(() => makeQb([])) };
    visitRepo = {};
    appointmentRepo = {};
    userRepo = { find: jest.fn().mockResolvedValue([]) };
    reservationRepo = { createQueryBuilder: jest.fn(() => makeQb([])) };
    sparePartRepo = { find: jest.fn().mockResolvedValue([]) };

    service = new OperationalReportsService(jobCardRepo, visitRepo, appointmentRepo, userRepo, reservationRepo, sparePartRepo);
  });

  describe('getTechnicianProductivity (zero grace period on-time arrival)', () => {
    it('counts on-time when startedAt is exactly at or before scheduledAt, not after', async () => {
      const scheduled = new Date('2026-08-10T09:00:00.000Z');
      jobCardRepo.createQueryBuilder = jest.fn(() =>
        makeQb([
          { jobCardId: 'jc-1', qcApprovedAt: new Date('2026-08-10T12:00:00.000Z'), technicianId: 'tech-1', startedAt: scheduled, scheduledAt: scheduled }, // exactly on time
          { jobCardId: 'jc-2', qcApprovedAt: new Date('2026-08-10T12:00:00.000Z'), technicianId: 'tech-1', startedAt: new Date(scheduled.getTime() + 1), scheduledAt: scheduled }, // 1ms late
        ]),
      );
      userRepo.find = jest.fn().mockResolvedValue([{ id: 'tech-1', firstName: 'Ali', lastName: 'Khan' }]);

      const report = await service.getTechnicianProductivity();
      const row = report.rows.find((r) => r.technicianId === 'tech-1')!;
      expect(row.jobsCompleted).toBe(2);
      expect(row.onTimeArrivalPct).toBe(50);
    });

    it('does not report a customer rating field anywhere in the response', async () => {
      const report = await service.getTechnicianProductivity();
      expect((report as any).customerRating).toBeUndefined();
      expect(report.rows.every((r) => !('customerRating' in r))).toBe(true);
    });

    it('avgHoursLoginToQc excludes negative/invalid durations from the average but still counts the job as completed', async () => {
      const scheduled = new Date('2026-08-10T09:00:00.000Z');
      jobCardRepo.createQueryBuilder = jest.fn(() =>
        makeQb([
          // Invalid: qcApprovedAt before startedAt (defensive edge case, shouldn't happen given workflow order)
          { jobCardId: 'jc-1', qcApprovedAt: new Date('2026-08-10T08:00:00.000Z'), technicianId: 'tech-1', startedAt: scheduled, scheduledAt: scheduled },
          { jobCardId: 'jc-2', qcApprovedAt: new Date('2026-08-10T11:00:00.000Z'), technicianId: 'tech-1', startedAt: scheduled, scheduledAt: scheduled },
        ]),
      );
      const report = await service.getTechnicianProductivity();
      const row = report.rows[0];
      expect(row.jobsCompleted).toBe(2);
      expect(row.avgHoursLoginToQc).toBe(2);
    });
  });

  describe('getSlaBreach (default 48h threshold, boundary at exactly the threshold)', () => {
    const jc = (createdAt: Date, qcApprovedAt: Date) => ({ id: 'jc-1', jobCardNumber: 'JC-0001', createdAt, qcApprovedAt });

    it('does not flag a job exactly at the threshold (breach requires strictly greater than)', async () => {
      const createdAt = new Date('2026-08-01T00:00:00.000Z');
      const qcApprovedAt = new Date(createdAt.getTime() + 48 * 3_600_000);
      jobCardRepo.createQueryBuilder = jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([jc(createdAt, qcApprovedAt)]),
      }));
      const report = await service.getSlaBreach();
      expect(report.breachedCount).toBe(0);
    });

    it('flags a job past the threshold with the correct hoursOverThreshold', async () => {
      const createdAt = new Date('2026-08-01T00:00:00.000Z');
      const qcApprovedAt = new Date(createdAt.getTime() + 50 * 3_600_000);
      jobCardRepo.createQueryBuilder = jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([jc(createdAt, qcApprovedAt)]),
      }));
      const report = await service.getSlaBreach();
      expect(report.breachedCount).toBe(1);
      expect(report.items[0].hoursOverThreshold).toBe(2);
      expect(report.items[0].hoursElapsed).toBe(50);
    });

    it('respects a custom threshold override', async () => {
      const createdAt = new Date('2026-08-01T00:00:00.000Z');
      const qcApprovedAt = new Date(createdAt.getTime() + 10 * 3_600_000);
      jobCardRepo.createQueryBuilder = jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([jc(createdAt, qcApprovedAt)]),
      }));
      const report = await service.getSlaBreach(8);
      expect(report.thresholdHours).toBe(8);
      expect(report.breachedCount).toBe(1);
    });
  });

  describe('getSpareConsumption (top-10 by quantity/value, cost basis, model/warranty breakdowns)', () => {
    it('computes value as unitCost * quantityReserved, not unitPriceB2B/B2C', async () => {
      reservationRepo.createQueryBuilder = jest.fn(() =>
        makeQb([{ sparePartId: 'sp-1', quantityReserved: 3, warrantyStatus: 'IW', modelNumber: 'RT-500' }]),
      );
      sparePartRepo.find = jest.fn().mockResolvedValue([{ id: 'sp-1', code: 'SP-1', name: 'Compressor', unitCost: 100, unitPriceB2B: 200, unitPriceB2C: 250 }]);

      const report = await service.getSpareConsumption();
      expect(report.topByValue[0].totalValue).toBe(300);
      expect(report.topByQuantity[0].totalQuantity).toBe(3);
    });

    it('truncates topByQuantity and topByValue to 10 entries each', async () => {
      const rows = Array.from({ length: 15 }, (_, i) => ({ sparePartId: `sp-${i}`, quantityReserved: i + 1, warrantyStatus: 'OOW', modelNumber: 'X' }));
      reservationRepo.createQueryBuilder = jest.fn(() => makeQb(rows));
      sparePartRepo.find = jest.fn().mockResolvedValue(rows.map((r) => ({ id: r.sparePartId, code: r.sparePartId, name: r.sparePartId, unitCost: 1 })));

      const report = await service.getSpareConsumption();
      expect(report.topByQuantity).toHaveLength(10);
      expect(report.topByValue).toHaveLength(10);
      // highest quantity (sp-14, qty 15) should be first
      expect(report.topByQuantity[0].sparePartId).toBe('sp-14');
    });

    it('breaks down consumption by model and by warranty/OOW status', async () => {
      reservationRepo.createQueryBuilder = jest.fn(() =>
        makeQb([
          { sparePartId: 'sp-1', quantityReserved: 2, warrantyStatus: 'IW', modelNumber: 'RT-500' },
          { sparePartId: 'sp-1', quantityReserved: 5, warrantyStatus: 'OOW', modelNumber: 'RT-500' },
        ]),
      );
      sparePartRepo.find = jest.fn().mockResolvedValue([{ id: 'sp-1', code: 'SP-1', name: 'Compressor', unitCost: 10 }]);

      const report = await service.getSpareConsumption();
      const model = report.byModel.find((g) => g.key === 'RT-500')!;
      expect(model.totalQuantity).toBe(7);
      const iw = report.byWarrantyStatus.find((g) => g.key === 'IW')!;
      const oow = report.byWarrantyStatus.find((g) => g.key === 'OOW')!;
      expect(iw.totalQuantity).toBe(2);
      expect(oow.totalQuantity).toBe(5);
    });

    it('only considers CONSUMED reservations', async () => {
      const qb = makeQb([]);
      reservationRepo.createQueryBuilder = jest.fn(() => qb);
      await service.getSpareConsumption();
      expect(qb.where).toHaveBeenCalledWith('"res"."status" = :status', { status: ReservationStatus.CONSUMED });
    });
  });
});
