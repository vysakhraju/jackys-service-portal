import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { JobCard, JobCardStatus } from '../job-cards/entities/job-card.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { Estimate, EstimateStatus } from '../estimates/entities/estimate.entity';
import { ServiceCentre } from '../master-data/entities/service-centre.entity';

/**
 * BRD 18.3 Quality / Product Team Dashboard (AC-22/23/24). All three rows are
 * straightforwardly computable from existing entities - no cost/revenue ambiguity here,
 * unlike Finance. Two documented gaps, both following this app's established
 * documented-gap-over-silent-guess pattern:
 * - "Region" (RWR Analysis): no dedicated region field exists on ServiceCentre. Uses
 *   `city`, falling back to `country` when city is null.
 * - "Reason" (RWR Analysis): no structured rejection-reason-code field exists on
 *   Estimate - `responseNotes` is free text, filled in only for STAFF_RECORDED responses
 *   (never for CUSTOMER_LINK responses, which have no notes field at all on the public
 *   flow). Grouped on the raw text where present, "Not specified" otherwise - never a
 *   fabricated taxonomy.
 */

export interface ProductFailureRatioRow {
  periodLabel: string;
  model: string;
  brand: string;
  count: number;
}

export interface RepeatComplaintItem {
  serialNumber: string;
  totalJobCount: number;
  repeatWithin30Days: boolean;
  jobCardNumbers: string[];
  minGapDays: number | null;
}

export interface RwrAnalysisRow {
  model: string;
  reason: string;
  region: string;
  count: number;
}

@Injectable()
export class QualityReportsService {
  constructor(
    @InjectRepository(JobCard) private jobCardRepo: Repository<JobCard>,
    @InjectRepository(Appointment) private appointmentRepo: Repository<Appointment>,
    @InjectRepository(Estimate) private estimateRepo: Repository<Estimate>,
    @InjectRepository(ServiceCentre) private serviceCentreRepo: Repository<ServiceCentre>,
  ) {}

  /**
   * AC-22: filterable by brand, model, fault code, time period (month/quarter/year).
   * "Failure" = one Job Card = one reported fault instance for that model. Grouped by
   * JobCard.createdAt (when the fault was reported), not qcApprovedAt.
   */
  async getProductFailureRatio(filters: {
    brand?: string;
    modelNumber?: string;
    faultCode?: string;
    groupBy?: 'month' | 'quarter' | 'year';
    periodStart?: string;
    periodEnd?: string;
  }): Promise<ProductFailureRatioRow[]> {
    const truncUnit = filters.groupBy ?? 'month';

    let qb = this.jobCardRepo
      .createQueryBuilder('jc')
      .innerJoin(Appointment, 'appt', '"appt"."id" = "jc"."appointmentId"')
      .select(`DATE_TRUNC('${truncUnit}', "jc"."createdAt")`, 'bucket')
      .addSelect('"jc"."brand"', 'brand')
      .addSelect('"appt"."modelNumber"', 'model')
      .addSelect('COUNT(*)', 'count');

    if (filters.brand) qb = qb.andWhere('"jc"."brand" = :brand', { brand: filters.brand });
    if (filters.modelNumber) qb = qb.andWhere('"appt"."modelNumber" = :modelNumber', { modelNumber: filters.modelNumber });
    if (filters.faultCode) qb = qb.andWhere('"jc"."faultCode" = :faultCode', { faultCode: filters.faultCode });
    if (filters.periodStart) qb = qb.andWhere('"jc"."createdAt" >= :periodStart', { periodStart: filters.periodStart });
    if (filters.periodEnd) qb = qb.andWhere('"jc"."createdAt" <= :periodEnd', { periodEnd: `${filters.periodEnd} 23:59:59.999` });

    const rows = await qb.groupBy('bucket').addGroupBy('"jc"."brand"').addGroupBy('"appt"."modelNumber"').orderBy('bucket', 'ASC').getRawMany();

    return rows.map((r) => ({
      periodLabel: this.formatPeriodLabel(new Date(r.bucket), truncUnit),
      model: r.model ?? 'Unknown',
      brand: r.brand ?? 'Unknown',
      count: Number(r.count),
    }));
  }

