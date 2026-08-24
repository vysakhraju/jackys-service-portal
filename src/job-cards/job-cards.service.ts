import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobCard, JobCardStatus } from './entities/job-card.entity';
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

  async findByAppointmentId(appointmentId: string): Promise<JobCard> {
    const jobCard = await this.jobCardRepository.findOne({ where: { appointmentId } });
    if (!jobCard) {
      throw new NotFoundException(`No Job Card exists for appointment ${appointmentId}`);
    }
    return jobCard;
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
}
