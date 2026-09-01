import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { JobCard, JobCardStatus } from '../job-cards/entities/job-card.entity';
import { TechnicianVisit } from '../technician/entities/technician-visit.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { User } from '../auth/entities/user.entity';
import { InventoryReservation, ReservationStatus } from '../inventory/entities/inventory-reservation.entity';
import { SparePart } from '../master-data/entities/spare-part.entity';

const COMPLETED_STATUSES = [JobCardStatus.QC_PASSED, JobCardStatus.DELIVERED];
const DEFAULT_SLA_HOURS = 48; // BRD 18.4's own literal example ("e.g., 48-hour completion") - no stored per-job SLA field exists.

/**
 * BRD 18.4 Operational Reports. Two documented gaps, both following the same
 * omit-what-doesn't-exist pattern as Finance/Quality:
 * - "Customer rating" (Technician Productivity) is omitted entirely, not null - the BRD's
 *   own "(if captured)" already hedges it, and nothing anywhere captures it.
 * - "Reason codes" (SLA Breach Report) is replaced by the actual hoursOverThreshold figure
 *   - nothing in this app records WHY a job took long, so a fabricated reason category
 *     would be worse than just showing how far over the job actually ran.
 */

export interface TechnicianProductivityRow {
  technicianId: string;
  technicianName: string;
  jobsCompleted: number;
  avgHoursLoginToQc: number | null;
  onTimeArrivalPct: number | null;
}

export interface TechnicianProductivityReport {
  asOf: Date;
  periodStart: string | null;
  periodEnd: string | null;
  rows: TechnicianProductivityRow[];
  note: string;
}

export interface SlaBreachItem {
  jobCardId: string;
  jobCardNumber: string;
  createdAt: Date;
  qcApprovedAt: Date;
  hoursElapsed: number;
  hoursOverThreshold: number;
}

export interface SlaBreachReport {
  asOf: Date;
  thresholdHours: number;
  breachedCount: number;
  items: SlaBreachItem[];
}

export interface SpareConsumptionEntry {
  sparePartId: string;
  code: string;
  name: string;
  totalQuantity: number;
  totalValue: number;
}

export interface SpareConsumptionByGroup {
  key: string;
  totalQuantity: number;
  totalValue: number;
}

export interface SpareConsumptionReport {
  periodStart: string | null;
  periodEnd: string | null;
  topByQuantity: SpareConsumptionEntry[];
  topByValue: SpareConsumptionEntry[];
  byModel: SpareConsumptionByGroup[];
  byWarrantyStatus: SpareConsumptionByGroup[];
}

