import { OperationalReportsService } from './operational-reports.service';
import { ReservationStatus } from '../inventory/entities/inventory-reservation.entity';
import { TaskPauseReason } from '../job-cards/entities/job-card-task-pause.entity';

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
  let faultSymptomRepo: any;
  let taskPauseRepo: any;

  beforeEach(() => {
    jobCardRepo = { createQueryBuilder: jest.fn(() => makeQb([])) };
    visitRepo = {};
    appointmentRepo = {};
    userRepo = { find: jest.fn().mockResolvedValue([]) };
    reservationRepo = { createQueryBuilder: jest.fn(() => makeQb([])) };
    sparePartRepo = { find: jest.fn().mockResolvedValue([]) };
    faultSymptomRepo = { find: jest.fn().mockResolvedValue([]) };
    taskPauseRepo = { find: jest.fn().mockResolvedValue([]), createQueryBuilder: jest.fn(() => makeQb([])) };

    service = new OperationalReportsService(
      jobCardRepo,
      visitRepo,
      appointmentRepo,
      userRepo,
      reservationRepo,
      sparePartRepo,
      faultSymptomRepo,
      taskPauseRepo,
    );
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

  describe('getTechnicianEfficiency (SRT vs actual, per fault code, whole-job approximation)', () => {
    const startedAt = new Date('2026-08-10T09:00:00.000Z');

    it('excludes a job whose fault code has no SRT set, rather than fabricating an efficiency figure', async () => {
      jobCardRepo.createQueryBuilder = jest.fn(() =>
        makeQb([
          {
            jobCardId: 'jc-1', jobCardNumber: 'JC-0001', faultCode: 'F-NO-SRT', qcRejectionCount: 0,
            qcApprovedAt: new Date(startedAt.getTime() + 30 * 60_000), technicianId: 'tech-1', startedAt,
          },
        ]),
      );
      faultSymptomRepo.find = jest.fn().mockResolvedValue([]); // No FaultSymptom row -> no SRT known

      const report = await service.getTechnicianEfficiency();

      expect(report.rows).toHaveLength(0);
      expect(report.summaryByTechnician).toHaveLength(0);
    });

    it('computes efficiencyPercent = SRT / actual * 100, over 100% when the technician beats standard time', async () => {
      jobCardRepo.createQueryBuilder = jest.fn(() =>
        makeQb([
          {
            jobCardId: 'jc-1', jobCardNumber: 'JC-0001', faultCode: 'F001', qcRejectionCount: 0,
            qcApprovedAt: new Date(startedAt.getTime() + 30 * 60_000), technicianId: 'tech-1', startedAt, // 30 actual minutes
          },
        ]),
      );
      faultSymptomRepo.find = jest.fn().mockResolvedValue([{ faultCode: 'F001', standardRepairMinutes: 45 }]);
      userRepo.find = jest.fn().mockResolvedValue([{ id: 'tech-1', firstName: 'Ali', lastName: 'Khan' }]);

      const report = await service.getTechnicianEfficiency();

      expect(report.rows).toHaveLength(1);
      expect(report.rows[0]).toEqual(
        expect.objectContaining({
          standardRepairMinutes: 45,
          actualMinutes: 30,
          efficiencyPercent: 150, // faster than standard
          hadQcRejection: false,
          technicianName: 'Ali Khan',
        }),
      );
    });

    it('flags hadQcRejection when the job card was rejected by QC at least once, and folds it into qcFirstPassPct', async () => {
      jobCardRepo.createQueryBuilder = jest.fn(() =>
        makeQb([
          {
            jobCardId: 'jc-1', jobCardNumber: 'JC-0001', faultCode: 'F001', qcRejectionCount: 0,
            qcApprovedAt: new Date(startedAt.getTime() + 45 * 60_000), technicianId: 'tech-1', startedAt,
          },
          {
            jobCardId: 'jc-2', jobCardNumber: 'JC-0002', faultCode: 'F001', qcRejectionCount: 1,
            qcApprovedAt: new Date(startedAt.getTime() + 45 * 60_000), technicianId: 'tech-1', startedAt,
          },
        ]),
      );
      faultSymptomRepo.find = jest.fn().mockResolvedValue([{ faultCode: 'F001', standardRepairMinutes: 45 }]);

      const report = await service.getTechnicianEfficiency();

      expect(report.rows.find((r) => r.jobCardId === 'jc-2')!.hadQcRejection).toBe(true);
      const summary = report.summaryByTechnician.find((s) => s.technicianId === 'tech-1')!;
      expect(summary.jobsCompleted).toBe(2);
      expect(summary.qcFirstPassPct).toBe(50); // 1 of 2 jobs passed QC with zero rejections
    });

    it('excludes a job with a non-positive/invalid actual duration, same defensive rule as getTechnicianProductivity', async () => {
      jobCardRepo.createQueryBuilder = jest.fn(() =>
        makeQb([
          {
            jobCardId: 'jc-1', jobCardNumber: 'JC-0001', faultCode: 'F001', qcRejectionCount: 0,
            qcApprovedAt: new Date(startedAt.getTime() - 60_000), technicianId: 'tech-1', startedAt, // qcApprovedAt before startedAt
          },
        ]),
      );
      faultSymptomRepo.find = jest.fn().mockResolvedValue([{ faultCode: 'F001', standardRepairMinutes: 45 }]);

      const report = await service.getTechnicianEfficiency();

      expect(report.rows).toHaveLength(0);
    });

    it('averages SRT, actual minutes, and efficiency per technician across multiple jobs, sorted best-efficiency first', async () => {
      jobCardRepo.createQueryBuilder = jest.fn(() =>
        makeQb([
          {
            jobCardId: 'jc-1', jobCardNumber: 'JC-0001', faultCode: 'F001', qcRejectionCount: 0,
            qcApprovedAt: new Date(startedAt.getTime() + 60 * 60_000), technicianId: 'tech-slow', startedAt, // 60 actual vs 45 SRT = 75%
          },
          {
            jobCardId: 'jc-2', jobCardNumber: 'JC-0002', faultCode: 'F001', qcRejectionCount: 0,
            qcApprovedAt: new Date(startedAt.getTime() + 30 * 60_000), technicianId: 'tech-fast', startedAt, // 30 actual vs 45 SRT = 150%
          },
        ]),
      );
      faultSymptomRepo.find = jest.fn().mockResolvedValue([{ faultCode: 'F001', standardRepairMinutes: 45 }]);

      const report = await service.getTechnicianEfficiency();

      expect(report.summaryByTechnician[0].technicianId).toBe('tech-fast');
      expect(report.summaryByTechnician[0].avgEfficiencyPercent).toBe(150);
      expect(report.summaryByTechnician[1].technicianId).toBe('tech-slow');
      expect(report.summaryByTechnician[1].avgEfficiencyPercent).toBe(75);
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

    it('materialShortageHoursExcluded is 0 for a job with no MATERIAL_SHORTAGE pauses', async () => {
      const createdAt = new Date('2026-08-01T00:00:00.000Z');
      const qcApprovedAt = new Date(createdAt.getTime() + 50 * 3_600_000);
      jobCardRepo.createQueryBuilder = jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([jc(createdAt, qcApprovedAt)]),
      }));
      taskPauseRepo.find.mockResolvedValue([]);

      const report = await service.getSlaBreach();
      expect(report.items[0].materialShortageHoursExcluded).toBe(0);
      expect(report.items[0].hoursElapsed).toBe(50);
    });

    it('excludes MATERIAL_SHORTAGE paused hours from hoursElapsed while still breaching', async () => {
      const createdAt = new Date('2026-08-01T00:00:00.000Z');
      const qcApprovedAt = new Date(createdAt.getTime() + 65 * 3_600_000); // 65h elapsed
      jobCardRepo.createQueryBuilder = jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([jc(createdAt, qcApprovedAt)]),
      }));
      // 10 of those 65 hours were spent waiting on a spare part, resumed well before qcApprovedAt.
      taskPauseRepo.find.mockResolvedValue([
        {
          jobCardId: 'jc-1',
          pausedAt: new Date(createdAt.getTime() + 5 * 3_600_000),
          resumedAt: new Date(createdAt.getTime() + 15 * 3_600_000),
        },
      ]);

      const report = await service.getSlaBreach();
      expect(report.items[0].materialShortageHoursExcluded).toBe(10);
      expect(report.items[0].hoursElapsed).toBe(55); // 65 - 10, still over the 48h threshold
      expect(report.breachedCount).toBe(1);
    });

    it('pulls a job back under the threshold entirely once its MATERIAL_SHORTAGE time is excluded', async () => {
      const createdAt = new Date('2026-08-01T00:00:00.000Z');
      const qcApprovedAt = new Date(createdAt.getTime() + 50 * 3_600_000); // 50h elapsed, breaches default 48h on its own
      jobCardRepo.createQueryBuilder = jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([jc(createdAt, qcApprovedAt)]),
      }));
      taskPauseRepo.find.mockResolvedValue([
        {
          jobCardId: 'jc-1',
          pausedAt: new Date(createdAt.getTime() + 5 * 3_600_000),
          resumedAt: new Date(createdAt.getTime() + 15 * 3_600_000), // 10h excluded -> 40h net
        },
      ]);

      const report = await service.getSlaBreach();
      expect(report.breachedCount).toBe(0); // 40 <= 48, no longer a breach
      expect(report.items).toHaveLength(0);
    });

    it('sums multiple MATERIAL_SHORTAGE pauses on the same job', async () => {
      const createdAt = new Date('2026-08-01T00:00:00.000Z');
      const qcApprovedAt = new Date(createdAt.getTime() + 70 * 3_600_000); // 70h elapsed
      jobCardRepo.createQueryBuilder = jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([jc(createdAt, qcApprovedAt)]),
      }));
      taskPauseRepo.find.mockResolvedValue([
        { jobCardId: 'jc-1', pausedAt: new Date(createdAt.getTime() + 1 * 3_600_000), resumedAt: new Date(createdAt.getTime() + 6 * 3_600_000) }, // 5h
        { jobCardId: 'jc-1', pausedAt: new Date(createdAt.getTime() + 20 * 3_600_000), resumedAt: new Date(createdAt.getTime() + 27 * 3_600_000) }, // 7h
      ]);

      const report = await service.getSlaBreach();
      // 70h elapsed, 12h excluded -> 58h net, still over the default 48h threshold.
      expect(report.items[0].materialShortageHoursExcluded).toBe(12);
      expect(report.items[0].hoursElapsed).toBe(58);
    });

    it('caps an unresumed (still-open) MATERIAL_SHORTAGE pause at qcApprovedAt, not the current time', async () => {
      const createdAt = new Date('2026-08-01T00:00:00.000Z');
      const qcApprovedAt = new Date(createdAt.getTime() + 60 * 3_600_000);
      jobCardRepo.createQueryBuilder = jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([jc(createdAt, qcApprovedAt)]),
      }));
      // A technician forgot to resume this pause before completing the job - it's still
      // open at report time (long after qcApprovedAt), but must be capped there.
      taskPauseRepo.find.mockResolvedValue([
        { jobCardId: 'jc-1', pausedAt: new Date(createdAt.getTime() + 10 * 3_600_000), resumedAt: null },
      ]);

      // Use a low custom threshold (5h) so the still-breaching 10h net elapsed shows up in
      // items - the point under test is the exclusion cap, not the breach boundary itself.
      const report = await service.getSlaBreach(5);
      // Excluded = qcApprovedAt (60h mark) - pausedAt (10h mark) = 50h, never more than that.
      expect(report.items[0].materialShortageHoursExcluded).toBe(50);
      expect(report.items[0].hoursElapsed).toBe(10);
    });
  });

  describe('getTimeWaitingOnParts', () => {
    it('sums MATERIAL_SHORTAGE pause hours per job, using "now" for a still-open pause', async () => {
      const now = new Date();
      const pausedAt = new Date(now.getTime() - 5 * 3_600_000);
      taskPauseRepo.createQueryBuilder = jest.fn(() =>
        makeQb([{ jobCardId: 'jc-1', jobCardNumber: 'JC-0001', pausedAt, resumedAt: null }]),
      );

      const report = await service.getTimeWaitingOnParts();

      expect(report.rows).toHaveLength(1);
      expect(report.rows[0].jobCardId).toBe('jc-1');
      expect(report.rows[0].totalHoursWaiting).toBeCloseTo(5, 1);
      expect(report.rows[0].stillWaiting).toBe(true);
      expect(report.rows[0].pauseCount).toBe(1);
    });

    it('aggregates multiple pauses on the same job and marks stillWaiting false once every pause is resumed', async () => {
      const base = new Date('2026-08-01T00:00:00.000Z');
      taskPauseRepo.createQueryBuilder = jest.fn(() =>
        makeQb([
          { jobCardId: 'jc-1', jobCardNumber: 'JC-0001', pausedAt: base, resumedAt: new Date(base.getTime() + 3 * 3_600_000) },
          {
            jobCardId: 'jc-1',
            jobCardNumber: 'JC-0001',
            pausedAt: new Date(base.getTime() + 10 * 3_600_000),
            resumedAt: new Date(base.getTime() + 14 * 3_600_000),
          },
        ]),
      );

      const report = await service.getTimeWaitingOnParts();

      expect(report.rows[0].totalHoursWaiting).toBe(7);
      expect(report.rows[0].pauseCount).toBe(2);
      expect(report.rows[0].stillWaiting).toBe(false);
      expect(report.totalHoursWaiting).toBe(7);
    });

    it('only queries MATERIAL_SHORTAGE-reason pauses', async () => {
      const qb = makeQb([]);
      taskPauseRepo.createQueryBuilder = jest.fn(() => qb);

      await service.getTimeWaitingOnParts();

      expect(qb.where).toHaveBeenCalledWith('"p"."reason" = :reason', { reason: TaskPauseReason.MATERIAL_SHORTAGE });
    });

    it('applies periodStart/periodEnd filters against pausedAt', async () => {
      const qb = makeQb([]);
      taskPauseRepo.createQueryBuilder = jest.fn(() => qb);

      await service.getTimeWaitingOnParts('2026-08-01', '2026-08-31');

      expect(qb.andWhere).toHaveBeenCalledWith('"p"."pausedAt" >= :periodStart', { periodStart: '2026-08-01' });
      expect(qb.andWhere).toHaveBeenCalledWith('"p"."pausedAt" <= :periodEnd', { periodEnd: '2026-08-31 23:59:59.999' });
    });

    it('returns an empty report when nothing is waiting on parts', async () => {
      taskPauseRepo.createQueryBuilder = jest.fn(() => makeQb([]));

      const report = await service.getTimeWaitingOnParts();

      expect(report.rows).toHaveLength(0);
      expect(report.totalHoursWaiting).toBe(0);
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
