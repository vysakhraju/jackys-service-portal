import { randomBytes } from 'crypto';
import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { JobCard, JobCardStatus, JobCardSection } from './entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { AppointmentsService } from '../appointments/appointments.service';
import { TechnicianService } from '../technician/technician.service';
import { CreateJobCardDto } from './dto/create-job-card.dto';
import { ValidateSnDto } from './dto/validate-sn.dto';
import { AssignSectionDto } from './dto/assign-section.dto';
import { WarrantyOverrideDto } from './dto/warranty-override.dto';
import { ApproveCustomerDto } from './dto/approve-customer.dto';

@Injectable()
export class JobCardsService {
  constructor(
    @InjectRepository(JobCard)
    private jobCardRepository: Repository<JobCard>,
    private appointmentsService: AppointmentsService,
    private technicianService: TechnicianService,
  ) {}

  private async generateJobCardNumber(): Promise<string> {
    const prefix = 'JC-';
    const last = await this.jobCardRepository
      .createQueryBuilder('jc')
      .where('jc.jobCardNumber LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('jc.jobCardNumber', 'DESC')
      .getOne();

    let sequence = 1;
    if (last) {
      sequence = parseInt(last.jobCardNumber.replace(prefix, ''), 10) + 1;
    }
    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }

  async findById(id: string): Promise<JobCard> {
    const jobCard = await this.jobCardRepository.findOne({
      where: { id },
      relations: { appointment: true, createdBy: true, warrantyOverrideByUser: true },
    });
    if (!jobCard) {
      throw new NotFoundException(`Job Card ${id} not found`);
    }
    return jobCard;
  }

  /**
   * Lean lookup (no relations) for internal use by the mutation methods below.
   *
   * TypeORM footgun: when an entity is loaded WITH a @ManyToOne relation eagerly
   * populated (e.g. `warrantyOverrideByUser`) and you then set the raw FK column
   * directly (`warrantyOverrideBy = userId`) without also updating the relation object,
   * `repository.save()` still writes the correct FK to the database - but the in-memory
   * object it returns gets the FK column reset to match the stale relation, so the API
   * response looks wrong even though the DB is correct. Loading without relations here
   * avoids that trap entirely for update flows; findById() (with relations) stays for the
   * read-only GET endpoints where nothing gets mutated afterwards.
   */
  private async findEntityById(id: string): Promise<JobCard> {
    const jobCard = await this.jobCardRepository.findOne({ where: { id } });
    if (!jobCard) {
      throw new NotFoundException(`Job Card ${id} not found`);
    }
    return jobCard;
  }

  /**
   * Phase 8 Customer Portal: look up a Job Card by its public tracking token (no login).
   * Returns null (not a thrown 404) on an unknown or expired token - the controller
   * decides how to shape that into a customer-safe response, exactly mirroring how
   * EstimatesService.getPublicView() treats an unknown/expired accessToken.
   */
  async findByPublicToken(token: string): Promise<JobCard | null> {
    const jobCard = await this.jobCardRepository.findOne({
      where: { publicToken: token },
      relations: { appointment: true },
    });
    if (!jobCard) {
      return null;
    }
    if (jobCard.publicTokenExpiresAt && jobCard.publicTokenExpiresAt.getTime() < Date.now()) {
      return null;
    }
    return jobCard;
  }

  async findByAppointmentId(appointmentId: string): Promise<JobCard> {
    const jobCard = await this.jobCardRepository.findOne({ where: { appointmentId } });
    if (!jobCard) {
      throw new NotFoundException(`No Job Card exists for appointment ${appointmentId}`);
    }
    return jobCard;
  }

  // --- Phase 7: Delivery lookups --------------------------------------------------
  // Plain reads only - DeliveryService.create()/capturePod() reach past this into the
  // JobCard entity directly via a transactional EntityManager for the actual atomic
  // claim/release mutations (same "one shared transaction, not delegated service calls"
  // discipline InventoryService.consumeReservationsOnQcApproval() established in Phase 6).

  /** QC_PASSED jobs not yet attached to a Delivery - the ready-for-delivery pool. */
  async findReadyForDelivery(warrantyStatus?: WarrantyStatus): Promise<JobCard[]> {
    return this.jobCardRepository.find({
      where: {
        status: JobCardStatus.QC_PASSED,
        deliveryId: IsNull(),
        ...(warrantyStatus ? { warrantyStatus } : {}),
      },
      order: { updatedAt: 'ASC' },
    });
  }

  async findByDeliveryId(deliveryId: string): Promise<JobCard[]> {
    return this.jobCardRepository.find({ where: { deliveryId } });
  }

  /**
   * Gate 1 (FR-05, AC-05): "no Job Card without invoice verification." Creation is
   * blocked unless the field visit is fully captured (S/N + warranty + fault/symptom)
   * AND the appointment already has an invoice number on file. The actual human
   * S/N-vs-physical-invoice match check is a separate, explicit step (validateSn below) -
   * this gate only proves the prerequisite data exists, it doesn't itself confirm a match.
   */
  async create(dto: CreateJobCardDto, userId: string): Promise<JobCard> {
    const appointment = await this.appointmentsService.findById(dto.appointmentId);

    const existing = await this.jobCardRepository.findOne({ where: { appointmentId: dto.appointmentId } });
    if (existing) {
      throw new ConflictException(`A Job Card already exists for appointment ${dto.appointmentId}`);
    }

    if (!appointment.invoiceNumber) {
      throw new BadRequestException(
        'Cannot create a Job Card: the appointment has no invoice number on file (FR-05).',
      );
    }

    const visit = await this.technicianService.getVisit(dto.appointmentId);
    if (!visit.serialNumber || !visit.warrantyStatus || !visit.faultCode || !visit.symptomCode) {
      throw new BadRequestException(
        'Cannot create a Job Card: the field visit is not complete yet (serial number, warranty check, ' +
          'and fault/symptom must all be captured by the technician first).',
      );
    }

    const jobCardNumber = await this.generateJobCardNumber();

    const jobCard = this.jobCardRepository.create({
      jobCardNumber,
      appointmentId: dto.appointmentId,
      status: JobCardStatus.OPEN,
      serialNumber: visit.serialNumber,
      brand: visit.brand,
      faultCode: visit.faultCode,
      symptomCode: visit.symptomCode,
      originalWarrantyStatus: visit.warrantyStatus,
      warrantyStatus: visit.warrantyStatus,
      createdById: userId,
      // Phase 8 Customer Portal: a read-only tracking link, live for this job's whole
      // lifecycle (see the entity's doc comment on why this differs from Estimate's
      // shorter-lived, explicitly-generated accessToken).
      publicToken: randomBytes(32).toString('hex'),
      publicTokenExpiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
    });

    return this.jobCardRepository.save(jobCard);
  }

  /**
   * Gate 2: human confirmation that the captured S/N matches the physical invoice.
   * Only allowed while still OPEN - once a Job Card has moved past this gate
   * (SN_VALIDATED/SECTION_ASSIGNED) it can't be silently re-validated to paper over a
   * mismatch after work may already be under way.
   */
  async validateSn(id: string, dto: ValidateSnDto): Promise<JobCard> {
    const jobCard = await this.findEntityById(id);

    if (jobCard.status !== JobCardStatus.OPEN) {
      throw new BadRequestException(
        `Serial number validation can only be performed while the Job Card is OPEN (current status: ${jobCard.status}).`,
      );
    }

    jobCard.snValidatedAgainstInvoice = dto.matches;
    jobCard.snValidationNotes = dto.notes ?? null;
    if (dto.matches) {
      jobCard.status = JobCardStatus.SN_VALIDATED;
    }

    return this.jobCardRepository.save(jobCard);
  }

  /**
   * Gate 3: assigning a section is the point work actually starts, so both the S/N
   * validation and (for OOW jobs) customer approval must already be in place - this is
   * the real enforcement point for "work can't start without a genuine check."
   */
  async assignSection(id: string, dto: AssignSectionDto): Promise<JobCard> {
    const jobCard = await this.findEntityById(id);

    if (jobCard.status !== JobCardStatus.SN_VALIDATED) {
      throw new BadRequestException(
        'Serial number must be validated against the invoice (and matched) before a section can be assigned.',
      );
    }

    if (jobCard.warrantyStatus === WarrantyStatus.OUT_OF_WARRANTY && !jobCard.customerApproved) {
      throw new BadRequestException(
        'Customer approval is required for out-of-warranty jobs before work can start (FR-06).',
      );
    }

    jobCard.section = dto.section;
    jobCard.status = JobCardStatus.SECTION_ASSIGNED;

    return this.jobCardRepository.save(jobCard);
  }

  /**
   * FR-06 stopgap: manual customer-approval flag until the real shareable-link/Estimate
   * approval flow exists (a later phase). Restricted to CCE/TL/above at the controller.
   */
  async approveCustomer(id: string, dto: ApproveCustomerDto): Promise<JobCard> {
    const jobCard = await this.findEntityById(id);

    jobCard.customerApproved = true;
    jobCard.customerApprovalNotes = dto.notes ?? null;

    return this.jobCardRepository.save(jobCard);
  }

  /**
   * FR-17/AC-18: Warranty Override. TL-only (enforced via @Roles at the controller).
   * - Requires a reason (DTO validation).
   * - Can be called more than once; overrideCount tracks how many times, and each call
   *   also writes a WARRANTY_OVERRIDE AuditLog row (see controller) so the full history
   *   is preserved even though this entity only carries the *latest* override's details.
   * - If the override flips the effective status to OOW after the Job Card already has
   *   customerApproved=true (e.g. it was approved while still IW, no approval needed),
   *   that approval is reset - it covered different terms and can't be trusted to still
   *   apply. A subsequent assign-section call would then correctly re-require approval.
   */
  async warrantyOverride(id: string, dto: WarrantyOverrideDto, userId: string): Promise<{ jobCard: JobCard; previousStatus: WarrantyStatus }> {
    const jobCard = await this.findEntityById(id);

    if (jobCard.status === JobCardStatus.RWR || jobCard.status === JobCardStatus.CANCELLED) {
      throw new BadRequestException(
        `Cannot override warranty while the Job Card is ${jobCard.status} (FR-08: further work is blocked until it's revived).`,
      );
    }

    if (jobCard.warrantyStatus === dto.newStatus) {
      throw new BadRequestException(`Job Card is already ${dto.newStatus} - nothing to override.`);
    }

    const previousStatus = jobCard.warrantyStatus;

    jobCard.warrantyStatus = dto.newStatus;
    jobCard.warrantyOverridden = true;
    jobCard.warrantyOverrideReason = dto.reason;
    jobCard.warrantyOverrideBy = userId;
    jobCard.warrantyOverrideAt = new Date();
    jobCard.overrideCount += 1;

    if (dto.newStatus === WarrantyStatus.OUT_OF_WARRANTY) {
      jobCard.customerApproved = false;
      jobCard.customerApprovalNotes = null;
    }

    const saved = await this.jobCardRepository.save(jobCard);
    return { jobCard: saved, previousStatus };
  }

  /**
   * FR-08: called by EstimatesService when a customer (or staff on their behalf) rejects
   * an OOW Estimate. Only valid from SN_VALIDATED - that's the only status an active
   * Estimate can exist against (Estimates.create() requires OOW + SN_VALIDATED), so this
   * intentionally doesn't accept OPEN/SECTION_ASSIGNED/CANCELLED/already-RWR.
   */
  async setToRwr(id: string): Promise<JobCard> {
    const jobCard = await this.findEntityById(id);

    if (jobCard.status !== JobCardStatus.SN_VALIDATED) {
      throw new BadRequestException(
        `Cannot move Job Card to RWR from status ${jobCard.status} (expected SN_VALIDATED).`,
      );
    }

    jobCard.status = JobCardStatus.RWR;
    return this.jobCardRepository.save(jobCard);
  }

  /**
   * Called by EstimatesService.revise() once a new Estimate has been drafted to replace a
   * rejected one - moves the Job Card back to SN_VALIDATED so assign-section can be
   * reached again once the revised Estimate is approved. Not a generic "unblock" - only
   * valid from RWR.
   */
  async reviveFromRwr(id: string): Promise<JobCard> {
    const jobCard = await this.findEntityById(id);

    if (jobCard.status !== JobCardStatus.RWR) {
      throw new BadRequestException(`Cannot revive Job Card from status ${jobCard.status} (expected RWR).`);
    }

    jobCard.status = JobCardStatus.SN_VALIDATED;
    return this.jobCardRepository.save(jobCard);
  }

  // --- Phase 5: Workshop transitions -----------------------------------------------
  // These mirror the same "own repository, guard, save" pattern as the gates above.
  // WorkshopService orchestrates calls into these plus InventoryService - it doesn't
  // touch the JobCard repository directly, so every valid transition stays in one place.

  async assignWorkshopTechnician(id: string, technicianId: string): Promise<JobCard> {
    const jobCard = await this.findEntityById(id);

    if (jobCard.status !== JobCardStatus.SECTION_ASSIGNED || jobCard.section !== JobCardSection.WORKSHOP) {
      throw new BadRequestException(
        `Cannot assign a workshop technician: Job Card must be SECTION_ASSIGNED with section=WORKSHOP (current: status=${jobCard.status}, section=${jobCard.section}).`,
      );
    }

    jobCard.assignedWorkshopTechnicianId = technicianId;
    jobCard.workshopAssignedAt = new Date();
    jobCard.status = JobCardStatus.WORKSHOP_ASSIGNED;
    return this.jobCardRepository.save(jobCard);
  }

  async startWip(id: string): Promise<JobCard> {
    const jobCard = await this.findEntityById(id);

    if (jobCard.status !== JobCardStatus.WORKSHOP_ASSIGNED) {
      throw new BadRequestException(`Cannot start WIP from status ${jobCard.status} (expected WORKSHOP_ASSIGNED).`);
    }

    jobCard.status = JobCardStatus.IN_PROGRESS;
    return this.jobCardRepository.save(jobCard);
  }

  /** Called by WorkshopService when a spare request comes back short of stock. */
  async setSparePending(id: string): Promise<JobCard> {
    const jobCard = await this.findEntityById(id);

    if (jobCard.status !== JobCardStatus.IN_PROGRESS && jobCard.status !== JobCardStatus.SPARE_PENDING) {
      throw new BadRequestException(`Cannot mark SPARE_PENDING from status ${jobCard.status} (expected IN_PROGRESS).`);
    }

    jobCard.status = JobCardStatus.SPARE_PENDING;
    return this.jobCardRepository.save(jobCard);
  }

  /** Called by WorkshopService when a top-up request on a SPARE_PENDING job fully fills. */
  async resumeFromSparePending(id: string): Promise<JobCard> {
    const jobCard = await this.findEntityById(id);

    if (jobCard.status !== JobCardStatus.SPARE_PENDING) {
      return jobCard; // no-op if it wasn't waiting on parts - keeps the caller simple
    }

    jobCard.status = JobCardStatus.IN_PROGRESS;
    return this.jobCardRepository.save(jobCard);
  }

  async completeWorkshop(id: string): Promise<JobCard> {
    const jobCard = await this.findEntityById(id);

    if (jobCard.status !== JobCardStatus.IN_PROGRESS) {
      throw new BadRequestException(
        `Cannot complete: Job Card is ${jobCard.status} (expected IN_PROGRESS - a SPARE_PENDING job can't be marked complete while still waiting on parts).`,
      );
    }

    jobCard.status = JobCardStatus.READY_FOR_QC;
    return this.jobCardRepository.save(jobCard);
  }

  /**
   * Cancellation is deliberately unaware of Inventory - it's a pure entity transition.
   * Reservation cleanup (moving any active reservations to RETURN_PENDING) is
   * orchestrated by the caller (JobCardsController), which also has InventoryService.
   */
  async cancel(id: string, reason: string): Promise<JobCard> {
    const jobCard = await this.findEntityById(id);

    if (jobCard.status === JobCardStatus.CANCELLED) {
      throw new BadRequestException('Job Card is already cancelled.');
    }
    if (jobCard.status === JobCardStatus.READY_FOR_QC) {
      throw new BadRequestException('Cannot cancel a Job Card that is already READY_FOR_QC.');
    }
    // Phase 7: closes a gap Delivery's existence newly makes reachable - QC_PASSED means
    // stock has already been permanently consumed (Main Store -> Damage Location, Phase
    // 6), and DELIVERED means the unit is back with the customer. Neither has a
    // compensating stock/delivery-reversal path, so cancelling from here would silently
    // strand consumed stock (or an already-handed-back unit) with no record of it.
    if (jobCard.status === JobCardStatus.QC_PASSED) {
      throw new BadRequestException('Cannot cancel a Job Card that is QC_PASSED - stock has already been permanently consumed.');
    }
    if (jobCard.status === JobCardStatus.DELIVERED) {
      throw new BadRequestException('Cannot cancel a Job Card that has already been DELIVERED.');
    }

    jobCard.status = JobCardStatus.CANCELLED;
    jobCard.cancellationReason = reason;
    return this.jobCardRepository.save(jobCard);
  }

  // --- Phase 6: QC gate --------------------------------------------------------------
  // qcApprove is NOT here - it lives in InventoryService.consumeReservationsOnQcApproval()
  // because approval must atomically consume reserved stock in the same transaction as
  // the status transition (unlike cancel() above, this one can't be split across two
  // separate calls - see that method's doc comment). qcReject stays here because a
  // rejection never touches stock (nothing was ever consumed before QC passes) - it's a
  // pure entity transition, same shape as every other gate in this file.

  /**
   * QC officer (or whoever holds the QC_APPROVAL grant - enforced at the controller via
   * PermissionsService) rejects the finished work. Sends the job back to the workshop to
   * be fixed properly (FR: "If they reject it, it goes back to the workshop"). Can happen
   * more than once - qcRejectionCount tracks how many times, mirroring the
   * warrantyOverride "latest snapshot + full history via @Audit()" pattern above.
   */
  async qcReject(id: string, reason: string): Promise<JobCard> {
    const jobCard = await this.findEntityById(id);

    if (jobCard.status !== JobCardStatus.READY_FOR_QC) {
      throw new BadRequestException(
        `Cannot QC-reject a Job Card that is ${jobCard.status}, not READY_FOR_QC.`,
      );
    }

    jobCard.status = JobCardStatus.IN_PROGRESS;
    jobCard.qcRejectionCount += 1;
    jobCard.lastQcRejectedAt = new Date();
    jobCard.lastQcRejectionReason = reason;

    return this.jobCardRepository.save(jobCard);
  }
}
