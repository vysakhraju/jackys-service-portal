import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { JobCard, JobCardStatus, JobCardSection } from '../job-cards/entities/job-card.entity';
import { Delivery } from '../delivery/entities/delivery.entity';
import { Estimate, EstimateStatus } from '../estimates/entities/estimate.entity';
import { TechnicianVisit } from '../technician/entities/technician-visit.entity';
import { FaultSymptom, ApplianceCategory } from '../master-data/entities/fault-symptom.entity';
import { User } from '../auth/entities/user.entity';

/**
 * BRD 18.1 "Job Status Board" Kanban columns, in board order. JobCardStatus has 10 values
 * (11 with CANCELLED) but the BRD names only 8 columns - CANCELLED is dropped from the
 * live board entirely (a dead job clutters real-time ops, it's still visible via normal
 * Job Card search/filters), and READY_FOR_QC is folded into WIP (see columnForJobCard()
 * below) rather than getting its own column, since the BRD's list has no "Awaiting QC"
 * bucket distinct from "WIP" - a documented simplification, not an oversight.
 */
export enum KanbanColumn {
  SCHEDULED = 'SCHEDULED',
  ON_SITE = 'ON_SITE',
  WIP = 'WIP',
  SPARE_PENDING = 'SPARE_PENDING',
  APPROVAL_PENDING = 'APPROVAL_PENDING',
  QC_COMPLETED = 'QC_COMPLETED',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
}

export const KANBAN_COLUMN_ORDER: KanbanColumn[] = [
  KanbanColumn.SCHEDULED,
  KanbanColumn.ON_SITE,
  KanbanColumn.WIP,
  KanbanColumn.SPARE_PENDING,
  KanbanColumn.APPROVAL_PENDING,
  KanbanColumn.QC_COMPLETED,
  KanbanColumn.OUT_FOR_DELIVERY,
  KanbanColumn.DELIVERED,
];

const KANBAN_COLUMN_LABELS: Record<KanbanColumn, string> = {
  [KanbanColumn.SCHEDULED]: 'Scheduled',
  [KanbanColumn.ON_SITE]: 'On-Site',
  [KanbanColumn.WIP]: 'WIP',
  [KanbanColumn.SPARE_PENDING]: 'Spare Pending',
  [KanbanColumn.APPROVAL_PENDING]: 'Approval Pending',
  [KanbanColumn.QC_COMPLETED]: 'QC Completed',
  [KanbanColumn.OUT_FOR_DELIVERY]: 'Out for Delivery',
  [KanbanColumn.DELIVERED]: 'Delivered',
};

export interface KanbanCard {
  jobCardId: string;
  jobCardNumber: string;
  status: JobCardStatus;
  section: JobCardSection | null;
  serialNumber: string;
  brand: string | null;
  warrantyStatus: string;
  deliveryNumber: string | null;
  updatedAt: Date;
}

export interface KanbanBoard {
  asOf: Date;
  columns: { key: KanbanColumn; label: string; count: number; jobCards: KanbanCard[] }[];
  totalActiveJobs: number;
}

export interface KanbanSummary {
  asOf: Date;
  columns: { key: KanbanColumn; label: string; count: number }[];
  totalActiveJobs: number;
}

const AGING_THRESHOLD_HOURS = 4; // BRD 18.1 Pending Approval Aging: red alert past 4 hours.

export interface ApprovalAgingItem {
  estimateId: string;
  jobCardId: string;
  jobCardNumber: string;
  sentAt: Date;
  ageHours: number;
  breached: boolean;
}

export interface ApprovalAgingReport {
  asOf: Date;
  thresholdHours: number;
  breachedCount: number;
  items: ApprovalAgingItem[];
}

export interface ServiceEfficiencyRow {
  key: string;
  label: string;
  jobCount: number;
  avgHours: number;
}

export interface ServiceEfficiencyReport {
  asOf: Date;
  overallAvgHours: number | null;
  sampleSize: number;
  byTechnician: ServiceEfficiencyRow[];
  byCategory: ServiceEfficiencyRow[];
}

export interface FirstTimeFixRateReport {
  asOf: Date;
  totalCompletedJobs: number;
  onSiteOnlyCompletedJobs: number;
  rate: number | null;
}

