import { Injectable } from '@nestjs/common';
import { User } from '../auth/entities/user.entity';
import { RolePermissionsService } from '../auth/role-permissions.service';
import { ReportsService } from '../reports/reports.service';
import { OperationalReportsService } from '../reports/operational-reports.service';
import { FinanceReportsService } from '../reports/finance-reports.service';
import { TechnicianScheduleService } from '../technician-schedule/technician-schedule.service';
import { AmcService } from '../amc/amc.service';
import { AmcContractStatus } from '../amc/entities/amc-contract.entity';
import { DeliveryService } from '../delivery/delivery.service';
import { InvoicingService } from '../invoicing/invoicing.service';

const DEFAULT_SLA_THRESHOLD_HOURS = 48;
const TOP_N = 5;
const AMC_EXPIRING_SOON_WITHIN_DAYS = 30;

export interface JobsByStatusWidget {
  columns: { key: string; label: string; count: number }[];
  totalActiveJobs: number;
}

export interface WorkshopQueueWidget {
  technicians: { id: string; name: string; activeCount: number; capacity: number; overCapacity: boolean }[];
  totalActive: number;
  unassignedCount: number;
}

export interface SlaBreachWidget {
  asOf: Date;
  thresholdHours: number;
  breachedCount: number;
  topItems: { jobCardId: string; jobCardNumber: string; hoursOverThreshold: number }[];
}

export interface SpareConsumptionWidget {
  topByQuantity: { sparePartId: string; code: string; name: string; totalQuantity: number }[];
  topByValue: { sparePartId: string; code: string; name: string; totalValue: number }[];
}

export interface AmcStatusWidget {
  activeCount: number;
  expiringSoonCount: number;
  expiringSoonWithinDays: number;
  upsellCandidatesCount: number;
}

export interface DeliveryInvoicingWidget {
  readyForDeliveryCount: number;
  b2bOutstandingAmount: number;
}

export interface FinanceSummaryWidget {
  totalServiceRevenue: number;
  totalAmcRevenue: number;
  activeAmcContracts: number;
}

export interface DashboardOverview {
  widgets: {
    jobsByStatus?: JobsByStatusWidget;
    workshopQueue?: WorkshopQueueWidget;
    slaBreach?: SlaBreachWidget;
    spareConsumption?: SpareConsumptionWidget;
    amcStatus?: AmcStatusWidget;
    deliveryInvoicing?: DeliveryInvoicingWidget;
    financeSummary?: FinanceSummaryWidget;
  };
}

/**
 * New post-login Dashboard (2026-09-15) - the "clear the whole page and build a real
 * dashboard" modification request. Deliberately separate from ReportsModule/ReportsService
 * ("leave Reports & Dashboards untouched", the user's own locked decision) even though every
 * widget here is a reshaped call into that module's or Technician Schedule's existing,
 * already-tested aggregation methods - no new report logic, no new tables.
 *
 * Per-widget capability gating happens HERE, inside the service, not on the controller -
 * DashboardController carries only JwtAuthGuard (every logged-in user must be able to land
 * on "/" without a 403 page), so each widget's own DASHBOARD_WIDGET_* key is checked via
 * RolePermissionsService.userHasCapability() and simply omitted from the response when the
 * caller doesn't hold it. This is real server-side enforcement (mirrors the "capability
 * catalog" module's own established pattern for admin tick/untick) - a widget the frontend
 * doesn't render because it's missing from the payload was NEVER fetched from the source
 * report data at all, not just hidden with CSS.
 *
 * Second round (2026-09-16) added 3 more widgets (AMC Status, Delivery & Invoicing, Finance
 * Summary) - the "full company-wide widget set" explicitly parked when the first four
 * shipped. Same rules apply: each is a reshaped call into AMC/Delivery/Invoicing/Finance
 * Reports' own already-tested aggregators, gated the same per-widget way.
 */
@Injectable()
export class DashboardService {
  constructor(
    private rolePermissionsService: RolePermissionsService,
    private reportsService: ReportsService,
    private operationalReportsService: OperationalReportsService,
    private technicianScheduleService: TechnicianScheduleService,
    private amcService: AmcService,
    private deliveryService: DeliveryService,
    private invoicingService: InvoicingService,
    private financeReportsService: FinanceReportsService,
  ) {}

  async getOverview(caller: User): Promise<DashboardOverview> {
    const [
      canJobStatus,
      canWorkshopQueue,
      canSlaBreach,
      canSpareConsumption,
      canAmcStatus,
      canDeliveryInvoicing,
      canFinanceSummary,
    ] = await Promise.all([
      this.rolePermissionsService.userHasCapability(caller, 'DASHBOARD_WIDGET_JOB_STATUS'),
      this.rolePermissionsService.userHasCapability(caller, 'DASHBOARD_WIDGET_WORKSHOP_QUEUE'),
      this.rolePermissionsService.userHasCapability(caller, 'DASHBOARD_WIDGET_SLA_BREACH'),
      this.rolePermissionsService.userHasCapability(caller, 'DASHBOARD_WIDGET_SPARE_CONSUMPTION'),
      this.rolePermissionsService.userHasCapability(caller, 'DASHBOARD_WIDGET_AMC_STATUS'),
      this.rolePermissionsService.userHasCapability(caller, 'DASHBOARD_WIDGET_DELIVERY_INVOICING'),
      this.rolePermissionsService.userHasCapability(caller, 'DASHBOARD_WIDGET_FINANCE_SUMMARY'),
    ]);

    const widgets: DashboardOverview['widgets'] = {};

    const [jobsByStatus, workshopQueue, slaBreach, spareConsumption, amcStatus, deliveryInvoicing, financeSummary] =
      await Promise.all([
        canJobStatus ? this.buildJobsByStatus(caller) : Promise.resolve(undefined),
        canWorkshopQueue ? this.buildWorkshopQueue(caller) : Promise.resolve(undefined),
        canSlaBreach ? this.buildSlaBreach() : Promise.resolve(undefined),
        canSpareConsumption ? this.buildSpareConsumption() : Promise.resolve(undefined),
        canAmcStatus ? this.buildAmcStatus() : Promise.resolve(undefined),
        canDeliveryInvoicing ? this.buildDeliveryInvoicing() : Promise.resolve(undefined),
        canFinanceSummary ? this.buildFinanceSummary() : Promise.resolve(undefined),
      ]);

    if (jobsByStatus) widgets.jobsByStatus = jobsByStatus;
    if (workshopQueue) widgets.workshopQueue = workshopQueue;
    if (slaBreach) widgets.slaBreach = slaBreach;
    if (spareConsumption) widgets.spareConsumption = spareConsumption;
    if (amcStatus) widgets.amcStatus = amcStatus;
    if (deliveryInvoicing) widgets.deliveryInvoicing = deliveryInvoicing;
    if (financeSummary) widgets.financeSummary = financeSummary;

    return { widgets };
  }

