import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Invoice, InvoiceStatus } from '../invoicing/entities/invoice.entity';
import { Payment } from '../invoicing/entities/payment.entity';
import { DebitNote, DebitNoteStatus } from '../debit-notes/entities/debit-note.entity';
import { WarrantyClaim, WarrantyClaimStatus } from '../warranty-claims/entities/warranty-claim.entity';
import { AmcContract, AmcContractStatus } from '../amc/entities/amc-contract.entity';
import { AmcBillingInvoice, AmcBillingStatus } from '../amc/entities/amc-billing-invoice.entity';
import { JobCard } from '../job-cards/entities/job-card.entity';
import { Appointment, CustomerType } from '../appointments/entities/appointment.entity';
import { ServiceCentre } from '../master-data/entities/service-centre.entity';

/**
 * BRD 18.2 Finance Dashboard.
 *
 * *** the-fool pre-mortem findings baked into this design (see STATUS_TRACKER Phase 13
 * write-up for the full pre-mortem) - do not "simplify" any of these away: ***
 *
 * 1. NO blended "Total Company Revenue" figure exists anywhere in this service. OOW
 *    (Invoice), IW recharge (DebitNote), and AMC (AmcBillingInvoice) revenue are always
 *    reported as separate figures. A Job Card's effective warrantyStatus can be
 *    overridden AFTER a DebitNote has already been POSTED for it (TL-approved, audited -
 *    see JobCard.warrantyOverridden); nothing in this schema retroactively voids that
 *    DebitNote or prevents an Invoice from later being raised for the same repair, so a
 *    naive SUM(Invoice.amount) + SUM(DebitNote.totalAmount) + SUM(AmcBillingInvoice.amount)
 *    can double-count one underlying repair. WarrantyClaim.creditNoteAmount is vendor
 *    RECOVERY of a cost already counted once via the DebitNote - it is never treated as
 *    revenue here either.
 * 2. OOW cost is `null`, never `ServicePriceList.warrantyLaborCost`. That column is an
 *    internal transfer-pricing rate calibrated for warranty/interdepartment recovery, not
 *    a market estimate of true OOW repair cost - reusing it would produce a *wrong*
 *    number (e.g. an implausible margin %) that looks authoritative, which is strictly
 *    worse than an honest `null`. No OOW-specific cost field exists anywhere in this app.
 * 3. Null cascades. Any aggregate whose inputs include an unresolvable (`null`) figure is
 *    itself `null` - never `?? 0` anywhere in this file. Total COGS/Gross Profit/GP
 *    Margin % are `null` because OOW cost and AMC cost are both `null`.
 * 4. OOW "Unpaid Invoices" aging splits B2B and B2C into separate buckets (B2C has no
 *    credit terms - conflating it with B2B aging overstates AR risk). Interdepartment
 *    Recharge "Settlement Status" is labelled "Posted to GL" / "Pending", never "Settled" -
 *    a POSTED DebitNote means the recharge was recognised, not that the other department
 *    has actually settled it in cash.
 * 5. Period filters use the field that represents recognition/settlement, not just
 *    row-creation: DebitNote uses `postedAt` (DRAFT rows are excluded from period-scoped
 *    totals entirely - an unposted recharge isn't recognised yet); WarrantyClaim uses
 *    `submittedAt` for claim activity and `creditReceivedAt` for recoveries (two different
 *    questions, never conflated); Invoice/Payment/AmcBillingInvoice have only `createdAt`
 *    (Payment's timestamp column is literally named `recordedAt`, not `paidAt`).
 */

export interface RevenueSummary {
  totalServiceRevenue: number; // OOW Invoice revenue - the only externally-billed "service" revenue stream.
  totalLabourRevenue: number | null; // OOW Estimate line items are free-text, no labour/spares split exists.
  totalSparePartsRevenue: number | null;
  totalAmcRevenue: number;
}

export interface CostSummary {
  totalLabourCost: number | null; // null: OOW + AMC labour cost are both unknown, so a combined total is unknown too.
  totalSparePartsCost: number | null;
  totalAmcCost: number | null;
  totalCOGS: number | null;
}

