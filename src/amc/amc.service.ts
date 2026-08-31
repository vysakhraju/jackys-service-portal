import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import {
  AmcContract,
  AmcContractStatus,
  VisitFrequency,
  AmcPaymentTerms,
} from './entities/amc-contract.entity';
import { AmcVisitCompletion } from './entities/amc-visit-completion.entity';
import { AmcBillingInvoice, AmcBillingStatus } from './entities/amc-billing-invoice.entity';
import { Appointment, AppointmentStatus, AppointmentType, CustomerType } from '../appointments/entities/appointment.entity';
import { ServiceCentre } from '../master-data/entities/service-centre.entity';
import { Estimate, EstimateStatus } from '../estimates/entities/estimate.entity';
import { PaymentMethod } from '../invoicing/entities/invoice.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationTrigger, NotificationChannel } from '../master-data/entities/notification-template.entity';
import { CreateAmcContractDto } from './dto/create-amc-contract.dto';
import { RenewAmcContractDto } from './dto/renew-amc-contract.dto';
import { CompleteAmcVisitDto } from './dto/complete-amc-visit.dto';

// Defensive sanity cap on how many PM-visit Appointment rows a single contract (or
// renewal) can auto-generate - not a business rule, just a guard against a mistakenly
// huge date range / too-frequent schedule silently creating hundreds of rows.
const MAX_GENERATED_VISITS = 60;

@Injectable()
export class AmcService {
  constructor(
    @InjectRepository(AmcContract) private amcContractRepository: Repository<AmcContract>,
    @InjectRepository(AmcVisitCompletion) private visitCompletionRepository: Repository<AmcVisitCompletion>,
    @InjectRepository(AmcBillingInvoice) private billingInvoiceRepository: Repository<AmcBillingInvoice>,
    @InjectRepository(Appointment) private appointmentRepository: Repository<Appointment>,
    @InjectRepository(ServiceCentre) private serviceCentreRepository: Repository<ServiceCentre>,
    @InjectRepository(Estimate) private estimateRepository: Repository<Estimate>,
    private notificationsService: NotificationsService,
  ) {}

