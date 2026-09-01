import { QualityReportsService } from './quality-reports.service';
import { JobCardStatus } from '../job-cards/entities/job-card.entity';
import { EstimateStatus } from '../estimates/entities/estimate.entity';

function makeQb(result: any = []) {
  const qb: any = {};
  const chain = ['select', 'addSelect', 'innerJoin', 'where', 'andWhere', 'groupBy', 'addGroupBy', 'orderBy'];
  for (const m of chain) qb[m] = jest.fn(() => qb);
  qb.getMany = jest.fn().mockResolvedValue(result);
  qb.getRawMany = jest.fn().mockResolvedValue(result);
  return qb;
}

describe('QualityReportsService', () => {
  let service: QualityReportsService;
  let jobCardRepo: any;
  let appointmentRepo: any;
  let estimateRepo: any;
  let serviceCentreRepo: any;

  beforeEach(() => {
    jobCardRepo = { createQueryBuilder: jest.fn(() => makeQb([])), find: jest.fn().mockResolvedValue([]) };
    appointmentRepo = { find: jest.fn().mockResolvedValue([]) };
    estimateRepo = { createQueryBuilder: jest.fn(() => makeQb([])) };
    serviceCentreRepo = { find: jest.fn().mockResolvedValue([]) };

    service = new QualityReportsService(jobCardRepo, appointmentRepo, estimateRepo, serviceCentreRepo);
  });

  describe('getProductFailureRatio (AC-22)', () => {
    it('maps raw grouped rows into periodLabel/model/brand/count, defaulting missing model/brand', async () => {
      jobCardRepo.createQueryBuilder = jest.fn(() =>
        makeQb([{ bucket: new Date('2026-08-01'), brand: 'Samsung', model: 'RT-500', count: '5' }, { bucket: new Date('2026-08-01'), brand: null, model: null, count: '1' }]),
      );
      const rows = await service.getProductFailureRatio({ groupBy: 'month' });
      expect(rows[0]).toMatchObject({ model: 'RT-500', brand: 'Samsung', count: 5 });
      expect(rows[1]).toMatchObject({ model: 'Unknown', brand: 'Unknown', count: 1 });
    });

    it('formats quarter and year period labels distinctly from month', async () => {
      jobCardRepo.createQueryBuilder = jest.fn(() => makeQb([{ bucket: new Date('2026-07-01'), brand: 'LG', model: 'X1', count: '2' }]));
      const quarterRows = await service.getProductFailureRatio({ groupBy: 'quarter' });
      expect(quarterRows[0].periodLabel).toBe('Q3 2026');

      const yearRows = await service.getProductFailureRatio({ groupBy: 'year' });
      expect(yearRows[0].periodLabel).toBe('2026');
    });
  });

  describe('getRepeatComplaints (AC-23: adjacent-gap-within-30-days algorithm)', () => {
    const job = (jobCardNumber: string, serialNumber: string, daysAgo: number) => ({
      id: jobCardNumber,
      jobCardNumber,
      serialNumber,
      createdAt: new Date(Date.now() - daysAgo * 86_400_000),
      status: JobCardStatus.DELIVERED,
    });

    it('flags a S/N whose two jobs are within 30 days of each other', async () => {
      jobCardRepo.find = jest.fn().mockResolvedValue([job('JC-1', 'SN-1', 40), job('JC-2', 'SN-1', 15)]);
      const results = await service.getRepeatComplaints();
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ serialNumber: 'SN-1', totalJobCount: 2, repeatWithin30Days: true });
      expect(results[0].jobCardNumbers).toEqual(expect.arrayContaining(['JC-1', 'JC-2']));
    });

    it('does not flag a S/N whose jobs are more than 30 days apart', async () => {
      jobCardRepo.find = jest.fn().mockResolvedValue([job('JC-1', 'SN-2', 90), job('JC-2', 'SN-2', 40)]);
      const results = await service.getRepeatComplaints();
      expect(results).toHaveLength(0);
    });

    it('does not flag a S/N with only one job', async () => {
      jobCardRepo.find = jest.fn().mockResolvedValue([job('JC-1', 'SN-3', 5)]);
      const results = await service.getRepeatComplaints();
      expect(results).toHaveLength(0);
    });

    it('flags via the minimum adjacent gap even with 3+ jobs spread unevenly', async () => {
      // SN-4: jobs at 100, 50, 10 days ago (sorted ascending by createdAt: 100 -> 50 -> 10).
      // Gaps: 50 days (100->50, no flag) and 40 days (50->10, no flag) - neither <=30,
      // so this S/N should NOT be flagged even though it has 3 jobs total.
      jobCardRepo.find = jest.fn().mockResolvedValue([job('JC-1', 'SN-4', 100), job('JC-2', 'SN-4', 50), job('JC-3', 'SN-4', 10)]);
      const results = await service.getRepeatComplaints();
      expect(results).toHaveLength(0);
    });

    it('excludes CANCELLED job cards from the S/N grouping', async () => {
      jobCardRepo.find = jest.fn().mockResolvedValue([]);
      await service.getRepeatComplaints();
      const whereArg = jobCardRepo.find.mock.calls[0][0].where;
      const statusList = whereArg.status._value ?? whereArg.status;
      expect(Array.isArray(statusList)).toBe(true);
      expect(statusList).not.toContain(JobCardStatus.CANCELLED);
    });
  });

  describe('getRwrAnalysis (AC-24)', () => {
    it('groups by model/reason/region, falling back to "Not specified" for blank reasons and city->country for region', async () => {
      estimateRepo.createQueryBuilder = jest.fn(() =>
        makeQb([
          { model: 'RT-500', reason: 'Price too high', serviceCentreId: 'sc-1' },
          { model: 'RT-500', reason: 'Price too high', serviceCentreId: 'sc-1' },
          { model: 'RT-500', reason: '   ', serviceCentreId: 'sc-2' },
        ]),
      );
      serviceCentreRepo.find = jest.fn().mockResolvedValue([
        { id: 'sc-1', city: 'Dubai', country: 'UAE' },
        { id: 'sc-2', city: null, country: 'KSA' },
      ]);

      const rows = await service.getRwrAnalysis();
      const priceRow = rows.find((r) => r.reason === 'Price too high')!;
      expect(priceRow.count).toBe(2);
      expect(priceRow.region).toBe('Dubai');

      const blankRow = rows.find((r) => r.reason === 'Not specified')!;
      expect(blankRow.count).toBe(1);
      expect(blankRow.region).toBe('KSA');
    });

    it('filters only REJECTED estimates', async () => {
      const qb = makeQb([]);
      estimateRepo.createQueryBuilder = jest.fn(() => qb);
      await service.getRwrAnalysis();
      expect(qb.where).toHaveBeenCalledWith('e.status = :status', { status: EstimateStatus.REJECTED });
    });
  });
});