export interface ProfitSummary {
  grossProfit: number | null;
  grossProfitMarginPct: number | null;
}

export interface OowSection {
  totalOowRevenue: number;
  totalLabourRevenueOow: null;
  totalLabourCostOow: null;
  labourProfitOow: null;
  totalSpareRevenueOow: null;
  totalSpareCostOow: null;
  spareProfitOow: null;
  totalOowProfit: null;
  oowMarginPct: null;
  note: string;
}

export interface WarrantySection {
  totalSpareCostIw: number;
  totalLabourCostIw: number;
  totalWarrantyCost: number;
  amountClaimedFromSuppliers: number;
  amountReceived: number;
  recoveryRatePct: number | null;
}

export interface AmcFinanceSection {
  totalAmcRevenue: number;
  totalAmcLabourCost: null;
  totalAmcSpareCost: null;
  amcGrossProfit: null;
  amcMarginPct: null;
  activeContractsCount: number;
  costTrackingNote: string;
}

export interface FinanceSummary {
  periodStart: string | null;
  periodEnd: string | null;
  periodBasis: Record<string, string>;
  revenueSummary: RevenueSummary;
  costSummary: CostSummary;
  profitSummary: ProfitSummary;
  oow: OowSection;
  warranty: WarrantySection;
  amc: AmcFinanceSection;
}

export interface GpByServiceCentreRow {
  serviceCentreId: string;
  serviceCentreName: string;
  oowRevenue: number;
  iwRechargeRevenue: number;
  iwLabourCost: number;
  amcRevenue: number;
  // "Overhead" (BRD 18.2) is omitted entirely, not null - no overhead-allocation concept
  // exists anywhere in this app's data model to even attempt.
  grossProfit: null;
  gpMarginPct: null;
}

export interface InterdepartmentRechargeRow {
  salesChannelName: string;
  jobCount: number;
  sparePartsCostInternal: number;
  labourCostInternal: number;
  totalDebitNoteAmount: number;
  pendingCount: number; // DRAFT
  postedToGlCount: number; // POSTED
}

export interface UnpaidInvoiceItem {
  jobCardId: string;
  jobCardNumber: string;
  customerName: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  amountDue: number;
  agingBucket: '0-2 days' | '3-7 days' | '8+ days';
}

export interface UnpaidInvoicesReport {
  asOf: Date;
  b2b: UnpaidInvoiceItem[];
  b2c: UnpaidInvoiceItem[];
  note: string;
}

export interface ProfitTrendPoint {
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  oowRevenue: number;
  iwRechargeRevenue: number;
  amcRevenue: number;
  iwCost: number;
  iwGrossProfit: number;
  totalCOGS: null;
  totalGrossProfit: null;
  gpMarginPct: null;
}

@Injectable()
export class FinanceReportsService {
  constructor(
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(Payment) private paymentRepo: Repository<Payment>,
    @InjectRepository(DebitNote) private debitNoteRepo: Repository<DebitNote>,
    @InjectRepository(WarrantyClaim) private warrantyClaimRepo: Repository<WarrantyClaim>,
    @InjectRepository(AmcContract) private amcContractRepo: Repository<AmcContract>,
    @InjectRepository(AmcBillingInvoice) private amcBillingRepo: Repository<AmcBillingInvoice>,
    @InjectRepository(JobCard) private jobCardRepo: Repository<JobCard>,
    @InjectRepository(Appointment) private appointmentRepo: Repository<Appointment>,
    @InjectRepository(ServiceCentre) private serviceCentreRepo: Repository<ServiceCentre>,
  ) {}

  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /** Applies an optional [periodStart, periodEnd] window to a QueryBuilder on a given column. */
  private applyPeriod(qb: any, alias: string, column: string, periodStart?: string, periodEnd?: string): any {
    if (periodStart) qb = qb.andWhere(`"${alias}"."${column}" >= :periodStart`, { periodStart });
    if (periodEnd) qb = qb.andWhere(`"${alias}"."${column}" <= :periodEnd`, { periodEnd: `${periodEnd} 23:59:59.999` });
    return qb;
  }

