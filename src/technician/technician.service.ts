import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TechnicianVisit, WarrantyStatus } from './entities/technician-visit.entity';
import { AppointmentsService } from '../appointments/appointments.service';
import { MasterDataService } from '../master-data/master-data.service';
import { AppointmentStatus } from '../appointments/entities/appointment.entity';
import { StartVisitDto } from './dto/start-visit.dto';
import { CaptureSerialNumberDto } from './dto/capture-serial-number.dto';
import { CaptureFaultSymptomDto } from './dto/capture-fault-symptom.dto';
import { User } from '../auth/entities/user.entity';

const SELF_SERVICE_ONLY_ROLE = 'TECHNICIAN_FIELD';

@Injectable()
export class TechnicianService {
  constructor(
    @InjectRepository(TechnicianVisit)
    private visitRepository: Repository<TechnicianVisit>,
    private appointmentsService: AppointmentsService,
    private masterDataService: MasterDataService,
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
}