  private formatPeriodLabel(start: Date, groupBy: 'month' | 'quarter' | 'year'): string {
    if (groupBy === 'year') return `${start.getFullYear()}`;
    if (groupBy === 'quarter') return `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`;
    return start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  /**
   * AC-23: S/N with >1 Job Card whose createdAt are within 30 days of each other. Checking
   * only ADJACENT gaps in the sorted-by-date list per S/N is sufficient - if any pair
   * (adjacent or not) is within 30 days, every adjacent gap between them is <= that same
   * span (non-negative gaps summing to <=30 means each individual gap is <=30 too).
   */
  async getRepeatComplaints(): Promise<RepeatComplaintItem[]> {
    const jobs = await this.jobCardRepo.find({
      where: { status: In(Object.values(JobCardStatus).filter((s) => s !== JobCardStatus.CANCELLED)) },
      select: { id: true, jobCardNumber: true, serialNumber: true, createdAt: true },
      order: { createdAt: 'ASC' },
    });

    const bySerial = new Map<string, { jobCardNumber: string; createdAt: Date }[]>();
    for (const j of jobs) {
      const list = bySerial.get(j.serialNumber) ?? [];
      list.push({ jobCardNumber: j.jobCardNumber, createdAt: j.createdAt });
      bySerial.set(j.serialNumber, list);
    }

    const THIRTY_DAYS_MS = 30 * 86_400_000;
    const results: RepeatComplaintItem[] = [];

    for (const [serialNumber, entries] of bySerial.entries()) {
      if (entries.length < 2) continue;

      let minGapMs = Infinity;
      for (let i = 1; i < entries.length; i++) {
        const gap = entries[i].createdAt.getTime() - entries[i - 1].createdAt.getTime();
        if (gap < minGapMs) minGapMs = gap;
      }
      const repeatWithin30Days = minGapMs <= THIRTY_DAYS_MS;

      if (repeatWithin30Days) {
        results.push({
          serialNumber,
          totalJobCount: entries.length,
          repeatWithin30Days: true,
          jobCardNumbers: entries.map((e) => e.jobCardNumber),
          minGapDays: Math.round((minGapMs / 86_400_000) * 100) / 100,
        });
      }
    }

    return results.sort((a, b) => (a.minGapDays ?? 0) - (b.minGapDays ?? 0));
  }

  /**
   * AC-24: RWR count by model, reason, region. Counted from REJECTED Estimates (each
   * rejection is one RWR event), not current JobCardStatus.RWR - a job can be revised past
   * RWR later, but the rejection still happened and is worth counting for a quality trend.
   */
  async getRwrAnalysis(periodStart?: string, periodEnd?: string): Promise<RwrAnalysisRow[]> {
    let qb = this.estimateRepo
      .createQueryBuilder('e')
      .innerJoin(JobCard, 'jc', '"jc"."id" = "e"."jobCardId"')
      .innerJoin(Appointment, 'appt', '"appt"."id" = "jc"."appointmentId"')
      .where('e.status = :status', { status: EstimateStatus.REJECTED });

    if (periodStart) qb = qb.andWhere('"e"."respondedAt" >= :periodStart', { periodStart });
    if (periodEnd) qb = qb.andWhere('"e"."respondedAt" <= :periodEnd', { periodEnd: `${periodEnd} 23:59:59.999` });

    qb = qb
      .select('"appt"."modelNumber"', 'model')
      .addSelect('"e"."responseNotes"', 'reason')
      .addSelect('"appt"."serviceCentreId"', 'serviceCentreId');
    const rows = await qb.getRawMany();

    const centres = await this.serviceCentreRepo.find({ select: { id: true, city: true, country: true } });
    const regionByCentreId = new Map(centres.map((c) => [c.id, c.city || c.country]));

    const counts = new Map<string, RwrAnalysisRow>();
    for (const r of rows) {
      const model = r.model ?? 'Unknown';
      const reason = r.reason?.trim() || 'Not specified';
      const region = regionByCentreId.get(r.serviceCentreId) ?? 'Unknown';
      const key = `${model}|${reason}|${region}`;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { model, reason, region, count: 1 });
      }
    }

    return [...counts.values()].sort((a, b) => b.count - a.count);
  }
}