  async getSummary(periodStart?: string, periodEnd?: string): Promise<FinanceSummary> {
    // --- OOW (Invoice) - billed basis, excludes CANCELLED ---
    let invoiceQb = this.invoiceRepo
      .createQueryBuilder('inv')
      .where('inv.status != :cancelled', { cancelled: InvoiceStatus.CANCELLED });
    invoiceQb = this.applyPeriod(invoiceQb, 'inv', 'createdAt', periodStart, periodEnd);
    const oowInvoices = await invoiceQb.getMany();
    const totalOowRevenue = this.round(oowInvoices.reduce((sum, i) => sum + Number(i.amount), 0));

    // --- IW recharge (DebitNote) - POSTED only, filtered on postedAt (fix #5: DRAFT
    // rows are unrecognised and excluded from period-scoped totals entirely) ---
    let debitNoteQb = this.debitNoteRepo
      .createQueryBuilder('dn')
      .where('dn.status = :posted', { posted: DebitNoteStatus.POSTED });
    debitNoteQb = this.applyPeriod(debitNoteQb, 'dn', 'postedAt', periodStart, periodEnd);
    const postedDebitNotes = await debitNoteQb.getMany();
    const totalSpareCostIw = this.round(postedDebitNotes.reduce((sum, d) => sum + Number(d.sparePartsCost), 0));
    const totalLabourCostIw = this.round(postedDebitNotes.reduce((sum, d) => sum + Number(d.laborCost), 0));
    const totalWarrantyCost = this.round(totalSpareCostIw + totalLabourCostIw);
    const iwRechargeRevenue = this.round(postedDebitNotes.reduce((sum, d) => sum + Number(d.totalAmount), 0));

    // --- Warranty recovery (WarrantyClaim) - claims filtered on submittedAt, recoveries
    // on creditReceivedAt (fix #5: two different questions, never conflated). Formula
    // mirrors WarrantyClaimsService.recoveryRate() exactly for consistency. ---
    let claimedQb = this.warrantyClaimRepo
      .createQueryBuilder('wc')
      .where('wc.status IN (:...statuses)', { statuses: [WarrantyClaimStatus.SUBMITTED, WarrantyClaimStatus.CREDIT_RECEIVED] });
    claimedQb = this.applyPeriod(claimedQb, 'wc', 'submittedAt', periodStart, periodEnd);
    const claimedClaims = await claimedQb.getMany();
    const amountClaimedFromSuppliers = this.round(claimedClaims.reduce((sum, c) => sum + Number(c.totalClaimedAmount), 0));

    let receivedQb = this.warrantyClaimRepo
      .createQueryBuilder('wc')
      .where('wc.status = :status', { status: WarrantyClaimStatus.CREDIT_RECEIVED });
    receivedQb = this.applyPeriod(receivedQb, 'wc', 'creditReceivedAt', periodStart, periodEnd);
    const receivedClaims = await receivedQb.getMany();
    const amountReceived = this.round(receivedClaims.reduce((sum, c) => sum + Number(c.creditNoteAmount ?? 0), 0));

    const recoveryRatePct = amountClaimedFromSuppliers > 0 ? this.round((amountReceived / amountClaimedFromSuppliers) * 100) : null;

    // --- AMC (AmcBillingInvoice) - only createdAt exists on this entity, so that's the
    // period basis (fix #5). Active Contracts Count is a point-in-time snapshot, never
    // period-filtered - "active right now" doesn't have a start/end window to apply. ---
    let amcBillingQb = this.amcBillingRepo
      .createQueryBuilder('abi')
      .where('abi.status = :status', { status: AmcBillingStatus.PAID });
    amcBillingQb = this.applyPeriod(amcBillingQb, 'abi', 'createdAt', periodStart, periodEnd);
    const amcBillings = await amcBillingQb.getMany();
    const totalAmcRevenue = this.round(amcBillings.reduce((sum, a) => sum + Number(a.amount), 0));
    const activeContractsCount = await this.amcContractRepo.count({ where: { status: AmcContractStatus.ACTIVE } });

    return {
      periodStart: periodStart ?? null,
      periodEnd: periodEnd ?? null,
      periodBasis: {
        oowInvoice: 'Invoice.createdAt',
        iwDebitNote: 'DebitNote.postedAt (DRAFT rows excluded)',
        warrantyClaimed: 'WarrantyClaim.submittedAt',
        warrantyReceived: 'WarrantyClaim.creditReceivedAt',
        amc: 'AmcBillingInvoice.createdAt (no separate billing-date field exists)',
      },
      revenueSummary: {
        totalServiceRevenue: totalOowRevenue,
        totalLabourRevenue: null,
        totalSparePartsRevenue: null,
        totalAmcRevenue,
      },
      costSummary: {
        totalLabourCost: null,
        totalSparePartsCost: null,
        totalAmcCost: null,
        totalCOGS: null,
      },
      profitSummary: {
        grossProfit: null,
        grossProfitMarginPct: null,
      },
      oow: {
        totalOowRevenue,
        totalLabourRevenueOow: null,
        totalLabourCostOow: null,
        labourProfitOow: null,
        totalSpareRevenueOow: null,
        totalSpareCostOow: null,
        spareProfitOow: null,
        totalOowProfit: null,
        oowMarginPct: null,
        note: 'OOW cost is not tracked anywhere in this app (no OOW-specific labour or spares cost field exists), so no split, profit, or margin can be computed - only combined revenue is real.',
      },
      warranty: {
        totalSpareCostIw,
        totalLabourCostIw,
        totalWarrantyCost,
        amountClaimedFromSuppliers,
        amountReceived,
        recoveryRatePct,
      },
      amc: {
        totalAmcRevenue,
        totalAmcLabourCost: null,
        totalAmcSpareCost: null,
        amcGrossProfit: null,
        amcMarginPct: null,
        activeContractsCount,
        costTrackingNote: 'AMC PM visits (AmcVisitCompletion) never route through the Workshop/QC/InventoryReservation pipeline - there is no jobCardId, spare consumption link, or labour cost link anywhere for an AMC visit, so AMC cost is not merely hard to compute, it genuinely does not exist in this app.',
      },
    };
  }