export interface DashboardOverview {
  asOf: Date;
  kanbanSummary: KanbanSummary;
  approvalAging: { breachedCount: number; oldestAgeHours: number | null };
  firstTimeFixRate: FirstTimeFixRateReport;
  serviceEfficiency: { overallAvgHours: number | null; sampleSize: number };
}

// Statuses considered "completed" for First-Time Fix Rate / Service Efficiency purposes -
// a repair that reached QC sign-off, whether or not it's been handed back yet.
const COMPLETED_STATUSES = [JobCardStatus.QC_PASSED, JobCardStatus.DELIVERED];

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(JobCard) private jobCardRepo: Repository<JobCard>,
    @InjectRepository(Delivery) private deliveryRepo: Repository<Delivery>,
    @InjectRepository(Estimate) private estimateRepo: Repository<Estimate>,
    @InjectRepository(TechnicianVisit) private visitRepo: Repository<TechnicianVisit>,
    @InjectRepository(FaultSymptom) private faultSymptomRepo: Repository<FaultSymptom>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  /**
   * Maps one Job Card onto a Kanban column. Returns null for CANCELLED (dropped from the
   * live board - see KanbanColumn doc comment above).
   */
  columnForJobCard(job: Pick<JobCard, 'status' | 'section' | 'deliveryId'>): KanbanColumn | null {
    switch (job.status) {
      case JobCardStatus.CANCELLED:
        return null;
      case JobCardStatus.OPEN:
      case JobCardStatus.SN_VALIDATED:
        return KanbanColumn.SCHEDULED;
      case JobCardStatus.RWR:
        return KanbanColumn.APPROVAL_PENDING;
      case JobCardStatus.SECTION_ASSIGNED:
        return job.section === JobCardSection.ON_SITE_REPAIR ? KanbanColumn.ON_SITE : KanbanColumn.WIP;
      case JobCardStatus.WORKSHOP_ASSIGNED:
      case JobCardStatus.IN_PROGRESS:
      case JobCardStatus.READY_FOR_QC:
        return KanbanColumn.WIP;
      case JobCardStatus.SPARE_PENDING:
        return KanbanColumn.SPARE_PENDING;
      case JobCardStatus.QC_PASSED:
        return job.deliveryId ? KanbanColumn.OUT_FOR_DELIVERY : KanbanColumn.QC_COMPLETED;
      case JobCardStatus.DELIVERED:
        return KanbanColumn.DELIVERED;
      default:
        return null;
    }
  }

  private async loadActiveJobCards(): Promise<JobCard[]> {
    return this.jobCardRepo.find({
      where: { status: In(Object.values(JobCardStatus).filter((s) => s !== JobCardStatus.CANCELLED)) },
      order: { updatedAt: 'DESC' },
    });
  }

  async getKanbanBoard(): Promise<KanbanBoard> {
    const jobs = await this.loadActiveJobCards();

    const deliveryIds = [...new Set(jobs.map((j) => j.deliveryId).filter((id): id is string => !!id))];
    const deliveries = deliveryIds.length
      ? await this.deliveryRepo.find({ where: { id: In(deliveryIds) }, select: { id: true, deliveryNumber: true } })
      : [];
    const deliveryNumberById = new Map(deliveries.map((d) => [d.id, d.deliveryNumber]));

    const buckets = new Map<KanbanColumn, KanbanCard[]>(KANBAN_COLUMN_ORDER.map((c) => [c, []]));

    for (const job of jobs) {
      const column = this.columnForJobCard(job);
      if (!column) continue;
      buckets.get(column)!.push({
        jobCardId: job.id,
        jobCardNumber: job.jobCardNumber,
        status: job.status,
        section: job.section,
        serialNumber: job.serialNumber,
        brand: job.brand,
        warrantyStatus: job.warrantyStatus,
        deliveryNumber: job.deliveryId ? deliveryNumberById.get(job.deliveryId) ?? null : null,
        updatedAt: job.updatedAt,
      });
    }

    const columns = KANBAN_COLUMN_ORDER.map((key) => ({
      key,
      label: KANBAN_COLUMN_LABELS[key],
      count: buckets.get(key)!.length,
      jobCards: buckets.get(key)!,
    }));

    return {
      asOf: new Date(),
      columns,
      totalActiveJobs: columns.reduce((sum, c) => sum + c.count, 0),
    };
  }

  /** Lightweight counts-only variant - used for the WebSocket poll's cheap diff check. */
  async getKanbanSummary(): Promise<KanbanSummary> {
    const jobs = await this.jobCardRepo.find({
      select: { id: true, status: true, section: true, deliveryId: true },
      where: { status: In(Object.values(JobCardStatus).filter((s) => s !== JobCardStatus.CANCELLED)) },
    });

    const counts = new Map<KanbanColumn, number>(KANBAN_COLUMN_ORDER.map((c) => [c, 0]));
    for (const job of jobs) {
      const column = this.columnForJobCard(job);
      if (column) counts.set(column, (counts.get(column) ?? 0) + 1);
    }

    const columns = KANBAN_COLUMN_ORDER.map((key) => ({
      key,
      label: KANBAN_COLUMN_LABELS[key],
      count: counts.get(key)!,
    }));

    return { asOf: new Date(), columns, totalActiveJobs: columns.reduce((sum, c) => sum + c.count, 0) };
  }

  /**
   * BRD 18.1 Pending Approval Aging: jobs whose OOW Estimate has been sent to the
   * customer (FR-06 shareable link, or staff-recorded contact) but has no response yet.
   * "Approval" here is the customer's approve/reject of the Estimate, not any internal
   * sign-off - matches the RWR status this same condition eventually produces if rejected.
   */
  async getApprovalAging(): Promise<ApprovalAgingReport> {
    const pending = await this.estimateRepo.find({
      where: { status: EstimateStatus.SENT, respondedAt: IsNull() },
      order: { sentAt: 'ASC' },
    });
    const awaitingResponse = pending.filter((e) => e.sentAt);

    const jobCardIds = [...new Set(awaitingResponse.map((e) => e.jobCardId))];
    const jobCards = jobCardIds.length
      ? await this.jobCardRepo.find({ where: { id: In(jobCardIds) }, select: { id: true, jobCardNumber: true } })
      : [];
    const jobCardNumberById = new Map(jobCards.map((jc) => [jc.id, jc.jobCardNumber]));

    const now = Date.now();
    const items: ApprovalAgingItem[] = awaitingResponse.map((e) => {
      const ageHours = (now - new Date(e.sentAt as unknown as string).getTime()) / 3_600_000;
      return {
        estimateId: e.id,
        jobCardId: e.jobCardId,
        jobCardNumber: jobCardNumberById.get(e.jobCardId) ?? '',
        sentAt: e.sentAt as unknown as Date,
        ageHours: Math.round(ageHours * 100) / 100,
        breached: ageHours > AGING_THRESHOLD_HOURS,
      };
    });

    return {
      asOf: new Date(),
      thresholdHours: AGING_THRESHOLD_HOURS,
      breachedCount: items.filter((i) => i.breached).length,
      items,
    };
  }

  /**
   * BRD 18.1 Service Efficiency: avg time from "Login" (FR-02 - TechnicianVisit.startedAt,
   * the GPS+timestamp captured when the technician starts the visit) to "QC Completed"
   * (JobCard.qcApprovedAt), grouped by technician and by appliance category (via
   * JobCard.faultCode -> FaultSymptom.category). Only jobs that have actually reached QC
   * approval are included - an in-flight job has no end timestamp to measure yet.
   */
  async getServiceEfficiency(): Promise<ServiceEfficiencyReport> {
    const rows = await this.jobCardRepo
      .createQueryBuilder('jc')
      .innerJoin(TechnicianVisit, 'tv', '"tv"."appointmentId" = "jc"."appointmentId"')
      .select('"jc"."id"', 'jobCardId')
      .addSelect('"jc"."faultCode"', 'faultCode')
      .addSelect('"jc"."qcApprovedAt"', 'qcApprovedAt')
      .addSelect('"tv"."technicianId"', 'technicianId')
      .addSelect('"tv"."startedAt"', 'startedAt')
      .where('"jc"."qcApprovedAt" IS NOT NULL')
      .getRawMany();

    const faultSymptoms = await this.faultSymptomRepo.find({ select: { faultCode: true, category: true } });
    const categoryByFaultCode = new Map(faultSymptoms.map((f) => [f.faultCode, f.category]));

    const technicianIds = [...new Set(rows.map((r) => r.technicianId))];
    const technicians = technicianIds.length
      ? await this.userRepo.find({ where: { id: In(technicianIds) }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const technicianNameById = new Map(technicians.map((t) => [t.id, `${t.firstName} ${t.lastName}`]));

    const byTechnician = new Map<string, { sumHours: number; count: number }>();
    const byCategory = new Map<string, { sumHours: number; count: number }>();
    let totalHours = 0;

    for (const r of rows) {
      const hours = (new Date(r.qcApprovedAt).getTime() - new Date(r.startedAt).getTime()) / 3_600_000;
      if (!Number.isFinite(hours) || hours < 0) continue; // defensive - shouldn't happen given the workflow order

      totalHours += hours;

      const techKey = r.technicianId;
      const techAgg = byTechnician.get(techKey) ?? { sumHours: 0, count: 0 };
      techAgg.sumHours += hours;
      techAgg.count += 1;
      byTechnician.set(techKey, techAgg);

      const category = categoryByFaultCode.get(r.faultCode) ?? ApplianceCategory.OTHER;
      const catAgg = byCategory.get(category) ?? { sumHours: 0, count: 0 };
      catAgg.sumHours += hours;
      catAgg.count += 1;
      byCategory.set(category, catAgg);
    }

    const toRows = (m: Map<string, { sumHours: number; count: number }>, labelFor: (k: string) => string) =>
      [...m.entries()]
        .map(([key, agg]) => ({
          key,
          label: labelFor(key),
          jobCount: agg.count,
          avgHours: Math.round((agg.sumHours / agg.count) * 100) / 100,
        }))
        .sort((a, b) => b.jobCount - a.jobCount);

    return {
      asOf: new Date(),
      overallAvgHours: rows.length ? Math.round((totalHours / rows.length) * 100) / 100 : null,
      sampleSize: rows.length,
      byTechnician: toRows(byTechnician, (id) => technicianNameById.get(id) ?? id),
      byCategory: toRows(byCategory, (c) => c),
    };
  }

  /**
   * BRD 18.1 First-Time Fix Rate: (on-site repairs completed without a workshop visit) /
   * total completed jobs. "Completed" = reached QC_PASSED or DELIVERED. An on-site-only
   * fix is a job whose section stayed ON_SITE_REPAIR through to completion - it never
   * touched WORKSHOP_ASSIGNED/IN_PROGRESS/SPARE_PENDING, i.e. section is still
   * ON_SITE_REPAIR at query time (section is a snapshot of the assigned section, not a
   * history, so this can't distinguish "never left on-site" from a section change
   * mid-flow after the fact - documented simplification, matches how `section` is used
   * everywhere else in this codebase).
   */
  async getFirstTimeFixRate(): Promise<FirstTimeFixRateReport> {
    const [totalCompletedJobs, onSiteOnlyCompletedJobs] = await Promise.all([
      this.jobCardRepo.count({ where: { status: In(COMPLETED_STATUSES) } }),
      this.jobCardRepo.count({
        where: { status: In(COMPLETED_STATUSES), section: JobCardSection.ON_SITE_REPAIR },
      }),
    ]);

    return {
      asOf: new Date(),
      totalCompletedJobs,
      onSiteOnlyCompletedJobs,
      rate: totalCompletedJobs > 0 ? Math.round((onSiteOnlyCompletedJobs / totalCompletedJobs) * 10000) / 10000 : null,
    };
  }

  /** Single-call payload for the dashboard's initial page load - one round trip instead of four. */
  async getOverview(): Promise<DashboardOverview> {
    const [kanbanSummary, approvalAging, firstTimeFixRate, serviceEfficiency] = await Promise.all([
      this.getKanbanSummary(),
      this.getApprovalAging(),
      this.getFirstTimeFixRate(),
      this.getServiceEfficiency(),
    ]);

    return {
      asOf: new Date(),
      kanbanSummary,
      approvalAging: {
        breachedCount: approvalAging.breachedCount,
        // items are sorted ASC by sentAt, so index 0 has been waiting longest.
        oldestAgeHours: approvalAging.items.length ? approvalAging.items[0].ageHours : null,
      },
      firstTimeFixRate,
      serviceEfficiency: {
        overallAvgHours: serviceEfficiency.overallAvgHours,
        sampleSize: serviceEfficiency.sampleSize,
      },
    };
  }
}
