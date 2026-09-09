import { randomBytes } from 'crypto';
import { Injectable, Logger, BadRequestException, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { JobCard, JobCardStatus, JobCardSection } from './entities/job-card.entity';
import { JobCardTaskPause, TaskPauseReason } from './entities/job-card-task-pause.entity';
import { JobCardCrewHelper } from './entities/job-card-crew-helper.entity';
import { User } from '../auth/entities/user.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { getJobCardProgressFields, JobCardProgressFields } from './job-card-progress.util';
import { AppointmentsService } from '../appointments/appointments.service';
import { TechnicianService } from '../technician/technician.service';
import { CreateJobCardDto } from './dto/create-job-card.dto';
import { ValidateSnDto } from './dto/validate-sn.dto';
import { AssignSectionDto } from './dto/assign-section.dto';
import { WarrantyOverrideDto } from './dto/warranty-override.dto';
import { ApproveCustomerDto } from './dto/approve-customer.dto';
import { PauseTaskDto } from './dto/pause-task.dto';

// Statuses a task timer can be manually paused from. Deliberately includes
// SECTION_ASSIGNED (the only "work under way" status an ON_SITE_REPAIR job ever reaches -
// see the JobCardStatus enum's doc comment: on-site repair has no separate IN_PROGRESS at
// all, it skips straight to READY_FOR_QC) alongside the WORKSHOP sub-machine's own three
// statuses. Not READY_FOR_QC/QC_PASSED/DELIVERED/etc - work there is already done or the
// job hasn't started yet.
const PAUSABLE_STATUSES: ReadonlySet<JobCardStatus> = new Set([
  JobCardStatus.SECTION_ASSIGNED,
  JobCardStatus.WORKSHOP_ASSIGNED,
  JobCardStatus.IN_PROGRESS,
  JobCardStatus.SPARE_PENDING,
]);

@Injectable()
export class JobCardsService {
  private readonly logger = new Logger(JobCardsService.name);

  constructor(
    @InjectRepository(JobCard)
    private jobCardRepository: Repository<JobCard>,
    @InjectRepository(JobCardTaskPause)
    private taskPauseRepository: Repository<JobCardTaskPause>,
    @InjectRepository(JobCardCrewHelper)
    private crewHelperRepository: Repository<JobCardCrewHelper>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private appointmentsService: AppointmentsService,
    private technicianService: TechnicianService,
  ) {}

  // A helper only makes sense while the job is actively being worked in the workshop -
  // before WORKSHOP_ASSIGNED there's no primary technician yet to help, and READY_FOR_QC+
  // is already "work is done" (also covered by job-card-edit-lock.util.ts's late-stage
  // lock, but this check is what actually stops it - see that util's own doc comment on
  // why it's display-only, not enforcement).
  private static readonly CREW_HELPER_ELIGIBLE_STATUSES: ReadonlySet<JobCardStatus> = new Set([
    JobCardStatus.WORKSHOP_ASSIGNED,
    JobCardStatus.IN_PROGRESS,
    JobCardStatus.SPARE_PENDING,
  ]);

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

  // Return type carries the derived lane/nextStepText alongside the real entity fields -
  // see job-card-progress.util.ts for why these are attached here (plain-object spread)
  // rather than as entity getters. Purely additive: every existing consumer of this
  // response shape (web JobCardsPage, the public tracking view via findByPublicToken
  // below, etc.) keeps working unchanged since it just ignores the two new keys.
  async findById(id: string): Promise<JobCard & JobCardProgressFields> {
    const jobCard = await this.jobCardRepository.findOne({
      where: { id },
      relations: { appointment: true, createdBy: true, warrantyOverrideByUser: true },
    });
    if (!jobCard) {
      throw new NotFoundException(`Job Card ${id} not found`);
    }
    // Object.assign mutates the real JobCard instance in place (own-enumerable props,
    // so JSON.stringify picks them up) rather than spreading into a plain object -
    // several other services (e.g. DeliveryService) pass this exact return value into
    // manager.save(jobCard) later, and TypeORM's single-arg save() infers the target
    // entity from the object's constructor/prototype. A plain-object spread here would
    // silently lose that prototype and break those saves.
    return Object.assign(jobCard, getJobCardProgressFields(jobCard));
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

  async findByAppointmentId(appointmentId: string): Promise<JobCard & JobCardProgressFields> {
    const jobCard = await this.jobCardRepository.findOne({ where: { appointmentId } });
    if (!jobCard) {
      throw new NotFoundException(`No Job Card exists for appointment ${appointmentId}`);
    }
    // See findById() above for why this mutates in place instead of spreading.
    return Object.assign(jobCard, getJobCardProgressFields(jobCard));
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
      warrantySupplier: visit.warrantySupplier,
      createdById: userId,
      // Phase 8 Customer Portal: a read-only tracking link, live for this job's whole
      // lifecycle (see the entity's doc comment on why this differs from Estimate's
      // shorter-lived, explicitly-generated accessToken).
      publicToken: randomBytes(32).toString('hex'),
      publicTokenExpiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
    });

    const saved = await this.jobCardRepository.save(jobCard);

    // Business rule (2026-09-08): the appointment is fulfilled the instant a Job Card
    // exists for it - see AppointmentsService.completeFromJobCardCreation()'s doc comment
    // (and cancel()'s guard, the mirror-image rule this complements). Deliberately outside
    // any transaction and swallowed rather than awaited-and-thrown: a hiccup completing the
    // appointment must never take down a Job Card that was already successfully created and
    // already returned 201 in spirit - staff can still complete the appointment by hand via
    // the existing endpoint if this ever silently fails.
    try {
      await this.appointmentsService.completeFromJobCardCreation(dto.appointmentId, userId);
    } catch (err) {
      this.logger.warn(
        `Job Card ${saved.jobCardNumber} was created but auto-completing appointment ${dto.appointmentId} failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    return saved;
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

  /**
   * Technician Assignment Board (2026-09-09) - hand a WORKSHOP job off from its current
   * assignee to a different workshop technician, once past the initial assignment. Split
   * out from assignWorkshopTechnician() above rather than reused for it: that method's
   * whole guard is "must not be assigned yet"; this one's is the opposite ("must already
   * be assigned"), and the two shouldn't silently accept each other's precondition.
   *
   * Deliberately does NOT touch workshopAssignedAt - that timestamp means "workshop work
   * began at X" for turnaround-time purposes, not "the current assignee's start", so
   * resetting it on a mid-job handoff would understate how long the job has actually been
   * in the workshop. The reassignment itself is captured by the @Audit() interceptor on
   * WorkshopController's endpoint (old/new technicianId), not a dedicated column.
   *
   * The-fool pre-mortem finding (2026-09-09): if the incoming technician is currently
   * listed as an active crew helper on this same job, promoting them to primary and
   * leaving that helper row active would double-count them - two overlapping blocks for
   * the same person on the Gantt board, which the conflict detector would then flag as a
   * false double-booking. Soft-remove that row as part of the same operation.
   *
   * Reservation-custody (does the outgoing technician still physically hold a reserved
   * spare?) and late-stage edit-lock checks both happen in WorkshopService.reassign()
   * before this is ever called - same "every mutation goes through JobCardsService, cross-
   * module composition lives in WorkshopService" split as requestSpare()/addCrewHelper().
   */
  async reassignWorkshopTechnician(id: string, newTechnicianId: string, callerId: string): Promise<JobCard> {
    const jobCard = await this.findEntityById(id);

    if (jobCard.section !== JobCardSection.WORKSHOP || !jobCard.assignedWorkshopTechnicianId) {
      throw new BadRequestException(
        `Cannot reassign a workshop technician: Job Card has no current workshop assignment yet (current: status=${jobCard.status}, section=${jobCard.section}) - use assign-technician instead.`,
      );
    }
    if (
      ![JobCardStatus.WORKSHOP_ASSIGNED, JobCardStatus.IN_PROGRESS, JobCardStatus.SPARE_PENDING, JobCardStatus.READY_FOR_QC].includes(
        jobCard.status,
      )
    ) {
      throw new BadRequestException(`Cannot reassign a workshop technician from status ${jobCard.status}.`);
    }
    if (newTechnicianId === jobCard.assignedWorkshopTechnicianId) {
      throw new BadRequestException('This technician is already assigned to this Job Card.');
    }

    const activeHelperRow = await this.crewHelperRepository.findOne({
      where: { jobCardId: id, technicianId: newTechnicianId, removedAt: IsNull() },
    });
    if (activeHelperRow) {
      activeHelperRow.removedAt = new Date();
      activeHelperRow.removedByUserId = callerId;
      await this.crewHelperRepository.save(activeHelperRow);
    }

    jobCard.assignedWorkshopTechnicianId = newTechnicianId;
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

  /**
   * Called by WorkshopService when a spare request comes back short of stock. Also
   * auto-opens a MATERIAL_SHORTAGE task pause (unless one is already open, from either an
   * earlier auto-open or an unrelated manual pause - never stack a second concurrent
   * pause, see pauseTask()'s own "one open pause at a time" invariant) so the SLA Breach
   * report can finally exclude genuine wait-on-parts time.
   */
  async setSparePending(id: string): Promise<JobCard> {
    const jobCard = await this.findEntityById(id);

    if (jobCard.status !== JobCardStatus.IN_PROGRESS && jobCard.status !== JobCardStatus.SPARE_PENDING) {
      throw new BadRequestException(`Cannot mark SPARE_PENDING from status ${jobCard.status} (expected IN_PROGRESS).`);
    }

    const wasAlreadyPending = jobCard.status === JobCardStatus.SPARE_PENDING;
    jobCard.status = JobCardStatus.SPARE_PENDING;
    const saved = await this.jobCardRepository.save(jobCard);

    if (!wasAlreadyPending) {
      await this.autoOpenMaterialShortagePause(id);
    }
    return saved;
  }

  /**
   * Called by WorkshopService when a top-up request on a SPARE_PENDING job fully fills.
   * Mirrors setSparePending() above by auto-closing a system-opened MATERIAL_SHORTAGE
   * pause. Deliberately only closes an autoCreated one - a technician's own manual
   * MATERIAL_SHORTAGE pause (e.g. logged before a formal Need Spare request even existed)
   * is left for them to resume explicitly, so this never silently ends a pause the system
   * didn't itself open.
   */
  async resumeFromSparePending(id: string): Promise<JobCard> {
    const jobCard = await this.findEntityById(id);

    if (jobCard.status !== JobCardStatus.SPARE_PENDING) {
      return jobCard; // no-op if it wasn't waiting on parts - keeps the caller simple
    }

    jobCard.status = JobCardStatus.IN_PROGRESS;
    const saved = await this.jobCardRepository.save(jobCard);
    await this.autoCloseMaterialShortagePause(id);
    return saved;
  }

  private async autoOpenMaterialShortagePause(jobCardId: string): Promise<void> {
    const open = await this.taskPauseRepository.findOne({ where: { jobCardId, resumedAt: IsNull() } });
    if (open) {
      return;
    }
    const pause = this.taskPauseRepository.create({
      jobCardId,
      reason: TaskPauseReason.MATERIAL_SHORTAGE,
      notes: null,
      pausedByUserId: null,
      autoCreated: true,
    });
    await this.taskPauseRepository.save(pause);
  }

  private async autoCloseMaterialShortagePause(jobCardId: string): Promise<void> {
    const open = await this.taskPauseRepository.findOne({
      where: { jobCardId, resumedAt: IsNull(), reason: TaskPauseReason.MATERIAL_SHORTAGE, autoCreated: true },
    });
    if (!open) {
      return;
    }
    open.resumedAt = new Date();
    await this.taskPauseRepository.save(open);
  }

  // --- Task timer pause/resume (SLA-safe pausing) ------------------------------------
  // Ownership mirrors WorkshopService.assertOwnership(), extended to also allow the
  // appointment's assigned field technician - on-site repair jobs never get an
  // assignedWorkshopTechnicianId at all (see the JobCardStatus enum's doc comment), so
  // without this, an on-site job's own technician could never pause their own task.

  private async assertTaskPauseOwnership(jobCard: JobCard, callerId: string, isPrivilegedRole: boolean): Promise<void> {
    if (isPrivilegedRole) {
      return;
    }
    if (jobCard.assignedWorkshopTechnicianId === callerId) {
      return;
    }
    const appointment = await this.appointmentsService.findById(jobCard.appointmentId);
    if (appointment.technicianId === callerId) {
      return;
    }
    throw new ForbiddenException('You are not the technician assigned to this Job Card.');
  }

  /**
   * Manual pause. Blocked while another pause is already open on this job (409) - "one
   * open pause at a time" is a hard invariant, whether the existing one is manual or
   * system-auto-opened (see autoOpenMaterialShortagePause above).
   */
  async pauseTask(jobCardId: string, dto: PauseTaskDto, callerId: string, isPrivilegedRole: boolean): Promise<JobCardTaskPause> {
    const jobCard = await this.findEntityById(jobCardId);
    await this.assertTaskPauseOwnership(jobCard, callerId, isPrivilegedRole);

    if (!PAUSABLE_STATUSES.has(jobCard.status)) {
      throw new BadRequestException(
        `Cannot pause: Job Card is ${jobCard.status} (expected SECTION_ASSIGNED, WORKSHOP_ASSIGNED, IN_PROGRESS, or SPARE_PENDING).`,
      );
    }

    const open = await this.taskPauseRepository.findOne({ where: { jobCardId, resumedAt: IsNull() } });
    if (open) {
      throw new ConflictException(
        `This Job Card already has an open pause (reason ${open.reason}, started ${open.pausedAt.toISOString()}) - resume it first.`,
      );
    }

    const pause = this.taskPauseRepository.create({
      jobCardId,
      reason: dto.reason,
      notes: dto.notes ?? null,
      pausedByUserId: callerId,
      autoCreated: false,
    });
    return this.taskPauseRepository.save(pause);
  }

  /** Manual resume of whatever pause is currently open (manual or system-auto-opened). */
  async resumeTask(jobCardId: string, callerId: string, isPrivilegedRole: boolean): Promise<JobCardTaskPause> {
    const jobCard = await this.findEntityById(jobCardId);
    await this.assertTaskPauseOwnership(jobCard, callerId, isPrivilegedRole);

    const open = await this.taskPauseRepository.findOne({ where: { jobCardId, resumedAt: IsNull() } });
    if (!open) {
      throw new ConflictException('This Job Card has no open pause to resume.');
    }

    open.resumedAt = new Date();
    open.resumedByUserId = callerId;
    return this.taskPauseRepository.save(open);
  }

  /** Full pause history for a job, oldest first. No ownership gate - same as every other GET. */
  async getTaskPauses(jobCardId: string): Promise<JobCardTaskPause[]> {
    await this.findEntityById(jobCardId); // 404 if the Job Card itself doesn't exist
    return this.taskPauseRepository.find({ where: { jobCardId }, order: { pausedAt: 'ASC' } });
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

  /**
   * Gantt board's "add crew helper" action (2026-09-09). Adds an extra technician on top
   * of the job's single `assignedWorkshopTechnicianId`, without displacing them - see
   * JobCardCrewHelper's own doc comment for why this is a separate table rather than a
   * second FK column.
   */
  async addCrewHelper(jobCardId: string, technicianId: string, addedByUserId: string): Promise<JobCardCrewHelper> {
    const jobCard = await this.findEntityById(jobCardId);

    if (jobCard.section !== JobCardSection.WORKSHOP) {
      throw new BadRequestException('Crew helpers can only be added to WORKSHOP-section Job Cards.');
    }
    if (!JobCardsService.CREW_HELPER_ELIGIBLE_STATUSES.has(jobCard.status)) {
      throw new BadRequestException(
        `Cannot add a crew helper: Job Card must be actively assigned/in progress (current: ${jobCard.status}).`,
      );
    }

    const technician = await this.userRepository.findOne({ where: { id: technicianId }, relations: { role: true } });
    if (!technician) {
      throw new NotFoundException(`Technician ${technicianId} not found.`);
    }
    if (technician.role.name !== 'TECHNICIAN_WORKSHOP') {
      throw new BadRequestException('A crew helper must hold the TECHNICIAN_WORKSHOP role.');
    }
    if (technicianId === jobCard.assignedWorkshopTechnicianId) {
      throw new BadRequestException('This technician is already the primary assignee on this Job Card.');
    }

    const existingActive = await this.crewHelperRepository.findOne({
      where: { jobCardId, technicianId, removedAt: IsNull() },
    });
    if (existingActive) {
      throw new ConflictException('This technician is already an active crew helper on this Job Card.');
    }

    const helper = this.crewHelperRepository.create({ jobCardId, technicianId, addedByUserId });
    return this.crewHelperRepository.save(helper);
  }

  /** Soft-removal (see JobCardCrewHelper's doc comment) - kept as a row so the Journey
   * page/audit trail can still show who helped on this job and for how long. */
  async removeCrewHelper(jobCardId: string, helperId: string, removedByUserId: string): Promise<JobCardCrewHelper> {
    const helper = await this.crewHelperRepository.findOne({ where: { id: helperId, jobCardId } });
    if (!helper) {
      throw new NotFoundException(`Crew helper ${helperId} not found on Job Card ${jobCardId}.`);
    }
    if (helper.removedAt) {
      throw new BadRequestException('This crew helper has already been removed from this Job Card.');
    }

    helper.removedAt = new Date();
    helper.removedByUserId = removedByUserId;
    return this.crewHelperRepository.save(helper);
  }

  /** Active (not-yet-removed) crew helpers on a Job Card, technician relation loaded for
   * display (name, role) rather than making every caller do a second lookup. */
  async listCrewHelpers(jobCardId: string): Promise<JobCardCrewHelper[]> {
    return this.crewHelperRepository.find({
      where: { jobCardId, removedAt: IsNull() },
      relations: { technician: true },
      order: { addedAt: 'ASC' },
    });
  }

  /**
   * Gantt board (2026-09-09): every WORKSHOP-section Job Card whose workshop-occupancy
   * window overlaps [dayStart, dayEnd) - assigned before the day ends, and either still
   * unfinished (qcApprovedAt IS NULL - open-ended, still occupying the technician) or
   * finished on/after the day starts. Deliberately a fresh query rather than reusing
   * `findAll`-style filters (there is no general list-all for Job Cards - see this
   * class's own "no list-all, paste an id" precedent elsewhere in this codebase) since
   * this is the first caller that ever needs "every Job Card active on a given day".
   */
  async findWorkshopScheduleForDate(dayStart: Date, dayEnd: Date): Promise<JobCard[]> {
    return this.jobCardRepository
      .createQueryBuilder('jc')
      .where('jc.assignedWorkshopTechnicianId IS NOT NULL')
      .andWhere('jc.workshopAssignedAt <= :dayEnd', { dayEnd })
      .andWhere('(jc.qcApprovedAt IS NULL OR jc.qcApprovedAt >= :dayStart)', { dayStart })
      .getMany();
  }

  /** Same overlap logic as findWorkshopScheduleForDate, for crew helper rows instead of
   * the primary assignment - addedAt/removedAt stand in for workshopAssignedAt/
   * qcApprovedAt. jobCard relation loaded for its number/status/qcApprovedAt (a helper's
   * block ends when the job itself does, same as the primary assignee's). */
  async findCrewHelpersForDate(dayStart: Date, dayEnd: Date): Promise<JobCardCrewHelper[]> {
    return this.crewHelperRepository
      .createQueryBuilder('helper')
      .leftJoinAndSelect('helper.jobCard', 'jc')
      .where('helper.addedAt <= :dayEnd', { dayEnd })
      .andWhere('(helper.removedAt IS NULL OR helper.removedAt >= :dayStart)', { dayStart })
      .getMany();
  }

  /**
   * Technician Assignment Board (2026-09-09): every WORKSHOP-section Job Card that's
   * reached SECTION_ASSIGNED but still has no workshop technician - the "unassigned" pool
   * the board's click-to-assign panel offers. No date scoping (unlike
   * findWorkshopScheduleForDate above) - a Job Card has no scheduled date the way an
   * Appointment does, so "needs a technician" is a standing list, not a per-day one.
   */
  async findUnassignedWorkshopJobs(): Promise<JobCard[]> {
    return this.jobCardRepository.find({
      where: {
        status: JobCardStatus.SECTION_ASSIGNED,
        section: JobCardSection.WORKSHOP,
        assignedWorkshopTechnicianId: IsNull(),
      },
      order: { createdAt: 'ASC' },
    });
  }
}