  /**
   * Revenue is reported per stream (OOW / IW recharge / AMC), never summed, for the same
   * double-counting reason as getSummary() - see class doc comment finding 1.
   */
  async getGpByServiceCentre(periodStart?: string, periodEnd?: string): Promise<GpByServiceCentreRow[]> {
    const centres = await this.serviceCentreRepo.find();

    let invQb = this.invoiceRepo
      .createQueryBuilder('inv')
      .innerJoin(JobCard, 'jc', '"jc"."id" = "inv"."jobCardId"')
      .innerJoin(Appointment, 'appt', '"appt"."id" = "jc"."appointmentId"')
      .select('"appt"."serviceCentreId"', 'serviceCentreId')
      .addSelect('SUM("inv"."amount")', 'total')
      .where('inv.status != :cancelled', { cancelled: InvoiceStatus.CANCELLED });
    invQb = this.applyPeriod(invQb, 'inv', 'createdAt', periodStart, periodEnd);
    const invRows = await invQb.groupBy('"appt"."serviceCentreId"').getRawMany();
    const oowByCentre = new Map(invRows.map((r) => [r.serviceCentreId, Number(r.total)]));

    let dnQb = this.debitNoteRepo
      .createQueryBuilder('dn')
      .innerJoin(JobCard, 'jc', '"jc"."id" = "dn"."jobCardId"')
      .innerJoin(Appointment, 'appt', '"appt"."id" = "jc"."appointmentId"')
      .select('"appt"."serviceCentreId"', 'serviceCentreId')
      .addSelect('SUM("dn"."totalAmount")', 'totalAmount')
      .addSelect('SUM("dn"."laborCost")', 'labourCost')
      .where('dn.status = :posted', { posted: DebitNoteStatus.POSTED });
    dnQb = this.applyPeriod(dnQb, 'dn', 'postedAt', periodStart, periodEnd);
    const dnRows = await dnQb.groupBy('"appt"."serviceCentreId"').getRawMany();
    const iwRevenueByCentre = new Map(dnRows.map((r) => [r.serviceCentreId, Number(r.totalAmount)]));
    const iwLabourByCentre = new Map(dnRows.map((r) => [r.serviceCentreId, Number(r.labourCost)]));

    let amcQb = this.amcBillingRepo
      .createQueryBuilder('abi')
      .innerJoin(AmcContract, 'ac', '"ac"."id" = "abi"."amcContractId"')
      .select('"ac"."serviceCentreId"', 'serviceCentreId')
      .addSelect('SUM("abi"."amount")', 'total')
      .where('abi.status = :status', { status: AmcBillingStatus.PAID });
    amcQb = this.applyPeriod(amcQb, 'abi', 'createdAt', periodStart, periodEnd);
    const amcRows = await amcQb.groupBy('"ac"."serviceCentreId"').getRawMany();
    const amcByCentre = new Map(amcRows.map((r) => [r.serviceCentreId, Number(r.total)]));

    return centres.map((c) => ({
      serviceCentreId: c.id,
      serviceCentreName: c.name,
      oowRevenue: this.round(oowByCentre.get(c.id) ?? 0),
      iwRechargeRevenue: this.round(iwRevenueByCentre.get(c.id) ?? 0),
      iwLabourCost: this.round(iwLabourByCentre.get(c.id) ?? 0),
      amcRevenue: this.round(amcByCentre.get(c.id) ?? 0),
      grossProfit: null,
      gpMarginPct: null,
    }));
  }

