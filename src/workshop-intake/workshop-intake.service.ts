import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkshopIntake } from './entities/workshop-intake.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { AppointmentsService } from '../appointments/appointments.service';
import { AppointmentStatus } from '../appointments/entities/appointment.entity';
import { MasterDataService } from '../master-data/master-data.service';
import { CaptureSerialNumberDto } from '../technician/dto/capture-serial-number.dto';
import { CaptureFaultSymptomDto } from '../technician/dto/capture-fault-symptom.dto';

/**
 * Appointment/Mobile/Job Card overhaul Phase 4 (2026-09-16) - the workshop intake screen's
 * backend, for `COLLECTED_TO_WS` appointments (collected from the field, walked in, or
 * driven in - never visited on-site, so TechnicianService's mobile flow never ran for
 * them). Mirrors TechnicianService's startVisit/captureSerialNumber/captureFaultSymptom
 * shape closely on purpose - same data, same validation, same re-capture-invalidates-
 * fault/symptom rule - just entered on the web by workshop/warehouse/CCE staff instead of
 * on mobile by the field technician. See WorkshopIntake's own doc comment for why this is
 * a separate entity rather than reusing TechnicianVisit.
 */
@Injectable()
export class WorkshopIntakeService {
  constructor(
    @InjectRepository(WorkshopIntake)
    private intakeRepository: Repository<WorkshopIntake>,
    private appointmentsService: AppointmentsService,
    private masterDataService: MasterDataService,
  ) {}

  private async assertCollectedToWorkshop(appointmentId: string) {
    const appointment = await this.appointmentsService.findById(appointmentId);
    if (appointment.status !== AppointmentStatus.COLLECTED_TO_WS) {
      throw new BadRequestException(
        `Workshop intake only applies to a collected-to-workshop appointment (current status: ${appointment.status}).`,
      );
    }
    return appointment;
  }

  private async findIntakeOrThrow(appointmentId: string): Promise<WorkshopIntake> {
    const intake = await this.intakeRepository.findOne({ where: { appointmentId } });
    if (!intake) {
      throw new NotFoundException(
        `This appointment has not been marked received yet. Use "Mark Received" first.`,
      );
    }
    return intake;
  }

  /**
   * "Mark Received" - logs who received the unit and when. Idempotent: calling this again
   * on an appointment that already has an intake row is a no-op that returns the existing
   * row unchanged (same idempotency discipline as every other transition endpoint in this
   * overhaul - see the spec doc section 2.2), so a double-tap or a re-opened intake screen
   * never overwrites the original receipt record.
   */
  async markReceived(appointmentId: string, callerId: string): Promise<WorkshopIntake> {
    await this.assertCollectedToWorkshop(appointmentId);

    const existing = await this.intakeRepository.findOne({ where: { appointmentId } });
    if (existing) {
      return existing;
    }

    const intake = this.intakeRepository.create({
      appointmentId,
      receivedByUserId: callerId,
      receivedAt: new Date(),
    });
    return this.intakeRepository.save(intake);
  }

  /**
   * Mirrors TechnicianService.captureSerialNumber - same automated Warranty Master lookup,
   * same re-capture-clears-fault/symptom rule (a re-typed S/N invalidates any fault/symptom
   * pair recorded against the previous one).
   */
  async captureSerialNumber(appointmentId: string, dto: CaptureSerialNumberDto): Promise<WorkshopIntake> {
    await this.assertCollectedToWorkshop(appointmentId);
    const intake = await this.findIntakeOrThrow(appointmentId);

    const warranty = await this.masterDataService.checkWarranty(dto.serialNumber, dto.brand);

    intake.serialNumber = dto.serialNumber;
    intake.brand = dto.brand ?? null;
    intake.warrantyStatus = warranty.isUnderWarranty ? WarrantyStatus.IN_WARRANTY : WarrantyStatus.OUT_OF_WARRANTY;
    intake.warrantySupplier = warranty.supplier;
    intake.warrantyPeriodMonths = warranty.warrantyPeriodMonths;
    intake.serialNumberCapturedAt = new Date();
    intake.faultCode = null;
    intake.symptomCode = null;
    intake.faultSymptomCapturedAt = null;

    return this.intakeRepository.save(intake);
  }

  /** Mirrors TechnicianService.captureFaultSymptom - gated on a validated S/N first. */
  async captureFaultSymptom(appointmentId: string, dto: CaptureFaultSymptomDto): Promise<WorkshopIntake> {
    await this.assertCollectedToWorkshop(appointmentId);
    const intake = await this.findIntakeOrThrow(appointmentId);

    if (!intake.serialNumber || !intake.warrantyStatus) {
      throw new BadRequestException('Capture and validate the serial number before recording fault/symptom codes');
    }

    await this.masterDataService.findFaultByCode(dto.faultCode);
    await this.masterDataService.findSymptomByCode(dto.symptomCode);

    intake.faultCode = dto.faultCode;
    intake.symptomCode = dto.symptomCode;
    intake.faultSymptomCapturedAt = new Date();

    return this.intakeRepository.save(intake);
  }

  /**
   * Returns null rather than throwing when no intake exists yet - "not marked received
   * yet" is an ordinary state for the workshop intake screen to render (a "Mark Received"
   * button), not an error, same convention as TechnicianService.getOwnJobCard()'s own
   * null-is-not-an-error precedent. JobCardsService.create() below is the one caller that
   * DOES want a thrown 404 for this state (there, "no intake" and "not implemented for this
   * appointment" are the same message) - it calls findIntakeOrThrow-equivalent logic
   * itself rather than reusing this method, to keep the two callers' error shapes distinct.
   */
  async getIntake(appointmentId: string): Promise<WorkshopIntake | null> {
    return this.intakeRepository.findOne({ where: { appointmentId } });
  }
}
