import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TechnicianVisit, WarrantyStatus } from './entities/technician-visit.entity';
import { JobCard, JobCardStatus, JobCardSection } from '../job-cards/entities/job-card.entity';
import { AppointmentsService } from '../appointments/appointments.service';
import { MasterDataService } from '../master-data/master-data.service';
import { InventoryService } from '../inventory/inventory.service';
import { InventoryReservation } from '../inventory/entities/inventory-reservation.entity';
import { AppointmentStatus } from '../appointments/entities/appointment.entity';
import { StartVisitDto } from './dto/start-visit.dto';
import { CaptureSerialNumberDto } from './dto/capture-serial-number.dto';
import { CaptureFaultSymptomDto } from './dto/capture-fault-symptom.dto';
import { NeedSpareDto } from './dto/need-spare.dto';
import { CompleteVisitDto } from './dto/complete-visit.dto';
import { User } from '../auth/entities/user.entity';
import { getJobCardProgressFields, JobCardProgressFields } from '../job-cards/job-card-progress.util';

const SELF_SERVICE_ONLY_ROLE = 'TECHNICIAN_FIELD';

/**
 * Mobile Phase 5 bug fix (2026-09-07): getOwnJobCard() used to return a bare JobCard,
 * which gave the mobile app's poll no way to know whether a Need Spare request already
 * exists for it - see InventoryService.findLatestNeedSpareRequestForJobCard()'s doc
 * comment for the full story. `spareRequest` is that reservation's latest row (or null),
 * loaded alongside the Job Card so the mobile screen can rehydrate its own display state
 * from the server instead of a local mutation-success flag that a screen remount wipes.
 */
export interface OwnJobCardResult {
  jobCard: (JobCard & JobCardProgressFields) | null;
  spareRequest: InventoryReservation | null;
}

@Injectable()
export class TechnicianService {
  constructor(
    @InjectRepository(TechnicianVisit)
    private visitRepository: Repository<TechnicianVisit>,
    // Entity-only repo, not JobCardsService - see the doc comment on TechnicianModule's
    // TypeOrmModule.forFeature() import for why (JobCardsModule already imports this
    // module, so the reverse would be a circular module dependency).
    @InjectRepository(JobCard)
    private jobCardRepository: Repository<JobCard>,
    private appointmentsService: AppointmentsService,
    private masterDataService: MasterDataService,
    private inventoryService: InventoryService,
  ) {}

  /**
   * A TECHNICIAN_FIELD user may only act on appointments assigned to themselves.
   * Supervisory roles (SUPER_ADMIN/SERVICE_HEAD/TECHNICAL_TEAM_LEADER) can act on behalf
   * of any technician, mirroring the role list already used on AppointmentsController's
   * on-site/complete endpoints.
   */
  private assertOwnership(appointmentTechnicianId: string | null, caller: User): void {
    if (caller.role?.name === SELF_SERVICE_ONLY_ROLE && appointmentTechnicianId !== caller.id) {
      throw new ForbiddenException('You can only act on appointments assigned to you');
    }
  }

  private async findVisitByAppointmentId(appointmentId: string): Promise<TechnicianVisit> {
    const visit = await this.visitRepository.findOne({ where: { appointmentId } });
    if (!visit) {
      throw new NotFoundException(
        `No visit has been started for appointment ${appointmentId}. Call start-visit first.`,
      );
    }
    return visit;
  }

  /**
   * FR-02: capture GPS + timestamp when a Field Technician starts a visit.
   * Delegates the actual status transition to AppointmentsService.markOnSite so the
   * SCHEDULED/CONFIRMED/TECHNICIAN_ASSIGNED -> ON_SITE business rule lives in one place.
   */
  async startVisit(
    appointmentId: string,
    dto: StartVisitDto,
    caller: User,
    req?: any,
  ): Promise<TechnicianVisit> {
    const appointment = await this.appointmentsService.findById(appointmentId);
    this.assertOwnership(appointment.technicianId, caller);

    if (appointment.status !== AppointmentStatus.ON_SITE) {
      // First arrival - reuses AppointmentsService's own status-transition guard (throws
      // BadRequestException unless CONFIRMED/TECHNICIAN_ASSIGNED) instead of duplicating it.
      await this.appointmentsService.markOnSite(appointmentId, caller.id, req);
    }
    // else: appointment is already ON_SITE - the technician re-opened the visit (e.g. app
    // restart) without a status transition; just refresh the GPS capture below.

    const startedAt = new Date();
    const existing = await this.visitRepository.findOne({ where: { appointmentId } });

    if (existing) {
      // Overwrite the GPS/start capture but keep whatever S/N or fault/symptom data was
      // already recorded for this visit.
      existing.startGpsLat = dto.gpsLat;
      existing.startGpsLng = dto.gpsLng;
      existing.startedAt = startedAt;
      existing.technicianId = caller.id;
      return this.visitRepository.save(existing);
    }

    const visit = this.visitRepository.create({
      appointmentId,
      technicianId: caller.id,
      startGpsLat: dto.gpsLat,
      startGpsLng: dto.gpsLng,
      startedAt,
    });
    return this.visitRepository.save(visit);
  }