  /** Grouped by Appointment.customerName - the B2B_SALES_CHANNEL customer IS the sales channel per DebitNote's own class doc. */
  async getInterdepartmentRecharge(periodStart?: string, periodEnd?: string): Promise<InterdepartmentRechargeRow[]> {
    let qb = this.debitNoteRepo
      .createQueryBuilder('dn')
      .innerJoin(JobCard, 'jc', '"jc"."id" = "dn"."jobCardId"')
      .innerJoin(Appointment, 'appt', '"appt"."id" = "jc"."appointmentId"')
      .select('"appt"."customerName"', 'salesChannelName')
      .addSelect('COUNT(*)', 'jobCount')
      .addSelect('SUM("dn"."sparePartsCost")', 'sparePartsCostInternal')
      .addSelect('SUM("dn"."laborCost")', 'labourCostInternal')
      .addSelect('SUM("dn"."totalAmount")', 'totalDebitNoteAmount')
      .addSelect(`SUM(CASE WHEN "dn"."status" = 'DRAFT' THEN 1 ELSE 0 END)`, 'pendingCount')
      .addSelect(`SUM(CASE WHEN "dn"."status" = 'POSTED' THEN 1 ELSE 0 END)`, 'postedToGlCount');
    // Interdepartment recharge activity is dated by row creation here (DRAFT rows are
    // meant to be visible in this operational summary, unlike the Finance summary's
    // recognised-revenue totals above) - createdAt, not postedAt.
    qb = this.applyPeriod(qb, 'dn', 'createdAt', periodStart, periodEnd);
    const rows = await qb.groupBy('"appt"."customerName"').getRawMany();

    return rows.map((r) => ({
      salesChannelName: r.salesChannelName,
      jobCount: Number(r.jobCount),
      sparePartsCostInternal: this.round(Number(r.sparePartsCostInternal)),
      labourCostInternal: this.round(Number(r.labourCostInternal)),
      totalDebitNoteAmount: this.round(Number(r.totalDebitNoteAmount)),
      pendingCount: Number(r.pendingCount),
      postedToGlCount: Number(r.postedToGlCount),
    }));
  }