  private async buildJobsByStatus(caller: User): Promise<JobsByStatusWidget> {
    // Self-scoped for a plain technician caller, exactly like the Reports module's own
    // Kanban board - see ReportsService.getSelfScopedJobCardIds's doc comment.
    const summary = await this.reportsService.getKanbanSummary(caller);
    return {
      columns: summary.columns.map((c) => ({ key: c.key, label: c.label, count: c.count })),
      totalActiveJobs: summary.totalActiveJobs,
    };
  }

  private async buildWorkshopQueue(caller: User): Promise<WorkshopQueueWidget> {
    // Self-scoped for a plain workshop technician caller - see
    // TechnicianScheduleService.getWorkshopQueue's own doc comment.
    const queue = await this.technicianScheduleService.getWorkshopQueue(caller);
    return {
      technicians: queue.technicians.map((t) => ({
        id: t.id,
        name: t.name,
        activeCount: t.activeCount,
        capacity: t.capacity,
        overCapacity: t.overCapacity,
      })),
      totalActive: queue.technicians.reduce((sum, t) => sum + t.activeCount, 0),
      unassignedCount: queue.unassignedJobCards.length,
    };
  }

  private async buildSlaBreach(): Promise<SlaBreachWidget> {
    const report = await this.operationalReportsService.getSlaBreach(DEFAULT_SLA_THRESHOLD_HOURS);
    const topItems = [...report.items]
      .sort((a, b) => b.hoursOverThreshold - a.hoursOverThreshold)
      .slice(0, TOP_N)
      .map((i) => ({ jobCardId: i.jobCardId, jobCardNumber: i.jobCardNumber, hoursOverThreshold: i.hoursOverThreshold }));
    return {
      asOf: report.asOf,
      thresholdHours: report.thresholdHours,
      breachedCount: report.breachedCount,
      topItems,
    };
  }

  private async buildSpareConsumption(): Promise<SpareConsumptionWidget> {
    const report = await this.operationalReportsService.getSpareConsumption();
    return {
      topByQuantity: report.topByQuantity
        .slice(0, TOP_N)
        .map((e) => ({ sparePartId: e.sparePartId, code: e.code, name: e.name, totalQuantity: e.totalQuantity })),
      topByValue: report.topByValue
        .slice(0, TOP_N)
        .map((e) => ({ sparePartId: e.sparePartId, code: e.code, name: e.name, totalValue: e.totalValue })),
    };
  }

  // Second round (2026-09-16) - the parked "full company-wide widget set". Same reuse-only
  // rule as the first four: each of these calls exactly one already-tested aggregator and
  // reshapes its result, no new query logic here.
  private async buildAmcStatus(): Promise<AmcStatusWidget> {
    const [activeContracts, expiringSoon, upsellCandidates] = await Promise.all([
      this.amcService.findAll(AmcContractStatus.ACTIVE),
      this.amcService.getExpiringContracts(AMC_EXPIRING_SOON_WITHIN_DAYS),
      this.amcService.getRwrUpsellCandidates(),
    ]);
    return {
      activeCount: activeContracts.length,
      expiringSoonCount: expiringSoon.length,
      expiringSoonWithinDays: AMC_EXPIRING_SOON_WITHIN_DAYS,
      upsellCandidatesCount: upsellCandidates.length,
    };
  }

  private async buildDeliveryInvoicing(): Promise<DeliveryInvoicingWidget> {
    // DeliveryService.findReady() with no args = every warranty status, no date filter -
    // the same "everything currently ready" count the Ready for Delivery page itself shows
    // before any filter is applied.
    const [ready, aging] = await Promise.all([
      this.deliveryService.findReady(),
      this.invoicingService.getB2bAgingReport(),
    ]);
    return {
      readyForDeliveryCount: ready.length,
      b2bOutstandingAmount: aging.totalOutstanding,
    };
  }

  private async buildFinanceSummary(): Promise<FinanceSummaryWidget> {
    // No period args = all-time, matching this widget's "big picture" purpose rather than
    // the full Finance Reports page's own date-range picker.
    const summary = await this.financeReportsService.getSummary();
    return {
      totalServiceRevenue: summary.revenueSummary.totalServiceRevenue,
      totalAmcRevenue: summary.revenueSummary.totalAmcRevenue,
      activeAmcContracts: summary.amc.activeContractsCount,
    };
  }
}
