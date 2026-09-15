import { Injectable } from '@nestjs/common';
import { User } from '../auth/entities/user.entity';
import { RolePermissionsService } from '../auth/role-permissions.service';
import { ReportsService } from '../reports/reports.service';
import { OperationalReportsService } from '../reports/operational-reports.service';
import { TechnicianScheduleService } from '../technician-schedule/technician-schedule.service';

const DEFAULT_SLA_THRESHOLD_HOURS = 48;
const TOP_N = 5;

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

export interface DashboardOverview {
  widgets: {
    jobsByStatus?: JobsByStatusWidget;
    workshopQueue?: WorkshopQueueWidget;
    slaBreach?: SlaBreachWidget;
    spareConsumption?: SpareConsumptionWidget;
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
 */
@Injectable()
export class DashboardService {
  constructor(
    private rolePermissionsService: RolePermissionsService,
    private reportsService: ReportsService,
    private operationalReportsService: OperationalReportsService,
    private technicianScheduleService: TechnicianScheduleService,
  ) {}

  async getOverview(caller: User): Promise<DashboardOverview> {
    const [canJobStatus, canWorkshopQueue, canSlaBreach, canSpareConsumption] = await Promise.all([
      this.rolePermissionsService.userHasCapability(caller, 'DASHBOARD_WIDGET_JOB_STATUS'),
      this.rolePermissionsService.userHasCapability(caller, 'DASHBOARD_WIDGET_WORKSHOP_QUEUE'),
      this.rolePermissionsService.userHasCapability(caller, 'DASHBOARD_WIDGET_SLA_BREACH'),
      this.rolePermissionsService.userHasCapability(caller, 'DASHBOARD_WIDGET_SPARE_CONSUMPTION'),
    ]);

    const widgets: DashboardOverview['widgets'] = {};

    const [jobsByStatus, workshopQueue, slaBreach, spareConsumption] = await Promise.all([
      canJobStatus ? this.buildJobsByStatus(caller) : Promise.resolve(undefined),
      canWorkshopQueue ? this.buildWorkshopQueue(caller) : Promise.resolve(undefined),
      canSlaBreach ? this.buildSlaBreach() : Promise.resolve(undefined),
      canSpareConsumption ? this.buildSpareConsumption() : Promise.resolve(undefined),
    ]);

    if (jobsByStatus) widgets.jobsByStatus = jobsByStatus;
    if (workshopQueue) widgets.workshopQueue = workshopQueue;
    if (slaBreach) widgets.slaBreach = slaBreach;
    if (spareConsumption) widgets.spareConsumption = spareConsumption;

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
}