  /**
   * BRD 18.2 Unpaid Invoices (OOW), bucketed 0-2/3-7/8+ days since invoice date
   * (Invoice.createdAt) - a different boundary set from the existing B2B-only aging
   * report (which uses `dueDate`, 30-day B2B Credit terms). B2B and B2C are reported
   * separately (fix #4): B2C has no credit terms, so an unpaid B2C invoice at day 9 is
   * most likely a reconciliation lag, not overdue debt the way a B2B invoice is.
   */
  async getUnpaidInvoices(): Promise<UnpaidInvoicesReport> {
    const openInvoices = await this.invoiceRepo.find({
      where: { status: In([InvoiceStatus.DRAFT, InvoiceStatus.PARTIALLY_PAID]) },
      order: { createdAt: 'ASC' },
    });
    if (openInvoices.length === 0) {
      return { asOf: new Date(), b2b: [], b2c: [], note: this.unpaidInvoicesNote() };
    }

    const jobCardIds = [...new Set(openInvoices.map((i) => i.jobCardId))];
    const jobCards = await this.jobCardRepo.find({ where: { id: In(jobCardIds) }, select: { id: true, jobCardNumber: true, appointmentId: true } });
    const jobCardById = new Map(jobCards.map((j) => [j.id, j]));

    const appointmentIds = [...new Set(jobCards.map((j) => j.appointmentId))];
    const appointments = appointmentIds.length
      ? await this.appointmentRepo.find({ where: { id: In(appointmentIds) }, select: { id: true, customerName: true, customerType: true } })
      : [];
    const appointmentById = new Map(appointments.map((a) => [a.id, a]));

    const invoiceIds = openInvoices.map((i) => i.id);
    const payments = await this.paymentRepo.find({ where: { invoiceId: In(invoiceIds) } });
    const paidByInvoiceId = new Map<string, number>();
    for (const p of payments) {
      paidByInvoiceId.set(p.invoiceId, (paidByInvoiceId.get(p.invoiceId) ?? 0) + Number(p.amount));
    }

    const now = Date.now();
    const b2b: UnpaidInvoiceItem[] = [];
    const b2c: UnpaidInvoiceItem[] = [];

    for (const inv of openInvoices) {
      const jobCard = jobCardById.get(inv.jobCardId);
      const appointment = jobCard ? appointmentById.get(jobCard.appointmentId) : undefined;
      const amountDue = this.round(Number(inv.amount) - (paidByInvoiceId.get(inv.id) ?? 0));
      if (amountDue <= 0) continue;

      const ageDays = (now - new Date(inv.createdAt).getTime()) / 86_400_000;
      const bucket: UnpaidInvoiceItem['agingBucket'] = ageDays <= 2 ? '0-2 days' : ageDays <= 7 ? '3-7 days' : '8+ days';

      const item: UnpaidInvoiceItem = {
        jobCardId: inv.jobCardId,
        jobCardNumber: jobCard?.jobCardNumber ?? '',
        customerName: appointment?.customerName ?? '',
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.createdAt,
        amountDue,
        agingBucket: bucket,
      };

      if (appointment?.customerType === CustomerType.B2C) {
        b2c.push(item);
      } else {
        b2b.push(item);
      }
    }

    return { asOf: new Date(), b2b, b2c, note: this.unpaidInvoicesNote() };
  }

  private unpaidInvoicesNote(): string {
    return 'B2B and B2C are reported separately: B2C has no credit terms (expected to settle at/near time of service), so bucketing it with B2B Credit-terms aging would overstate AR risk.';
  }