  /**
   * FR-03: validate the captured Serial Number against Warranty Master and return the
   * IW/OOW badge. Requires the visit to have been started first.
   */
  async captureSerialNumber(
    appointmentId: string,
    dto: CaptureSerialNumberDto,
    caller: User,
  ): Promise<TechnicianVisit> {
    const appointment = await this.appointmentsService.findById(appointmentId);
    this.assertOwnership(appointment.technicianId, caller);

    if (appointment.status !== AppointmentStatus.ON_SITE) {
      throw new BadRequestException('Serial number can only be captured for an on-site visit');
    }

    const visit = await this.findVisitByAppointmentId(appointmentId);

    const warranty = await this.masterDataService.checkWarranty(dto.serialNumber, dto.brand);

    visit.serialNumber = dto.serialNumber;
    visit.brand = dto.brand ?? null;
    visit.warrantyStatus = warranty.isUnderWarranty ? WarrantyStatus.IN_WARRANTY : WarrantyStatus.OUT_OF_WARRANTY;
    visit.warrantySupplier = warranty.supplier;
    visit.warrantyPeriodMonths = warranty.warrantyPeriodMonths;
    visit.serialNumberCapturedAt = new Date();
    // A re-capture invalidates any previously recorded fault/symptom pair (FR-04 gates
    // fault/symptom on the *current* validated S/N).
    visit.faultCode = null;
    visit.symptomCode = null;
    visit.faultSymptomCapturedAt = null;

    return this.visitRepository.save(visit);
  }

  /**
   * FR-04: Fault Code + Symptom Code may only be recorded once the S/N has been captured
   * and validated. Both codes are checked against master data (404s if unknown).
   */
  async captureFaultSymptom(
    appointmentId: string,
    dto: CaptureFaultSymptomDto,
    caller: User,
  ): Promise<TechnicianVisit> {
    const appointment = await this.appointmentsService.findById(appointmentId);
    this.assertOwnership(appointment.technicianId, caller);

    const visit = await this.findVisitByAppointmentId(appointmentId);

    if (!visit.serialNumber || !visit.warrantyStatus) {
      throw new BadRequestException('Capture and validate the serial number before recording fault/symptom codes');
    }

    // Both throw NotFoundException for an unknown code.
    await this.masterDataService.findFaultByCode(dto.faultCode);
    await this.masterDataService.findSymptomByCode(dto.symptomCode);

    visit.faultCode = dto.faultCode;
    visit.symptomCode = dto.symptomCode;
    visit.faultSymptomCapturedAt = new Date();

    return this.visitRepository.save(visit);
  }

  async getVisit(appointmentId: string): Promise<TechnicianVisit> {
    return this.findVisitByAppointmentId(appointmentId);
  }

  /** Convenience for the mobile app's "my schedule" screen - defaults to today. */
  async getMySchedule(technicianId: string, date?: Date) {
    return this.appointmentsService.getTechnicianSchedule(technicianId, date ?? new Date());
  }

