import { FinanceReportsService } from './finance-reports.service';
import { InvoiceStatus } from '../invoicing/entities/invoice.entity';
import { DebitNoteStatus } from '../debit-notes/entities/debit-note.entity';
import { WarrantyClaimStatus } from '../warranty-claims/entities/warranty-claim.entity';
import { AmcContractStatus } from '../amc/entities/amc-contract.entity';
import { AmcBillingStatus } from '../amc/entities/amc-billing-invoice.entity';
import { CustomerType } from '../appointments/entities/appointment.entity';

/** Chainable QueryBuilder mock - every builder method returns `this`; the terminal method resolves to `result`. */
function makeQb(result: any = []) {
  const qb: any = {};
  const chain = ['select', 'addSelect', 'innerJoin', 'where', 'andWhere', 'groupBy', 'addGroupBy', 'orderBy'];
  for (const m of chain) qb[m] = jest.fn(() => qb);
  qb.getMany = jest.fn().mockResolvedValue(result);
  qb.getRawMany = jest.fn().mockResolvedValue(result);
  qb.getOne = jest.fn().mockResolvedValue(result?.[0] ?? null);
  return qb;
}

describe('FinanceReportsService', () => {
  let service: FinanceReportsService;
  let invoiceRepo: any;
  let paymentRepo: any;
  let debitNoteRepo: any;
  let warrantyClaimRepo: any;
  let amcContractRepo: any;
  let amcBillingRepo: any;
  let jobCardRepo: any;
  let appointmentRepo: any;
  let serviceCentreRepo: any;

  beforeEach(() => {
    invoiceRepo = { createQueryBuilder: jest.fn(() => makeQb([])), find: jest.fn().mockResolvedValue([]) };
    paymentRepo = { find: jest.fn().mockResolvedValue([]) };
    debitNoteRepo = { createQueryBuilder: jest.fn(() => makeQb([])) };
    warrantyClaimRepo = { createQueryBuilder: jest.fn(() => makeQb([])) };
    amcContractRepo = { count: jest.fn().mockResolvedValue(0) };
    amcBillingRepo = { createQueryBuilder: jest.fn(() => makeQb([])) };
    jobCardRepo = { find: jest.fn().mockResolvedValue([]) };
    appointmentRepo = { find: jest.fn().mockResolvedValue([]) };
    serviceCentreRepo = { find: jest.fn().mockResolvedValue([]) };

    service = new FinanceReportsService(
      invoiceRepo,
      paymentRepo,
      debitNoteRepo,
      warrantyClaimRepo,
      amcContractRepo,
      amcBillingRepo,
      jobCardRepo,
      appointmentRepo,
      serviceCentreRepo,
    );
  });

  describe('getSummary (the-fool findings 1-3: no blended total, no warrantyLaborCost reuse, null cascade)', () => {
    it('never exposes a blended "total company revenue" field - OOW/AMC stay in their own sections', async () => {
      invoiceRepo.createQueryBuilder = jest.fn(() => makeQb([{ amount: 100 }, { amount: 50 }]));
      const summary = await service.getSummary();
      expect(summary.revenueSummary.totalServiceRevenue).toBe(150);
      expect((summary as any).totalCompanyRevenue).toBeUndefined();
      expect(summary.oow.totalOowRevenue).toBe(150);
    });

    it('OOW cost/profit/margin are always null - never warrantyLaborCost-derived', async () => {
      const summary = await service.getSummary();
      expect(summary.oow.totalLabourCostOow).toBeNull();
      expect(summary.oow.totalSpareCostOow).toBeNull();
      expect(summary.oow.totalOowProfit).toBeNull();
      expect(summary.oow.oowMarginPct).toBeNull();
      expect(summary.revenueSummary.totalLabourRevenue).toBeNull();
      expect(summary.revenueSummary.totalSparePartsRevenue).toBeNull();
    });

    it('cascades null through Total COGS / Gross Profit / GP Margin % since OOW and AMC cost are unknown', async () => {
      const summary = await service.getSummary();
      expect(summary.costSummary.totalCOGS).toBeNull();
      expect(summary.profitSummary.grossProfit).toBeNull();
      expect(summary.profitSummary.grossProfitMarginPct).toBeNull();
      expect(summary.costSummary.totalLabourCost).toBeNull();
      expect(summary.costSummary.totalSparePartsCost).toBeNull();
      expect(summary.costSummary.totalAmcCost).toBeNull();
    });

    it('computes real IW (DebitNote) cost/revenue from POSTED rows only', async () => {
      debitNoteRepo.createQueryBuilder = jest.fn(() =>
        makeQb([
          { sparePartsCost: 100, laborCost: 50, totalAmount: 150 },
          { sparePartsCost: 20, laborCost: 10, totalAmount: 30 },
        ]),
      );
      const summary = await service.getSummary();
      expect(summary.warranty.totalSpareCostIw).toBe(120);
      expect(summary.warranty.totalLabourCostIw).toBe(60);
      expect(summary.warranty.totalWarrantyCost).toBe(180);
    });

    it('recoveryRatePct is null when nothing has been claimed yet (no fabricated 0 or divide-by-zero)', async () => {
      const summary = await service.getSummary();
      expect(summary.warranty.amountClaimedFromSuppliers).toBe(0);
      expect(summary.warranty.recoveryRatePct).toBeNull();
    });

    it('computes recoveryRatePct = received/claimed*100, matching WarrantyClaimsService.recoveryRate\'s own formula', async () => {
      let call = 0;
      warrantyClaimRepo.createQueryBuilder = jest.fn(() => {
        call += 1;
        // First call = claimed (SUBMITTED+CREDIT_RECEIVED totalClaimedAmount), second = received (CREDIT_RECEIVED creditNoteAmount)
        if (call === 1) return makeQb([{ totalClaimedAmount: 200 }, { totalClaimedAmount: 100 }]);
        return makeQb([{ creditNoteAmount: 150 }]);
      });
      const summary = await service.getSummary();
      expect(summary.warranty.amountClaimedFromSuppliers).toBe(300);
      expect(summary.warranty.amountReceived).toBe(150);
      expect(summary.warranty.recoveryRatePct).toBe(50);
    });

    it('AMC section: revenue is real, cost/profit/margin are null with a costTrackingNote, activeContractsCount is a point-in-time count', async () => {
      amcBillingRepo.createQueryBuilder = jest.fn(() => makeQb([{ amount: 500 }]));
      amcContractRepo.count = jest.fn().mockResolvedValue(7);
      const summary = await service.getSummary();
      expect(summary.amc.totalAmcRevenue).toBe(500);
      expect(summary.amc.totalAmcLabourCost).toBeNull();
      expect(summary.amc.totalAmcSpareCost).toBeNull();
      expect(summary.amc.amcGrossProfit).toBeNull();
      expect(summary.amc.amcMarginPct).toBeNull();
      expect(summary.amc.activeContractsCount).toBe(7);
      expect(summary.amc.costTrackingNote).toMatch(/never routes? through|Workshop\/QC/i);
    });

    it('echoes the period filters and documents the date field used per entity (periodBasis)', async () => {
      const summary = await service.getSummary('2026-08-01', '2026-08-31');
      expect(summary.periodStart).toBe('2026-08-01');
      expect(summary.periodEnd).toBe('2026-08-31');
      expect(summary.periodBasis.iwDebitNote).toMatch(/postedAt/);
      expect(summary.periodBasis.warrantyClaimed).toMatch(/submittedAt/);
      expect(summary.periodBasis.warrantyReceived).toMatch(/creditReceivedAt/);
    });
  });

  describe('getUnpaidInvoices (the-fool finding 4: B2B/B2C split, no shared aging buckets)', () => {
    const baseInvoice = (overrides: any = {}) => ({
      id: 'inv-1',
      jobCardId: 'jc-1',
      invoiceNumber: 'INV-0001',
      amount: 100,
      status: InvoiceStatus.DRAFT,
      createdAt: new Date(),
      ...overrides,
    });

    it('splits open invoices into b2b and b2c arrays, never merged', async () => {
      invoiceRepo.find = jest.fn().mockResolvedValue([
        baseInvoice({ id: 'inv-b2b', jobCardId: 'jc-b2b' }),
        baseInvoice({ id: 'inv-b2c', jobCardId: 'jc-b2c' }),
      ]);
      jobCardRepo.find = jest.fn().mockResolvedValue([
        { id: 'jc-b2b', jobCardNumber: 'JC-B2B', appointmentId: 'appt-b2b' },
        { id: 'jc-b2c', jobCardNumber: 'JC-B2C', appointmentId: 'appt-b2c' },
      ]);
      appointmentRepo.find = jest.fn().mockResolvedValue([
        { id: 'appt-b2b', customerName: 'Acme Trading', customerType: CustomerType.B2B },
        { id: 'appt-b2c', customerName: 'Jane Doe', customerType: CustomerType.B2C },
      ]);
      paymentRepo.find = jest.fn().mockResolvedValue([]);

      const report = await service.getUnpaidInvoices();
      expect(report.b2b).toHaveLength(1);
      expect(report.b2c).toHaveLength(1);
      expect(report.b2b[0].invoiceId).toBe('inv-b2b');
      expect(report.b2c[0].invoiceId).toBe('inv-b2c');
    });

    it.each([
      [0, '0-2 days'],
      [2, '0-2 days'],
      [2.5, '3-7 days'],
      [7, '3-7 days'],
      [7.5, '8+ days'],
      [30, '8+ days'],
    ])('buckets an invoice %s days old as %s', async (daysOld, expectedBucket) => {
      const createdAt = new Date(Date.now() - daysOld * 86_400_000);
      invoiceRepo.find = jest.fn().mockResolvedValue([baseInvoice({ createdAt })]);
      jobCardRepo.find = jest.fn().mockResolvedValue([{ id: 'jc-1', jobCardNumber: 'JC-0001', appointmentId: 'appt-1' }]);
      appointmentRepo.find = jest.fn().mockResolvedValue([{ id: 'appt-1', customerName: 'Acme Trading', customerType: CustomerType.B2B }]);
      paymentRepo.find = jest.fn().mockResolvedValue([]);

      const report = await service.getUnpaidInvoices();
      expect(report.b2b[0].agingBucket).toBe(expectedBucket);
    });

    it('computes amountDue net of recorded payments and excludes fully-paid invoices', async () => {
      invoiceRepo.find = jest.fn().mockResolvedValue([baseInvoice({ id: 'inv-1', amount: 100 }), baseInvoice({ id: 'inv-2', jobCardId: 'jc-1', amount: 50 })]);
      jobCardRepo.find = jest.fn().mockResolvedValue([{ id: 'jc-1', jobCardNumber: 'JC-0001', appointmentId: 'appt-1' }]);
      appointmentRepo.find = jest.fn().mockResolvedValue([{ id: 'appt-1', customerName: 'Jane Doe', customerType: CustomerType.B2C }]);
      paymentRepo.find = jest.fn().mockResolvedValue([
        { invoiceId: 'inv-1', amount: 40 },
        { invoiceId: 'inv-2', amount: 50 },
      ]);

      const report = await service.getUnpaidInvoices();
      const ids = report.b2c.map((i) => i.invoiceId);
      expect(ids).toEqual(['inv-1']);
      expect(report.b2c[0].amountDue).toBe(60);
    });
  });

  describe('getInterdepartmentRecharge (the-fool finding 4: Pending/Posted to GL, never "Settled")', () => {
    it('maps DRAFT/POSTED counts without claiming settlement', async () => {
      debitNoteRepo.createQueryBuilder = jest.fn(() =>
        makeQb([
          {
            salesChannelName: 'Acme Trading',
            jobCount: '3',
            sparePartsCostInternal: '120.5',
            labourCostInternal: '60',
            totalDebitNoteAmount: '180.5',
            pendingCount: '1',
            postedToGlCount: '2',
          },
        ]),
      );
      const rows = await service.getInterdepartmentRecharge();
      expect(rows[0]).toMatchObject({
        salesChannelName: 'Acme Trading',
        jobCount: 3,
        sparePartsCostInternal: 120.5,
        labourCostInternal: 60,
        totalDebitNoteAmount: 180.5,
        pendingCount: 1,
        postedToGlCount: 2,
      });
    });
  });

  describe('getGpByServiceCentre (the-fool finding 5: Overhead omitted, GP/margin null)', () => {
    it('omits/nulls the fields with no computable basis and defaults centres with no activity to 0, not undefined', async () => {
      serviceCentreRepo.find = jest.fn().mockResolvedValue([{ id: 'sc-1', name: 'Dubai Main' }, { id: 'sc-2', name: 'Riyadh' }]);
      invoiceRepo.createQueryBuilder = jest.fn(() => makeQb([{ serviceCentreId: 'sc-1', total: '1000' }]));
      debitNoteRepo.createQueryBuilder = jest.fn(() => makeQb([]));
      amcBillingRepo.createQueryBuilder = jest.fn(() => makeQb([]));

      const rows = await service.getGpByServiceCentre();
      expect(rows).toHaveLength(2);
      const dubai = rows.find((r) => r.serviceCentreId === 'sc-1')!;
      const riyadh = rows.find((r) => r.serviceCentreId === 'sc-2')!;
      expect(dubai.oowRevenue).toBe(1000);
      expect(riyadh.oowRevenue).toBe(0);
      expect(dubai.grossProfit).toBeNull();
      expect(dubai.gpMarginPct).toBeNull();
      expect((dubai as any).overhead).toBeUndefined();
    });
  });

  describe('getProfitTrend (the-fool findings 1 & 3: per-stream, IW profit real, total null)', () => {
    it('merges buckets across streams and computes iwGrossProfit for real while totals stay null', async () => {
      const bucket = new Date('2026-08-01T00:00:00.000Z');
      invoiceRepo.createQueryBuilder = jest.fn(() => makeQb([{ bucket, total: '500' }]));
      debitNoteRepo.createQueryBuilder = jest.fn(() => makeQb([{ bucket, revenue: '300', cost: '200' }]));
      amcBillingRepo.createQueryBuilder = jest.fn(() => makeQb([{ bucket, total: '100' }]));

      const points = await service.getProfitTrend('month');
      expect(points).toHaveLength(1);
      expect(points[0].oowRevenue).toBe(500);
      expect(points[0].iwRechargeRevenue).toBe(300);
      expect(points[0].iwCost).toBe(200);
      expect(points[0].iwGrossProfit).toBe(100);
      expect(points[0].amcRevenue).toBe(100);
      expect(points[0].totalCOGS).toBeNull();
      expect(points[0].totalGrossProfit).toBeNull();
      expect(points[0].gpMarginPct).toBeNull();
    });
  });
});