  /**
   * Profit Trend, bucketed by calendar week/month/quarter. Revenue is per-stream, never
   * summed (finding 1) - only the IW stream has real cost, so only iwGrossProfit is real;
   * totalCOGS/totalGrossProfit/gpMarginPct stay null (finding 3's cascade).
   */
  async getProfitTrend(groupBy: 'week' | 'month' | 'quarter', periodStart?: string, periodEnd?: string): Promise<ProfitTrendPoint[]> {
    const truncUnit = groupBy === 'week' ? 'week' : groupBy === 'quarter' ? 'quarter' : 'month';

    let invQb = this.invoiceRepo
      .createQueryBuilder('inv')
      .select(`DATE_TRUNC('${truncUnit}', "inv"."createdAt")`, 'bucket')
      .addSelect('SUM("inv"."amount")', 'total')
      .where('inv.status != :cancelled', { cancelled: InvoiceStatus.CANCELLED });
    invQb = this.applyPeriod(invQb, 'inv', 'createdAt', periodStart, periodEnd);
    const invRows = await invQb.groupBy('bucket').orderBy('bucket', 'ASC').getRawMany();

    let dnQb = this.debitNoteRepo
      .createQueryBuilder('dn')
      .select(`DATE_TRUNC('${truncUnit}', "dn"."postedAt")`, 'bucket')
      .addSelect('SUM("dn"."totalAmount")', 'revenue')
      .addSelect('SUM("dn"."sparePartsCost" + "dn"."laborCost")', 'cost')
      .where('dn.status = :posted', { posted: DebitNoteStatus.POSTED });
    dnQb = this.applyPeriod(dnQb, 'dn', 'postedAt', periodStart, periodEnd);
    const dnRows = await dnQb.groupBy('bucket').orderBy('bucket', 'ASC').getRawMany();

    let amcQb = this.amcBillingRepo
      .createQueryBuilder('abi')
      .select(`DATE_TRUNC('${truncUnit}', "abi"."createdAt")`, 'bucket')
      .addSelect('SUM("abi"."amount")', 'total')
      .where('abi.status = :status', { status: AmcBillingStatus.PAID });
    amcQb = this.applyPeriod(amcQb, 'abi', 'createdAt', periodStart, periodEnd);
    const amcRows = await amcQb.groupBy('bucket').orderBy('bucket', 'ASC').getRawMany();

    const bucketKey = (d: Date) => new Date(d).toISOString();
    const oowMap = new Map(invRows.map((r) => [bucketKey(r.bucket), Number(r.total)]));
    const iwRevenueMap = new Map(dnRows.map((r) => [bucketKey(r.bucket), Number(r.revenue)]));
    const iwCostMap = new Map(dnRows.map((r) => [bucketKey(r.bucket), Number(r.cost)]));
    const amcMap = new Map(amcRows.map((r) => [bucketKey(r.bucket), Number(r.total)]));

    const allBuckets = [...new Set([...oowMap.keys(), ...iwRevenueMap.keys(), ...amcMap.keys()])].sort();

    return allBuckets.map((key) => {
      const bucketStart = new Date(key);
      const bucketEnd = this.periodEndFor(bucketStart, groupBy);
      const iwRechargeRevenue = this.round(iwRevenueMap.get(key) ?? 0);
      const iwCost = this.round(iwCostMap.get(key) ?? 0);
      return {
        periodLabel: this.formatPeriodLabel(bucketStart, groupBy),
        periodStart: bucketStart,
        periodEnd: bucketEnd,
        oowRevenue: this.round(oowMap.get(key) ?? 0),
        iwRechargeRevenue,
        amcRevenue: this.round(amcMap.get(key) ?? 0),
        iwCost,
        iwGrossProfit: this.round(iwRechargeRevenue - iwCost),
        totalCOGS: null,
        totalGrossProfit: null,
        gpMarginPct: null,
      };
    });
  }

  private periodEndFor(start: Date, groupBy: 'week' | 'month' | 'quarter'): Date {
    const end = new Date(start);
    if (groupBy === 'week') end.setDate(end.getDate() + 7);
    else if (groupBy === 'month') end.setMonth(end.getMonth() + 1);
    else end.setMonth(end.getMonth() + 3);
    end.setMilliseconds(end.getMilliseconds() - 1);
    return end;
  }

  private formatPeriodLabel(start: Date, groupBy: 'week' | 'month' | 'quarter'): string {
    if (groupBy === 'month') {
      return start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }
    if (groupBy === 'quarter') {
      const q = Math.floor(start.getMonth() / 3) + 1;
      return `Q${q} ${start.getFullYear()}`;
    }
    return `Week of ${start.toISOString().slice(0, 10)}`;
  }
}
