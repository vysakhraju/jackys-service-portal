import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobCard } from '../job-cards/entities/job-card.entity';
import { JobCardsService } from '../job-cards/job-cards.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { TechnicianService } from '../technician/technician.service';
import { InventoryService } from '../inventory/inventory.service';
import { EstimatesService } from '../estimates/estimates.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { DeliveryService } from '../delivery/delivery.service';
import { buildJourneySteps } from '../job-cards/job-card-journey.util';

export interface JourneySearchResult {
  jobCardId: string;
  jobCardNumber: string;
  jobCardStatus: string;
  appointmentNumber: string;
  customerName: string;
  customerPhone: string;
  deliveryNumber: string | null;
}

/**
 * Read-only aggregator sitting ABOVE every module a Job Card's lifecycle touches
 * (Appointments, Technician, Job Cards, Inventory, Estimates, Invoicing, Delivery) - this
 * is the "Job Card Journey" page's whole reason to exist: none of those modules can afford
 * to import each other freely (see job-cards.module.ts / appointments.service.ts's own
 * comments on the circular-dependency constraints already baked into this codebase), but
 * nothing stops a NEW module that only ever reads from all of them and is never imported
 * back by any of them - so this is deliberately its own top-level module rather than
 * bolted onto JobCardsModule, which would risk exactly that cycle (DeliveryModule,
 * EstimatesModule, InvoicingModule and WorkshopModule all already import JobCardsModule).
 */
@Injectable()
export class JobCardJourneyService {
  constructor(
    @InjectRepository(JobCard)
    private jobCardRepository: Repository<JobCard>,
    private jobCardsService: JobCardsService,
    private appointmentsService: AppointmentsService,
    private technicianService: TechnicianService,
    private inventoryService: InventoryService,
    private estimatesService: EstimatesService,
    private invoicingService: InvoicingService,
    private deliveryService: DeliveryService,
  ) {}

  async getJourney(jobCardId: string) {
    const jobCard = await this.jobCardsService.findById(jobCardId);
    const appointment = await this.appointmentsService.findById(jobCard.appointmentId);

    // A visit is guaranteed to exist by the time a Job Card does (Gate 1 in
    // JobCardsService.create()), but this page must never itself throw over a display-only
    // concern - fall back to null rather than let a lookup failure blank the whole page
    // (the exact class of bug the 2026-09-08 decimal-columns fix was about avoiding).
    const visit = await this.technicianService.getVisit(jobCard.appointmentId).catch(() => null);

    const [taskPauses, spareRequest, estimates, invoice, delivery] = await Promise.all([
      this.jobCardsService.getTaskPauses(jobCardId),
      this.inventoryService.findLatestNeedSpareRequestForJobCard(jobCardId),
      this.estimatesService.findByJobCardId(jobCardId),
      this.invoicingService.findByJobCardId(jobCardId),
      // Deliberately NOT deliveryService.findByJobCardId(jobCardId) - that method re-fetches
      // the Job Card internally (jobCardsService.findById) purely to read its deliveryId,
      // which we already have on `jobCard` above. Going straight to deliveryService.findById
      // off jobCard.deliveryId avoids a second, redundant Job Card query on every journey
      // view (found in QA review - a real inefficiency, not a correctness bug, since the
      // extra lookup returned identical data).
      jobCard.deliveryId ? this.deliveryService.findById(jobCard.deliveryId) : Promise.resolve(null),
    ]);

    const steps = buildJourneySteps({
      appointment: { createdAt: appointment.createdAt, scheduledAt: appointment.scheduledAt },
      visit: visit ? { startedAt: visit.startedAt } : null,
      jobCard,
      delivery: delivery
        ? {
            createdAt: delivery.createdAt,
            status: delivery.status,
            dispatchedAt: delivery.dispatchedAt,
            deliveredAt: delivery.deliveredAt,
            cancellationReason: delivery.cancellationReason,
            deliveryNumber: delivery.deliveryNumber,
          }
        : null,
    });

    return { jobCard, appointment, visit, taskPauses, spareRequest, estimates, invoice, delivery, steps };
  }

  /**
   * One search box standing in for the "APT / JC / DLV / customer name, all in one place"
   * ask - matches a Job Card number, its Appointment's number/customer name/phone, or its
   * linked Delivery's number, whichever the user actually has on hand. Capped at 20 so a
   * broad query (e.g. a common first name) stays a pick-list, not a second list-all screen.
   */
  async search(query: string): Promise<JourneySearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    // TypeORM's `:like` binding already parameterizes this - there's no SQL injection risk
    // here, the value can never be interpreted as SQL. What IS unescaped without this is
    // the *pattern* ILIKE itself understands: a literal '%' or '_' typed by the user (e.g.
    // searching a phone number containing one, or a customer named with one) would act as
    // a wildcard instead of a literal character, silently widening the match. Escaping them
    // (and a literal backslash, which would otherwise escape the next character) plus the
    // explicit ESCAPE clause keeps the search literal, matching what the user actually typed.
    const escaped = trimmed.replace(/[\\%_]/g, (c) => `\\${c}`);
    const like = `%${escaped}%`;

    const rows = await this.jobCardRepository
      .createQueryBuilder('jc')
      .innerJoin('jc.appointment', 'apt')
      .leftJoin('jc.delivery', 'dlv')
      .where("jc.jobCardNumber ILIKE :like ESCAPE '\\'", { like })
      .orWhere("apt.appointmentNumber ILIKE :like ESCAPE '\\'", { like })
      .orWhere("apt.customerName ILIKE :like ESCAPE '\\'", { like })
      .orWhere("apt.customerPhone ILIKE :like ESCAPE '\\'", { like })
      .orWhere("dlv.deliveryNumber ILIKE :like ESCAPE '\\'", { like })
      .select([
        'jc.id',
        'jc.jobCardNumber',
        'jc.status',
        'apt.appointmentNumber',
        'apt.customerName',
        'apt.customerPhone',
        'dlv.deliveryNumber',
      ])
      .orderBy('jc.updatedAt', 'DESC')
      .limit(20)
      .getMany();

    return rows.map((jc) => ({
      jobCardId: jc.id,
      jobCardNumber: jc.jobCardNumber,
      jobCardStatus: jc.status,
      appointmentNumber: jc.appointment.appointmentNumber,
      customerName: jc.appointment.customerName,
      customerPhone: jc.appointment.customerPhone,
      deliveryNumber: jc.delivery?.deliveryNumber ?? null,
    }));
  }
}