@Injectable()
export class OperationalReportsService {
  constructor(
    @InjectRepository(JobCard) private jobCardRepo: Repository<JobCard>,
    @InjectRepository(TechnicianVisit) private visitRepo: Repository<TechnicianVisit>,
    @InjectRepository(Appointment) private appointmentRepo: Repository<Appointment>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(InventoryReservation) private reservationRepo: Repository<InventoryReservation>,
    @InjectRepository(SparePart) private sparePartRepo: Repository<SparePart>,
  ) {}

  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /**
   * Technician identity follows the same convention as ReportsService.getServiceEfficiency
   * (TechnicianVisit.technicianId, the field technician) - the on-site visit is the one
   * consistent "which technician" anchor every completed job has.
   */
  async getTechnicianProductivity(periodStart?: string, periodEnd?: string): Promise<TechnicianProductivityReport> {
    let qb = this.jobCardRepo
      .createQueryBuilder('jc')
      .innerJoin(TechnicianVisit, 'tv', '"tv"."appointmentId" = "jc"."appointmentId"')
      .innerJoin(Appointment, 'appt', '"appt"."id" = "jc"."appointmentId"')
      .select('"jc"."id"', 'jobCardId')
      .addSelect('"jc"."qcApprovedAt"', 'qcApprovedAt')
      .addSelect('"tv"."technicianId"', 'technicianId')
      .addSelect('"tv"."startedAt"', 'startedAt')
      .addSelect('"appt"."scheduledAt"', 'scheduledAt')
      .where('"jc"."status" IN (:...statuses)', { statuses: COMPLETED_STATUSES });

    if (periodStart) qb = qb.andWhere('"jc"."qcApprovedAt" >= :periodStart', { periodStart });
    if (periodEnd) qb = qb.andWhere('"jc"."qcApprovedAt" <= :periodEnd', { periodEnd: `${periodEnd} 23:59:59.999` });

    const rows = await qb.getRawMany();

    const technicianIds = [...new Set(rows.map((r) => r.technicianId))];
    const technicians = technicianIds.length
      ? await this.userRepo.find({ where: { id: In(technicianIds) }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const nameById = new Map(technicians.map((t) => [t.id, `${t.firstName} ${t.lastName}`]));

    const agg = new Map<string, { count: number; sumHours: number; onTimeCount: number; totalCount: number }>();
    for (const r of rows) {
      const a = agg.get(r.technicianId) ?? { count: 0, sumHours: 0, onTimeCount: 0, totalCount: 0 };
      const hours = (new Date(r.qcApprovedAt).getTime() - new Date(r.startedAt).getTime()) / 3_600_000;
      if (Number.isFinite(hours) && hours >= 0) {
        a.count += 1;
        a.sumHours += hours;
      }
      // On-time arrival: strictly on-time-or-early, zero grace period (BRD specifies none).
      a.totalCount += 1;
      if (new Date(r.startedAt).getTime() <= new Date(r.scheduledAt).getTime()) a.onTimeCount += 1;
      agg.set(r.technicianId, a);
    }

    const resultRows: TechnicianProductivityRow[] = [...agg.entries()]
      .map(([technicianId, a]) => ({
        technicianId,
        technicianName: nameById.get(technicianId) ?? technicianId,
        jobsCompleted: a.totalCount,
        avgHoursLoginToQc: a.count > 0 ? this.round(a.sumHours / a.count) : null,
        onTimeArrivalPct: a.totalCount > 0 ? this.round((a.onTimeCount / a.totalCount) * 100) : null,
      }))
      .sort((a, b) => b.jobsCompleted - a.jobsCompleted);

    return {
      asOf: new Date(),
      periodStart: periodStart ?? null,
      periodEnd: periodEnd ?? null,
      rows: resultRows,
      note: 'Customer rating is not captured anywhere in this app and is omitted from this report (the BRD itself marks it "(if captured)"). On-time arrival uses zero grace period (technician start time strictly at-or-before the scheduled time) - the BRD specifies no grace window.',
    };
  }

  /** BRD 18.4 SLA Breach Report - JobCard.createdAt -> qcApprovedAt, default 48h threshold. */
  async getSlaBreach(thresholdHours: number = DEFAULT_SLA_HOURS): Promise<SlaBreachReport> {
    // TypeORM's find() has no "IS NOT NULL" shorthand, so this uses a query builder.
    const rows = await this.jobCardRepo
      .createQueryBuilder('jc')
      .where('"jc"."qcApprovedAt" IS NOT NULL')
      .getMany();

    const items: SlaBreachItem[] = [];
    for (const jc of rows) {
      const hoursElapsed = (jc.qcApprovedAt!.getTime() - jc.createdAt.getTime()) / 3_600_000;
      if (hoursElapsed > thresholdHours) {
        items.push({
          jobCardId: jc.id,
          jobCardNumber: jc.jobCardNumber,
          createdAt: jc.createdAt,
          qcApprovedAt: jc.qcApprovedAt!,
          hoursElapsed: this.round(hoursElapsed),
          hoursOverThreshold: this.round(hoursElapsed - thresholdHours),
        });
      }
    }
    items.sort((a, b) => b.hoursOverThreshold - a.hoursOverThreshold);

    return {
      asOf: new Date(),
      thresholdHours,
      breachedCount: items.length,
      items,
    };
  }

  /**
   * BRD 18.4 Spare Parts Consumption - top 10 by quantity, top 10 by value, plus
   * by-model and by-warranty/OOW breakdowns. Value = unitCost * quantityReserved (cost
   * basis, consistent with how "cost" is computed everywhere else for CONSUMED
   * reservations - deliberately not unitPriceB2B/B2C, which is revenue, not "value
   * consumed").
   */
  async getSpareConsumption(periodStart?: string, periodEnd?: string): Promise<SpareConsumptionReport> {
    let qb = this.reservationRepo
      .createQueryBuilder('res')
      .innerJoin(JobCard, 'jc', '"jc"."id" = "res"."jobCardId"')
      .innerJoin(Appointment, 'appt', '"appt"."id" = "jc"."appointmentId"')
      .select('"res"."sparePartId"', 'sparePartId')
      .addSelect('"res"."quantityReserved"', 'quantityReserved')
      .addSelect('"jc"."warrantyStatus"', 'warrantyStatus')
      .addSelect('"appt"."modelNumber"', 'modelNumber')
      .where('"res"."status" = :status', { status: ReservationStatus.CONSUMED });

    if (periodStart) qb = qb.andWhere('"res"."consumedAt" >= :periodStart', { periodStart });
    if (periodEnd) qb = qb.andWhere('"res"."consumedAt" <= :periodEnd', { periodEnd: `${periodEnd} 23:59:59.999` });

    const rows = await qb.getRawMany();

    const sparePartIds = [...new Set(rows.map((r) => r.sparePartId))];
    const spareParts = sparePartIds.length
      ? await this.sparePartRepo.find({ where: { id: In(sparePartIds) } })
      : [];
    const sparePartById = new Map(spareParts.map((sp) => [sp.id, sp]));

    const bySpare = new Map<string, { quantity: number; value: number }>();
    const byModel = new Map<string, { quantity: number; value: number }>();
    const byWarranty = new Map<string, { quantity: number; value: number }>();

    for (const r of rows) {
      const sparePart = sparePartById.get(r.sparePartId);
      const unitCost = Number(sparePart?.unitCost ?? 0);
      const qty = Number(r.quantityReserved);
      const value = this.round(unitCost * qty);

      const spareAgg = bySpare.get(r.sparePartId) ?? { quantity: 0, value: 0 };
      spareAgg.quantity += qty;
      spareAgg.value += value;
      bySpare.set(r.sparePartId, spareAgg);

      const modelKey = r.modelNumber ?? 'Unknown';
      const modelAgg = byModel.get(modelKey) ?? { quantity: 0, value: 0 };
      modelAgg.quantity += qty;
      modelAgg.value += value;
      byModel.set(modelKey, modelAgg);

      const warrantyKey = r.warrantyStatus ?? 'Unknown';
      const warrantyAgg = byWarranty.get(warrantyKey) ?? { quantity: 0, value: 0 };
      warrantyAgg.quantity += qty;
      warrantyAgg.value += value;
      byWarranty.set(warrantyKey, warrantyAgg);
    }

    const spareEntries: SpareConsumptionEntry[] = [...bySpare.entries()].map(([sparePartId, agg]) => {
      const sp = sparePartById.get(sparePartId);
      return {
        sparePartId,
        code: sp?.code ?? sparePartId,
        name: sp?.name ?? 'Unknown',
        totalQuantity: agg.quantity,
        totalValue: this.round(agg.value),
      };
    });

    const toGroupRows = (m: Map<string, { quantity: number; value: number }>): SpareConsumptionByGroup[] =>
      [...m.entries()]
        .map(([key, agg]) => ({ key, totalQuantity: agg.quantity, totalValue: this.round(agg.value) }))
        .sort((a, b) => b.totalValue - a.totalValue);

    return {
      periodStart: periodStart ?? null,
      periodEnd: periodEnd ?? null,
      topByQuantity: [...spareEntries].sort((a, b) => b.totalQuantity - a.totalQuantity).slice(0, 10),
      topByValue: [...spareEntries].sort((a, b) => b.totalValue - a.totalValue).slice(0, 10),
      byModel: toGroupRows(byModel),
      byWarrantyStatus: toGroupRows(byWarranty),
    };
  }
}
