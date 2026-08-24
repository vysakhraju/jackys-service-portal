import { Injectable, BadRequestException, NotFoundException, ConflictException, GoneException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { Estimate, EstimateStatus, RespondedVia, ContactMethod, EstimateLineItem } from './entities/estimate.entity';
import { CreateEstimateDto } from './dto/create-estimate.dto';
import { RespondEstimateDto } from './dto/respond-estimate.dto';
import { RecordResponseDto } from './dto/record-response.dto';
import { ReviseEstimateDto } from './dto/revise-estimate.dto';
import { JobCardsService } from '../job-cards/job-cards.service';
import { JobCardStatus } from '../job-cards/entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationChannel, NotificationTrigger } from '../master-data/entities/notification-template.entity';

const TOKEN_EXPIRY_DAYS = 7;
const ALL_CHANNELS = [NotificationChannel.WHATSAPP, NotificationChannel.EMAIL, NotificationChannel.SMS];

@Injectable()
export class EstimatesService {
  constructor(
    @InjectRepository(Estimate)
    private estimateRepository: Repository<Estimate>,
    private jobCardsService: JobCardsService,
    private notificationsService: NotificationsService,
  ) {}

  private async findEntityById(id: string): Promise<Estimate> {
    const estimate = await this.estimateRepository.findOne({ where: { id } });
    if (!estimate) {
      throw new NotFoundException(`Estimate ${id} not found`);
    }
    return estimate;
  }

  async findById(id: string): Promise<Estimate> {
    const estimate = await this.estimateRepository.findOne({
      where: { id },
      relations: { jobCard: true, createdBy: true, recordedByUser: true },
    });
    if (!estimate) {
      throw new NotFoundException(`Estimate ${id} not found`);
    }
    return estimate;
  }

  async findByJobCardId(jobCardId: string): Promise<Estimate[]> {
    return this.estimateRepository.find({ where: { jobCardId }, order: { createdAt: 'DESC' } });
  }

  private computeTotals(lineItems: EstimateLineItem[], vatRatePercent: number) {
    const subtotal = lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);
    const vatAmount = Math.round(subtotal * (vatRatePercent / 100) * 100) / 100;
    const totalAmount = Math.round((subtotal + vatAmount) * 100) / 100;
    return { subtotal: Math.round(subtotal * 100) / 100, vatAmount, totalAmount };
  }

  /**
   * Endpoint 1 (staff). Blocked unless the Job Card is OOW and SN_VALIDATED - an Estimate
   * only makes sense once the warranty check is real and the S/N has already cleared its
   * own gate (FR-06 sits downstream of FR-05, not in place of it). Blocked 409 if an
   * active (DRAFT/SENT/APPROVED) estimate already exists - REJECTED/EXPIRED ones don't
   * count, so a fresh estimate after a rejection is exactly what revise() is for, and a
   * brand-new one is also fine if revise() wasn't used.
   */
  async create(dto: CreateEstimateDto, userId: string): Promise<Estimate> {
    const jobCard = await this.jobCardsService.findById(dto.jobCardId);

    if (jobCard.warrantyStatus !== WarrantyStatus.OUT_OF_WARRANTY) {
      throw new BadRequestException('An Estimate can only be created for an out-of-warranty (OOW) Job Card.');
    }
    if (jobCard.status !== JobCardStatus.SN_VALIDATED) {
      throw new BadRequestException(
        `Job Card must be SN_VALIDATED before an Estimate can be created (current status: ${jobCard.status}).`,
      );
    }

    const existing = await this.estimateRepository.findOne({
      where: { jobCardId: dto.jobCardId, status: In([EstimateStatus.DRAFT, EstimateStatus.SENT, EstimateStatus.APPROVED]) },
    });
    if (existing) {
      throw new ConflictException(`An active Estimate (${existing.status}) already exists for this Job Card.`);
    }

    const vatRate = Number(jobCard.appointment?.serviceCentre?.vatRate ?? 5);
    const { subtotal, vatAmount, totalAmount } = this.computeTotals(dto.lineItems, vatRate);

    const estimate = this.estimateRepository.create({
      jobCardId: dto.jobCardId,
      lineItems: dto.lineItems,
      subtotal,
      vatAmount,
      totalAmount,
      status: EstimateStatus.DRAFT,
      channelsAttempted: [],
      channelsDelivered: [],
      createdById: userId,
    });

    return this.estimateRepository.save(estimate);
  }

  /**
   * Endpoint 2 (staff). Only valid from DRAFT. Generates the public token + 7-day expiry
   * and attempts every channel via NotificationsService - channelsAttempted/Delivered are
   * recorded honestly (see NotificationsService doc comment); a fully-stubbed send still
   * moves the estimate to SENT, since the human-assisted path (record-response) doesn't
   * depend on the customer ever seeing the link at all.
   */
  async send(id: string): Promise<Estimate> {
    const estimate = await this.findEntityById(id);

    if (estimate.status !== EstimateStatus.DRAFT) {
      throw new BadRequestException(`Estimate can only be sent while DRAFT (current status: ${estimate.status}).`);
    }

    const jobCard = await this.jobCardsService.findById(estimate.jobCardId);
    const appointment = jobCard.appointment;

    estimate.accessToken = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + TOKEN_EXPIRY_DAYS);
    estimate.tokenExpiresAt = expiresAt;
    estimate.status = EstimateStatus.SENT;
    estimate.sentAt = new Date();

    const { attempted, delivered } = await this.notificationsService.sendAll(
      NotificationTrigger.ESTIMATE_SENT,
      ALL_CHANNELS,
      { phone: appointment?.customerPhone, email: appointment?.customerEmail },
      {
        customerName: appointment?.customerName ?? '',
        jobCardNumber: jobCard.jobCardNumber,
        totalAmount: String(estimate.totalAmount),
        estimateId: estimate.id,
      },
    );
    estimate.channelsAttempted = attempted;
    estimate.channelsDelivered = delivered;

    return this.estimateRepository.save(estimate);
  }

  /**
   * Endpoint 3 (public, no JWT). Customer-safe view only - deliberately excludes internal
   * fields (createdById, recordedByUserId, etc). 404 on an unknown token; 410 once the
   * link is no longer live, whether because it expired or because it's already been
   * responded to (via either path) - a decided estimate is not a live decision surface
   * (see the-fool + test-master review: this closes the same race the respond guard
   * closes, one layer up).
   */
  async getPublicView(token: string): Promise<Record<string, unknown>> {
    const estimate = await this.estimateRepository.findOne({ where: { accessToken: token }, relations: { jobCard: true } });
    if (!estimate) {
      throw new NotFoundException('Estimate link not found');
    }

    if (estimate.status !== EstimateStatus.SENT) {
      throw new GoneException('This estimate link is no longer active.');
    }

    if (estimate.tokenExpiresAt && estimate.tokenExpiresAt < new Date()) {
      estimate.status = EstimateStatus.EXPIRED;
      await this.estimateRepository.save(estimate);
      throw new GoneException('This estimate link has expired.');
    }

    return {
      jobCardNumber: estimate.jobCard.jobCardNumber,
      brand: estimate.jobCard.brand,
      lineItems: estimate.lineItems,
      subtotal: estimate.subtotal,
      vatAmount: estimate.vatAmount,
      totalAmount: estimate.totalAmount,
      tokenExpiresAt: estimate.tokenExpiresAt,
    };
  }

  /**
   * Shared state transition for both response paths (endpoints 4 and 5). Guarded on
   * status === SENT so a race between the two paths can't silently overwrite a decision -
   * whichever call lands first wins; the second gets a 409 naming when/how the first one
   * happened instead of clobbering it.
   */
  private async respondToEstimate(
    estimate: Estimate,
    approved: boolean,
    respondedVia: RespondedVia,
    extra: { recordedByUserId?: string; contactMethod?: ContactMethod; contactValue?: string; notes?: string },
  ): Promise<Estimate> {
    if (estimate.status !== EstimateStatus.SENT) {
      if (estimate.respondedAt) {
        throw new ConflictException(
          `This estimate was already responded to at ${estimate.respondedAt.toISOString()} via ${estimate.respondedVia}.`,
        );
      }
      throw new ConflictException(`Estimate cannot be responded to while ${estimate.status} (expected SENT).`);
    }

    estimate.status = approved ? EstimateStatus.APPROVED : EstimateStatus.REJECTED;
    estimate.respondedAt = new Date();
    estimate.respondedVia = respondedVia;
    estimate.recordedByUserId = extra.recordedByUserId ?? null;
    estimate.contactMethod = extra.contactMethod ?? null;
    estimate.contactValue = extra.contactValue ?? null;
    estimate.responseNotes = extra.notes ?? null;

    const saved = await this.estimateRepository.save(estimate);

    if (approved) {
      await this.jobCardsService.approveCustomer(estimate.jobCardId, {
        notes: `Estimate ${estimate.id} approved (${respondedVia})`,
      });
    } else {
      await this.jobCardsService.setToRwr(estimate.jobCardId);
    }

    return saved;
  }

  /** Endpoint 4 (public, no JWT). */
  async respondViaLink(token: string, dto: RespondEstimateDto): Promise<Estimate> {
    const estimate = await this.estimateRepository.findOne({ where: { accessToken: token } });
    if (!estimate) {
      throw new NotFoundException('Estimate link not found');
    }

    if (estimate.status === EstimateStatus.SENT && estimate.tokenExpiresAt && estimate.tokenExpiresAt < new Date()) {
      estimate.status = EstimateStatus.EXPIRED;
      await this.estimateRepository.save(estimate);
      throw new GoneException('This estimate link has expired.');
    }

    return this.respondToEstimate(estimate, dto.approved, RespondedVia.CUSTOMER_LINK, { notes: dto.notes });
  }

  /**
   * Endpoint 5 (staff, JWT + role-gated). The anti-consent-laundering guard: contactValue
   * must match the phone or email already on file for the appointment exactly (trimmed,
   * case-insensitive for email) - a staff member can't attest to a contact that isn't the
   * one actually on record for this customer. Fails closed if the appointment has neither
   * a matching phone nor email on file.
   */
  async recordResponse(id: string, dto: RecordResponseDto, userId: string): Promise<Estimate> {
    const estimate = await this.findEntityById(id);
    const jobCard = await this.jobCardsService.findById(estimate.jobCardId);
    const appointment = jobCard.appointment;

    const provided = dto.contactValue.trim().toLowerCase();
    const phoneMatches = !!appointment?.customerPhone && appointment.customerPhone.trim() === dto.contactValue.trim();
    const emailMatches = !!appointment?.customerEmail && appointment.customerEmail.trim().toLowerCase() === provided;

    if (!phoneMatches && !emailMatches) {
      throw new BadRequestException(
        'The contact value provided does not match the phone number or email on file for this appointment - ' +
          'a customer response cannot be recorded without verifying against a known contact.',
      );
    }

    return this.respondToEstimate(estimate, dto.approved, RespondedVia.STAFF_RECORDED, {
      recordedByUserId: userId,
      contactMethod: dto.contactMethod,
      contactValue: dto.contactValue,
      notes: dto.notes,
    });
  }

  /**
   * Endpoint 6 (staff). Only valid on a REJECTED estimate. The rejected estimate is left
   * untouched (permanent record); a new DRAFT is created linked via previousEstimateId,
   * reusing the previous line items unless new ones are supplied, and the Job Card is
   * moved back out of RWR to SN_VALIDATED so the flow can continue (FR-08: RWR is not a
   * dead end).
   */
  async revise(id: string, dto: ReviseEstimateDto, userId: string): Promise<Estimate> {
    const estimate = await this.findEntityById(id);

    if (estimate.status !== EstimateStatus.REJECTED) {
      throw new BadRequestException(`Can only revise a REJECTED estimate (current status: ${estimate.status}).`);
    }

    const jobCard = await this.jobCardsService.findById(estimate.jobCardId);
    const lineItems = dto.lineItems && dto.lineItems.length > 0 ? dto.lineItems : estimate.lineItems;
    const vatRate = Number(jobCard.appointment?.serviceCentre?.vatRate ?? 5);
    const { subtotal, vatAmount, totalAmount } = this.computeTotals(lineItems, vatRate);

    await this.jobCardsService.reviveFromRwr(estimate.jobCardId);

    const revised = this.estimateRepository.create({
      jobCardId: estimate.jobCardId,
      lineItems,
      subtotal,
      vatAmount,
      totalAmount,
      status: EstimateStatus.DRAFT,
      channelsAttempted: [],
      channelsDelivered: [],
      previousEstimateId: estimate.id,
      createdById: userId,
    });

    return this.estimateRepository.save(revised);
  }
}