  /**
   * Lean lookup used by both Mobile Phase 5 methods below - a Job Card only exists once
   * staff have created it from this visit's captured data (JobCardsService.create()'s own
   * Gate 1 already requires serial number + warranty + fault/symptom to all be present
   * before that can happen), and only reaches ON_SITE_REPAIR/SECTION_ASSIGNED once
   * assign-section has run. Both are staff-side actions that happen after the mobile
   * Phases 1-3 capture flow, ahead of a technician ever reaching Need Spare or Complete.
   */
  private async findOwnJobCardForOnSiteRepair(appointmentId: string, caller: User): Promise<JobCard> {
    const appointment = await this.appointmentsService.findById(appointmentId);
    this.assertOwnership(appointment.technicianId, caller);

    const jobCard = await this.jobCardRepository.findOne({ where: { appointmentId } });
    if (!jobCard) {
      throw new NotFoundException(
        `No Job Card exists yet for appointment ${appointmentId} - this is created by staff once your visit data (serial number, warranty, fault/symptom) has been captured and the invoice is on file.`,
      );
    }
    if (jobCard.section !== JobCardSection.ON_SITE_REPAIR || jobCard.status !== JobCardStatus.SECTION_ASSIGNED) {
      throw new BadRequestException(
        `This Job Card is ${jobCard.status} (section: ${jobCard.section ?? 'not assigned'}) - Need Spare/Complete are only available for an on-site repair job that's been assigned and not yet finished.`,
      );
    }
    return jobCard;
  }

  /**
   * Mobile Phase 5: the mobile app has no other way to know a Job Card exists yet (or
   * what status/section it's in) for this appointment - JobCard creation, S/N validation
   * and section assignment are all staff-side (Swagger/web) actions that happen some
   * unknown time after the technician finishes Phases 1-3. Without this, the app would
   * have to show Need Spare/Complete buttons blind and rely on the backend's error
   * message alone. Returns null rather than throwing when there's no Job Card yet
   * (deliberately different from findOwnJobCardForOnSiteRepair's throw above) - the
   * mobile screen treats "no Job Card yet" as an ordinary, expected state to poll/wait
   * on, not an error to surface.
   */
  async getOwnJobCard(appointmentId: string, caller: User): Promise<OwnJobCardResult> {
    const appointment = await this.appointmentsService.findById(appointmentId);
    this.assertOwnership(appointment.technicianId, caller);
    const jobCard = await this.jobCardRepository.findOne({ where: { appointmentId } });
    const spareRequest = jobCard
      ? await this.inventoryService.findLatestNeedSpareRequestForJobCard(jobCard.id)
      : null;
    // See job-cards.service.ts findById() for why this mutates in place (Object.assign)
    // rather than spreading into a plain object.
    if (jobCard) {
      Object.assign(jobCard, getJobCardProgressFields(jobCard));
    }
    return { jobCard: jobCard as (JobCard & JobCardProgressFields) | null, spareRequest };
  }

  /**
   * Mobile Phase 5 (Need Spare): creates a PENDING_REVIEW reservation - see
   * InventoryService.requestNeedSpare()'s doc comment for why nothing moves yet. The
   * technician themself is the custodian, since they're who the part will eventually reach.
   */
  async requestNeedSpare(appointmentId: string, dto: NeedSpareDto, caller: User): Promise<InventoryReservation> {
    const jobCard = await this.findOwnJobCardForOnSiteRepair(appointmentId, caller);
    return this.inventoryService.requestNeedSpare(dto.sparePartId, dto.quantity, jobCard.id, caller.id, caller.id, dto.idempotencyKey);
  }

  /**
   * Mobile Phase 5 (Complete/QC-handoff): the first status path ON_SITE_REPAIR Job Cards
   * have ever had to READY_FOR_QC - WORKSHOP-section jobs get there via
   * JobCardsService.completeWorkshop(); this mirrors that guard/transition shape for the
   * on-site-repair case, implemented here rather than in JobCardsService only because of
   * the circular-module-dependency constraint noted above (TechnicianModule can't import
   * JobCardsModule). Also completes the underlying Appointment (technician's visit is
   * over), matching the existing "reassignment/cancel already span two services" pattern
   * elsewhere in this codebase.
   *
   * Deliberately no precondition check beyond the status/section gate above: by the time a
   * Job Card exists at all, serial number + fault/symptom are already guaranteed captured
   * (JobCardsService.create()'s Gate 1) - there's no diagnostic data this could be missing
   * that QC needs. `notes` is a free-text on-site summary only, not validated data.
   */
  async completeOnSiteRepair(appointmentId: string, dto: CompleteVisitDto, caller: User, req?: any): Promise<JobCard> {
    const jobCard = await this.findOwnJobCardForOnSiteRepair(appointmentId, caller);

    await this.appointmentsService.completeAppointment(appointmentId, caller.id, req);

    jobCard.status = JobCardStatus.READY_FOR_QC;
    if (dto.notes) {
      jobCard.onSiteCompletionNotes = dto.notes;
    }
    return this.jobCardRepository.save(jobCard);
  }
}
