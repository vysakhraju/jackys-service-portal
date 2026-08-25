import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice, InvoiceStatus, PaymentMethod } from './entities/invoice.entity';
import { Estimate, EstimateStatus } from '../estimates/entities/estimate.entity';
import { JobCardsService } from '../job-cards/job-cards.service';
import { JobCardStatus } from '../job-cards/entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { CustomerType } from '../appointments/entities/appointment.entity';

@Injectable()
export class InvoicingService {
  constructor(
    @InjectRepository(Invoice) private invoiceRepository: Repository<Invoice>,
    @InjectRepository(Estimate) private estimateRepository: Repository<Estimate>,
    private jobCardsService: JobCardsService,
  ) {}

  private async generateInvoiceNumber(): Promise<string> {
    const prefix = 'INV-';
    const last = await this.invoiceRepository
      .createQueryBuilder('inv')
      .where('inv.invoiceNumber LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('inv.invoiceNumber', 'DESC')
      .getOne();

    let sequence = 1;
    if (last) {
      sequence = parseInt(last.invoiceNumber.replace(prefix, ''), 10) + 1;
    }
    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }

  async findById(id: string): Promise<Invoice> {
    const invoice = await this.invoiceRepository.findOne({ where: { id } });
    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }
    return invoice;
  }

  async findByJobCardId(jobCardId: string): Promise<Invoice | null> {
    return this.invoiceRepository.findOne({ where: { jobCardId } });
  }

  /**
   * Lazily creates a DRAFT invoice the first time one's needed for a QC_PASSED, OOW Job
   * Card - deliberately not eagerly created at QC-approve time (Phase 6 stays untouched).
   * Never called for IW jobs (nothing to invoice - warranty covers it).
   *
   * Race safety: two near-simultaneous callers (a polling dashboard, a delivery-batch
   * attempt) could both see "no invoice yet" and both try to insert one. The unique index
   * on Invoice.jobCardId makes the DB reject the loser; caught here and treated as "someone
   * else just created it" - refetch and return that instead of a raw 500.
   */
  async getOrCreateForJobCard(jobCardId: string): Promise<Invoice> {
    const existing = await this.findByJobCardId(jobCardId);
    if (existing) {
      return existing;
    }

    const jobCard = await this.jobCardsService.findById(jobCardId);
    if (jobCard.status !== JobCardStatus.QC_PASSED && jobCard.status !== JobCardStatus.DELIVERED) {
      throw new BadRequestException(`Cannot generate an invoice for a Job Card that hasn't passed QC yet (current status: ${jobCard.status}).`);
    }
    if (jobCard.warrantyStatus !== WarrantyStatus.OUT_OF_WARRANTY) {
      throw new BadRequestException('This Job Card is in-warranty - there is nothing to invoice.');
    }

    // Estimates.create() blocks a new active estimate from ever existing alongside an
    // already-APPROVED one (409 gate) - so at most one APPROVED estimate can exist per Job
    // Card, ever. Still ordering + defensively erroring loud rather than silently picking
    // one, in case that invariant is ever violated by a future change.
    const approvedEstimates = await this.estimateRepository.find({
      where: { jobCardId, status: EstimateStatus.APPROVED },
      order: { createdAt: 'DESC' },
    });
    if (approvedEstimates.length === 0) {
      throw new BadRequestException('No approved Estimate exists for this out-of-warranty Job Card - cannot determine an invoice amount.');
    }
    if (approvedEstimates.length > 1) {
      throw new BadRequestException(`Data integrity error: Job Card ${jobCardId} has ${approvedEstimates.length} APPROVED estimates - expected at most one. Needs manual review before an invoice can be generated.`);
    }

    try {
      const invoice = this.invoiceRepository.create({
        invoiceNumber: await this.generateInvoiceNumber(),
        jobCardId,
        amount: approvedEstimates[0].totalAmount,
        status: InvoiceStatus.DRAFT,
      });
      return await this.invoiceRepository.save(invoice);
    } catch (err: any) {
      if (err?.code === '23505') {
        // Unique constraint hit - another call won the race. Return theirs.
        const winner = await this.findByJobCardId(jobCardId);
        if (winner) {
          return winner;
        }
      }
      throw err;
    }
  }

  /**
   * FR-14 (Cash/Card/Bank Transfer/B2B Credit, no online gateway). Two deliberate guards
   * beyond the spec's literal wording, both closing real abuse paths flagged in the
   * pre-mortem:
   *  - amountReceived must equal the invoice's amount exactly - no "mark paid" with no
   *    real number behind it (partial payments are explicitly Phase 8/Finance territory).
   *  - B2B_CREDIT is refused unless the underlying Appointment is actually customerType
   *    B2B - otherwise it's a free payment-bypass for any B2C customer who won't pay.
   */
  async recordPayment(
    invoiceId: string,
    method: PaymentMethod,
    amountReceived: number,
    recordedByUserId: string,
    reference?: string,
  ): Promise<Invoice> {
    const invoice = await this.findById(invoiceId);

    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('This invoice has already been paid.');
    }
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Cannot record payment against a cancelled invoice.');
    }

    if (method === PaymentMethod.B2B_CREDIT) {
      const jobCard = await this.jobCardsService.findById(invoice.jobCardId);
      if (jobCard.appointment?.customerType !== CustomerType.B2B) {
        throw new ForbiddenException('B2B Credit can only be used for a B2B customer - this Job Card belongs to a B2C appointment.');
      }
    }

    if (Number(amountReceived) !== Number(invoice.amount)) {
      throw new BadRequestException(`Amount received (${amountReceived}) does not match the invoice amount (${invoice.amount}) - partial payments aren't supported yet.`);
    }

    invoice.status = InvoiceStatus.PAID;
    invoice.paymentMethod = method;
    invoice.amountReceived = amountReceived;
    invoice.paymentReference = reference ?? null;
    invoice.paidAt = new Date();
    invoice.recordedByUserId = recordedByUserId;

    return this.invoiceRepository.save(invoice);
  }

  /** DeliveryService's OOW-paid gate check - true if delivery may proceed for this job. */
  async isPayableForDelivery(jobCardId: string): Promise<{ payable: boolean; invoice: Invoice }> {
    const invoice = await this.getOrCreateForJobCard(jobCardId);
    const payable = invoice.status === InvoiceStatus.PAID;
    return { payable, invoice };
  }
}