  private async generateContractNumber(): Promise<string> {
    const prefix = 'AMC-';
    const last = await this.amcContractRepository
      .createQueryBuilder('c')
      .where('c.contractNumber LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('c.contractNumber', 'DESC')
      .getOne();
    let sequence = 1;
    if (last) sequence = parseInt(last.contractNumber.replace(prefix, ''), 10) + 1;
    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }

  private async generateAmcInvoiceNumber(): Promise<string> {
    const prefix = 'AMCINV-';
    const last = await this.billingInvoiceRepository
      .createQueryBuilder('i')
      .where('i.invoiceNumber LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('i.invoiceNumber', 'DESC')
      .getOne();
    let sequence = 1;
    if (last) sequence = parseInt(last.invoiceNumber.replace(prefix, ''), 10) + 1;
    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }

  // Mirrors AppointmentsService.generateAppointmentNumber() exactly (APT-YYYYMMDD-####).
  // Duplicated here rather than called via AppointmentsService because that method is
  // private and its owning service's create() carries the capacity-check gate being
  // deliberately bypassed for AMC-generated visits (see class doc comment on AmcContract).
  private async generateAppointmentNumber(): Promise<string> {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `APT-${dateStr}-`;
    const last = await this.appointmentRepository
      .createQueryBuilder('apt')
      .where('apt.appointmentNumber LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('apt.appointmentNumber', 'DESC')
      .getOne();
    let sequence = 1;
    if (last) sequence = parseInt(last.appointmentNumber.replace(prefix, ''), 10) + 1;
    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }

  private intervalMonthsFor(frequency: VisitFrequency): number {
    switch (frequency) {
      case VisitFrequency.MONTHLY:
        return 1;
      case VisitFrequency.QUARTERLY:
        return 3;
      case VisitFrequency.HALF_YEARLY:
        return 6;
      default:
        return 3;
    }
  }

  private installmentsFor(terms: AmcPaymentTerms): number {
    switch (terms) {
      case AmcPaymentTerms.FULL_UPFRONT:
        return 1;
      case AmcPaymentTerms.HALF_YEARLY:
        return 2;
      case AmcPaymentTerms.QUARTERLY:
        return 4;
      default:
        return 1;
    }
  }

  private buildVisitDates(startDate: Date, endDate: Date, frequency: VisitFrequency): Date[] {
    const months = this.intervalMonthsFor(frequency);
    const dates: Date[] = [];
    let cursor = new Date(startDate);
    while (cursor <= endDate) {
      dates.push(new Date(cursor));
      const next = new Date(cursor);
      next.setMonth(next.getMonth() + months);
      cursor = next;
    }
    return dates;
  }

  async createContract(dto: CreateAmcContractDto, userId: string): Promise<AmcContract> {
    const serviceCentre = await this.serviceCentreRepository.findOne({
      where: { id: dto.serviceCentreId, isActive: true },
    });
    if (!serviceCentre) {
      throw new NotFoundException('Service centre not found or inactive');
    }

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate <= startDate) {
      throw new BadRequestException('endDate must be after startDate');
    }

    const visitDates = this.buildVisitDates(startDate, endDate, dto.visitFrequency);
    if (visitDates.length > MAX_GENERATED_VISITS) {
      throw new BadRequestException(
        `This contract's date range and frequency would generate ${visitDates.length} PM visits, above the ${MAX_GENERATED_VISITS}-visit safety cap - shorten the contract term or use a lower-frequency visit schedule.`,
      );
    }

    const contractNumber = await this.generateContractNumber();

    const contract = this.amcContractRepository.create({
      customerName: dto.customerName,
      customerPhone: dto.customerPhone,
      customerEmail: dto.customerEmail,
      customerAddress: dto.customerAddress,
      customerType: dto.customerType,
      serviceCentreId: dto.serviceCentreId,
      coveredSerialNumbers: dto.coveredSerialNumbers,
      brand: dto.brand,
      modelNumber: dto.modelNumber,
      coverageType: dto.coverageType,
      serviceLevel: dto.serviceLevel,
      visitFrequency: dto.visitFrequency,
      startDate,
      endDate,
      totalAmount: dto.totalAmount,
      paymentTerms: dto.paymentTerms,
      assignedTechnicianId: dto.assignedTechnicianId,
      contractNumber,
      status: AmcContractStatus.ACTIVE,
      createdById: userId,
    });
    const saved = await this.amcContractRepository.save(contract);

    await this.generateVisitSchedule(saved, visitDates);

    return this.findById(saved.id);
  }

  private async generateVisitSchedule(contract: AmcContract, visitDates: Date[]): Promise<void> {
    for (const scheduledAt of visitDates) {
      const appointmentNumber = await this.generateAppointmentNumber();
      const appointment = this.appointmentRepository.create({
        appointmentNumber,
        type: AppointmentType.AMC,
        status: AppointmentStatus.SCHEDULED,
        customerType: contract.customerType,
        customerName: contract.customerName,
        customerPhone: contract.customerPhone,
        customerEmail: contract.customerEmail,
        customerAddress: contract.customerAddress,
        brand: contract.brand,
        modelNumber: contract.modelNumber,
        scheduledAt,
        serviceCentreId: contract.serviceCentreId,
        technicianId: contract.assignedTechnicianId ?? undefined,
        createdById: contract.createdById,
        amcContractId: contract.id,
        notes: `AMC PM visit for contract ${contract.contractNumber}`,
      });
      await this.appointmentRepository.save(appointment);
    }
  }

  async findById(id: string): Promise<AmcContract> {
    const contract = await this.amcContractRepository.findOne({ where: { id } });
    if (!contract) {
      throw new NotFoundException(`AMC contract ${id} not found`);
    }
    return contract;
  }

  async findByContractNumber(contractNumber: string): Promise<AmcContract> {
    const contract = await this.amcContractRepository.findOne({ where: { contractNumber } });
    if (!contract) {
      throw new NotFoundException(`AMC contract ${contractNumber} not found`);
    }
    return contract;
  }

  async findAll(status?: AmcContractStatus): Promise<AmcContract[]> {
    return this.amcContractRepository.find({
      where: status ? { status } : {},
      order: { createdAt: 'DESC' },
    });
  }

  async getSchedule(contractId: string): Promise<Appointment[]> {
    await this.findById(contractId);
    return this.appointmentRepository.find({
      where: { amcContractId: contractId },
      order: { scheduledAt: 'ASC' },
    });
  }

  async completeVisit(appointmentId: string, dto: CompleteAmcVisitDto, userId: string): Promise<AmcVisitCompletion> {
    const appointment = await this.appointmentRepository.findOne({ where: { id: appointmentId } });
    if (!appointment) {
      throw new NotFoundException(`Appointment ${appointmentId} not found`);
    }
    if (appointment.type !== AppointmentType.AMC || !appointment.amcContractId) {
      throw new BadRequestException('This appointment is not an AMC PM visit');
    }
    if ([AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED].includes(appointment.status)) {
      throw new BadRequestException(`This visit has already been ${appointment.status.toLowerCase()}`);
    }
    if (dto.extraChargeAmount && !dto.extraChargeApprovedByCustomer) {
      throw new BadRequestException(
        'An extra charge cannot be recorded without extraChargeApprovedByCustomer=true - AMC coverage is pre-paid, nothing extra is billed without the customer explicitly approving it on the spot.',
      );
    }

    const existing = await this.visitCompletionRepository.findOne({ where: { appointmentId } });
    if (existing) {
      throw new BadRequestException('This visit has already been completed');
    }

    const scheduleForContract = await this.getSchedule(appointment.amcContractId);
    const position = scheduleForContract.findIndex((a) => a.id === appointmentId) + 1;

    const completion = this.visitCompletionRepository.create({
      amcContractId: appointment.amcContractId,
      appointmentId,
      visitNumber: position || scheduleForContract.length,
      checklistNotes: dto.checklistNotes ?? null,
      customerSignatureBase64: dto.customerSignatureBase64 ?? null,
      extraChargeDescription: dto.extraChargeDescription ?? null,
      extraChargeAmount: dto.extraChargeAmount ?? null,
      extraChargeApprovedByCustomer: !!dto.extraChargeApprovedByCustomer,
      completedByUserId: userId,
    });
    const saved = await this.visitCompletionRepository.save(completion);

    appointment.status = AppointmentStatus.COMPLETED;
    appointment.actualEndAt = new Date();
    await this.appointmentRepository.save(appointment);

    return saved;
  }

  async getVisitCompletion(appointmentId: string): Promise<AmcVisitCompletion> {
    const completion = await this.visitCompletionRepository.findOne({ where: { appointmentId } });
    if (!completion) {
      throw new NotFoundException('This visit has not been completed yet');
    }
    return completion;
  }

  async renewContract(contractId: string, dto: RenewAmcContractDto, userId: string): Promise<AmcContract> {
    const original = await this.findById(contractId);
    if (original.status === AmcContractStatus.CANCELLED) {
      throw new BadRequestException('A cancelled contract cannot be renewed');
    }
    if (original.status === AmcContractStatus.RENEWED) {
      throw new BadRequestException('This contract has already been renewed');
    }

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate <= startDate) {
      throw new BadRequestException('endDate must be after startDate');
    }

    const visitFrequency = dto.visitFrequency ?? original.visitFrequency;
    const visitDates = this.buildVisitDates(startDate, endDate, visitFrequency);
    if (visitDates.length > MAX_GENERATED_VISITS) {
      throw new BadRequestException(
        `This renewal's date range and frequency would generate ${visitDates.length} PM visits, above the ${MAX_GENERATED_VISITS}-visit safety cap.`,
      );
    }

    const contractNumber = await this.generateContractNumber();
    const newContract = this.amcContractRepository.create({
      customerName: original.customerName,
      customerPhone: original.customerPhone,
      customerEmail: original.customerEmail,
      customerAddress: original.customerAddress,
      customerType: original.customerType,
      serviceCentreId: original.serviceCentreId,
      coveredSerialNumbers: dto.coveredSerialNumbers ?? original.coveredSerialNumbers,
      brand: original.brand,
      modelNumber: original.modelNumber,
      coverageType: original.coverageType,
      serviceLevel: original.serviceLevel,
      visitFrequency,
      startDate,
      endDate,
      totalAmount: dto.totalAmount,
      paymentTerms: dto.paymentTerms ?? original.paymentTerms,
      assignedTechnicianId: original.assignedTechnicianId,
      contractNumber,
      status: AmcContractStatus.ACTIVE,
      previousContractId: original.id,
      createdById: userId,
    });
    const saved = await this.amcContractRepository.save(newContract);

    await this.generateVisitSchedule(saved, visitDates);

    original.status = AmcContractStatus.RENEWED;
    await this.amcContractRepository.save(original);

    return this.findById(saved.id);
  }

  async cancelContract(contractId: string, reason: string): Promise<AmcContract> {
    const contract = await this.findById(contractId);
    if (contract.status !== AmcContractStatus.ACTIVE) {
      throw new BadRequestException(`Cannot cancel a contract with status ${contract.status}`);
    }

    contract.status = AmcContractStatus.CANCELLED;
    contract.cancellationReason = reason;
    const saved = await this.amcContractRepository.save(contract);

    // Best-effort: cancel any still-future SCHEDULED PM visits tied to this contract.
    // Direct repository update mirrors how they were created (bypassing
    // AppointmentsService), so cancellation stays symmetric with generation.
    await this.appointmentRepository
      .createQueryBuilder()
      .update(Appointment)
      .set({
        status: AppointmentStatus.CANCELLED,
        cancellationReason: `AMC contract ${contract.contractNumber} cancelled: ${reason}`,
      })
      .where('amcContractId = :contractId', { contractId })
      .andWhere('status = :status', { status: AppointmentStatus.SCHEDULED })
      .execute();

    return saved;
  }

  async getExpiringContracts(withinDays: number): Promise<AmcContract[]> {
    const now = new Date();
    const horizon = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
    return this.amcContractRepository.find({
      where: { status: AmcContractStatus.ACTIVE, endDate: Between(now, horizon) },
      order: { endDate: 'ASC' },
    });
  }

  /**
   * FR/AC per BRD Workflow 13 ("Email to Sales Team" on upcoming renewal). No dedicated
   * Sales role exists in RoleName, so this fires to the customer directly via
   * NotificationsService (same stub channels as everywhere else in this app - see that
   * service's class doc comment). Manual-trigger only: no cron infrastructure exists to
   * auto-fire this 30 days before expiry as the BRD envisions - see class doc comment on
   * AmcContract. getExpiringContracts() above is the companion query-based list a human
   * (or a future scheduler) uses to decide which contracts need this called.
   */
  async sendRenewalReminder(contractId: string): Promise<{ attempted: string[]; delivered: string[] }> {
    const contract = await this.findById(contractId);
    if (contract.status !== AmcContractStatus.ACTIVE) {
      throw new BadRequestException(`Cannot send a renewal reminder for a contract with status ${contract.status}`);
    }

    const result = await this.notificationsService.sendAll(
      NotificationTrigger.AMC_RENEWAL_REMINDER,
      [NotificationChannel.WHATSAPP, NotificationChannel.EMAIL, NotificationChannel.SMS],
      { phone: contract.customerPhone, email: contract.customerEmail },
      {
        customerName: contract.customerName,
        contractNumber: contract.contractNumber,
        endDate: contract.endDate.toISOString().slice(0, 10),
      },
    );

    contract.renewalReminderSentAt = new Date();
    contract.renewalReminderChannelsAttempted = result.attempted;
    contract.renewalReminderChannelsDelivered = result.delivered;
    await this.amcContractRepository.save(contract);

    return { attempted: result.attempted, delivered: result.delivered };
  }

  async generateBillingInvoice(contractId: string, periodLabel: string): Promise<AmcBillingInvoice> {
    const contract = await this.findById(contractId);
    if (contract.status !== AmcContractStatus.ACTIVE) {
      throw new BadRequestException(`Cannot bill a contract with status ${contract.status}`);
    }

    // Frontend Phase 10 pre-mortem finding: periodLabel is caller-supplied free text with
    // nothing else tying a billing invoice to "the period it covers" - unlike Invoicing's
    // Invoice (1:1 with a job card, effectively idempotent by construction), nothing stopped
    // a double-click or a re-billing months later from generating a second AMCINV-#### for
    // the same period. Guarded here rather than left to a Finance user noticing the
    // duplicate during reconciliation.
    const existingForPeriod = await this.billingInvoiceRepository.findOne({
      where: { amcContractId: contractId, periodLabel },
    });
    if (existingForPeriod && existingForPeriod.status !== AmcBillingStatus.CANCELLED) {
      throw new BadRequestException(
        `An invoice for "${periodLabel}" already exists on this contract (${existingForPeriod.invoiceNumber}, ${existingForPeriod.status}) - use a different period label if this is genuinely a separate bill.`,
      );
    }

    const installments = this.installmentsFor(contract.paymentTerms);
    const amount = Math.round((Number(contract.totalAmount) / installments) * 100) / 100;

    const invoiceNumber = await this.generateAmcInvoiceNumber();
    const invoice = this.billingInvoiceRepository.create({
      invoiceNumber,
      amcContractId: contract.id,
      periodLabel,
      amount,
      status: AmcBillingStatus.DRAFT,
    });
    return this.billingInvoiceRepository.save(invoice);
  }

  async findBillingInvoiceById(id: string): Promise<AmcBillingInvoice> {
    const invoice = await this.billingInvoiceRepository.findOne({ where: { id } });
    if (!invoice) {
      throw new NotFoundException(`AMC billing invoice ${id} not found`);
    }
    return invoice;
  }

  async getBillingInvoicesForContract(contractId: string): Promise<AmcBillingInvoice[]> {
    await this.findById(contractId);
    return this.billingInvoiceRepository.find({
      where: { amcContractId: contractId },
      order: { createdAt: 'ASC' },
    });
  }

  /** Full-amount-only settlement - see AmcBillingInvoice's class doc comment for why
   * there's no partial-payment reinvention here unlike Invoicing's Phase 8 extension. */
  async recordBillingPayment(
    invoiceId: string,
    method: PaymentMethod,
    reference: string | undefined,
    userId: string,
  ): Promise<AmcBillingInvoice> {
    const invoice = await this.findBillingInvoiceById(invoiceId);
    if (invoice.status === AmcBillingStatus.PAID) {
      throw new BadRequestException('This AMC billing invoice has already been paid');
    }
    if (invoice.status === AmcBillingStatus.CANCELLED) {
      throw new BadRequestException('Cannot record payment against a cancelled AMC billing invoice');
    }

    if (method === PaymentMethod.B2B_CREDIT) {
      const contract = await this.findById(invoice.amcContractId);
      if (contract.customerType !== CustomerType.B2B) {
        throw new ForbiddenException('B2B Credit can only be used for a B2B customer - this AMC contract is not B2B.');
      }
    }

    invoice.status = AmcBillingStatus.PAID;
    invoice.paymentMethod = method;
    invoice.paymentReference = reference ?? null;
    invoice.paidAt = new Date();
    invoice.recordedByUserId = userId;
    return this.billingInvoiceRepository.save(invoice);
  }

  /**
   * Post-MVP bonus, reusing existing JobCard/Estimate data rather than a new report
   * entity (per the design reasoning for this phase): out-of-warranty customers who've
   * just proven they'll pay for a repair (an APPROVED Estimate exists) and whose phone
   * number isn't already on an ACTIVE AMC contract - i.e. upsell candidates. Heuristic
   * phone-number matching only, since no CRM/customer master exists to match on -
   * flagged as such rather than presented as precise.
   */
  async getRwrUpsellCandidates(): Promise<
    Array<{ jobCardId: string; jobCardNumber: string; customerName: string; customerPhone: string; estimateAmount: number }>
  > {
    const activeContracts = await this.amcContractRepository.find({ where: { status: AmcContractStatus.ACTIVE } });
    const coveredPhones = new Set(activeContracts.map((c) => c.customerPhone));

    const approvedEstimates = await this.estimateRepository.find({
      where: { status: EstimateStatus.APPROVED },
      relations: { jobCard: { appointment: true } },
      order: { createdAt: 'DESC' },
    });

    const seenPhones = new Set<string>();
    const candidates: Array<{ jobCardId: string; jobCardNumber: string; customerName: string; customerPhone: string; estimateAmount: number }> = [];

    for (const estimate of approvedEstimates as any[]) {
      const jobCard = estimate.jobCard;
      const appointment = jobCard?.appointment;
      if (!appointment) continue;
      const phone = appointment.customerPhone;
      if (!phone || coveredPhones.has(phone) || seenPhones.has(phone)) continue;
      seenPhones.add(phone);
      candidates.push({
        jobCardId: jobCard.id,
        jobCardNumber: jobCard.jobCardNumber,
        customerName: appointment.customerName,
        customerPhone: phone,
        estimateAmount: Number(estimate.totalAmount),
      });
    }

    return candidates;
  }
}
