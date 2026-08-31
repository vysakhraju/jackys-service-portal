import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice, InvoiceStatus, PaymentMethod } from './entities/invoice.entity';
import { Payment } from './entities/payment.entity';
import { Estimate, EstimateStatus } from '../estimates/entities/estimate.entity';
import { JobCardsService } from '../job-cards/job-cards.service';
import { JobCardStatus } from '../job-cards/entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { CustomerType } from '../appointments/entities/appointment.entity';
import { GlLedgerService } from '../gl-ledger/gl-ledger.service';

const B2B_CREDIT_TERM_DAYS = 30;

export interface AgingBucket {
  label: string;
  invoices: Invoice[];
  totalOutstanding: number;
}

@Injectable()
export class InvoicingService {
  constructor(
    @InjectRepository(Invoice) private invoiceRepository: Repository<Invoice>,
    @InjectRepository(Payment) private paymentRepository: Repository<Payment>,
    @InjectRepository(Estimate) private estimateRepository: Repository<Estimate>,
    private jobCardsService: JobCardsService,
    private glLedgerService: GlLedgerService,
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
   * Frontend Phase 9: general browse/audit view - the only other read primitives are
   * by-id, by-job-card, and the B2B-unpaid-only aging report, none of which give Finance
   * a full system-of-record list (all statuses, both B2B and B2C). Filters by status
   * and/or the owning appointment's customerType, same post-fetch-filter style as
   * getB2bAgingReport (customerType lives on a relation two hops away, not a plain
   * column, so it isn't expressible as a `where` clause without a query builder).
   */
  async findAll(status?: InvoiceStatus, customerType?: CustomerType): Promise<Invoice[]> {
    const invoices = await this.invoiceRepository.find({
      where: status ? { status } : {},
      relations: { jobCard: { appointment: true } },
      order: { createdAt: 'DESC' },
    });

    if (!customerType) {
      return invoices;
    }
    return invoices.filter((inv: any) => inv.jobCard?.appointment?.customerType === customerType);
  }

  async findPayments(invoiceId: string): Promise<Payment[]> {
    // Ensures a 404 for an unknown invoice id rather than a silently-empty list.
    await this.findById(invoiceId);
    return this.paymentRepository.find({ where: { invoiceId }, order: { recordedAt: 'ASC' } });
  }

  /** Source of truth for "how much has actually been paid" - see Payment's doc comment. */
  async getAmountPaid(invoiceId: string): Promise<number> {
    const payments = await this.paymentRepository.find({ where: { invoiceId } });
    return Math.round(payments.reduce((sum, p) => sum + Number(p.amount), 0) * 100) / 100;
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

    const estimate = approvedEstimates[0];
    const now = new Date();

    try {
      const invoice = this.invoiceRepository.create({
        invoiceNumber: await this.generateInvoiceNumber(),
        jobCardId,
        amount: estimate.totalAmount,
        subtotal: estimate.subtotal,
        vatRate: Number(jobCard.appointment?.serviceCentre?.vatRate ?? 5),
        vatAmount: estimate.vatAmount,
        status: InvoiceStatus.DRAFT,
        dueDate: new Date(now.getTime() + B2B_CREDIT_TERM_DAYS * 24 * 60 * 60 * 1000),
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
   * FR-14 (Cash/Card/Bank Transfer/B2B Credit, no online gateway). Phase 8: partial
   * payments are now allowed - each call records one Payment row rather than requiring
   * the full amount up front. Deliberate guards, all closing real abuse paths flagged in
   * the Phase 7 pre-mortem and still relevant here:
   *  - amount must be > 0 and <= the remaining balance - no overpayment, no "mark paid"
   *    with more money recorded than was actually owed.
   *  - B2B_CREDIT is refused unless the underlying Appointment is actually customerType
   *    B2B - otherwise it's a free payment-bypass for any B2C customer who won't pay.
   *  - A GL posting is generated for every payment (one line per payment, not per
   *    invoice), so partial payments stay individually traceable in the ledger.
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
      throw new BadRequestException('This invoice has already been paid in full.');
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

    const alreadyPaid = await this.getAmountPaid(invoiceId);
    const remaining = Math.round((Number(invoice.amount) - alreadyPaid) * 100) / 100;

    if (remaining <= 0) {
      // Shouldn't be reachable given the status guards above, but a belt-and-braces
      // check against the real numbers rather than trusting status alone.
      throw new BadRequestException('This invoice has no remaining balance.');
    }
    if (Number(amountReceived) > remaining) {
      throw new BadRequestException(`Amount received (${amountReceived}) exceeds the remaining balance (${remaining}) - overpayment is not supported.`);
    }

    const payment = this.paymentRepository.create({
      invoiceId,
      method,
      amount: amountReceived,
      reference: reference ?? null,
      recordedByUserId,
    });
    await this.paymentRepository.save(payment);

    const newRemaining = Math.round((remaining - Number(amountReceived)) * 100) / 100;
    invoice.status = newRemaining <= 0 ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;
    invoice.paymentMethod = method;
    invoice.amountReceived = amountReceived;
    invoice.paymentReference = reference ?? null;
    invoice.paidAt = new Date();
    invoice.recordedByUserId = recordedByUserId;
    const saved = await this.invoiceRepository.save(invoice);

    await this.glLedgerService.postInvoicePayment({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      method,
      amount: amountReceived,
    });

    return saved;
  }

  /** DeliveryService's OOW-paid gate check - true if delivery may proceed for this job. */
  async isPayableForDelivery(jobCardId: string): Promise<{ payable: boolean; invoice: Invoice }> {
    const invoice = await this.getOrCreateForJobCard(jobCardId);
    const payable = invoice.status === InvoiceStatus.PAID;
    return { payable, invoice };
  }

  /**
   * AC-16 recharge/aging report for outstanding B2B Credit invoices, bucketed by days
   * past dueDate. Only B2B_CREDIT-method invoices are meaningfully "aged" (Cash/Card/Bank
   * are expected same-visit) - but since paymentMethod is only set once a payment has
   * been recorded, and a DRAFT invoice has no paymentMethod yet, this report includes
   * every non-PAID, non-CANCELLED invoice whose Job Card belongs to a B2B appointment
   * (the population Credit terms actually apply to), not just ones already tagged
   * B2B_CREDIT from a first partial payment.
   */
  async getB2bAgingReport(): Promise<{ buckets: AgingBucket[]; totalOutstanding: number }> {
    const openInvoices = await this.invoiceRepository.find({
      where: [{ status: InvoiceStatus.DRAFT }, { status: InvoiceStatus.PARTIALLY_PAID }],
      relations: { jobCard: { appointment: true } },
    });

    const b2bInvoices = openInvoices.filter(
      (inv: any) => inv.jobCard?.appointment?.customerType === CustomerType.B2B,
    );

    const now = Date.now();
    const bucketDefs = [
      { label: '0-30 days', min: 0, max: 30 },
      { label: '31-60 days', min: 31, max: 60 },
      { label: '61-90 days', min: 61, max: 90 },
      { label: '90+ days', min: 91, max: Infinity },
    ];

    const buckets: AgingBucket[] = bucketDefs.map((b) => ({ label: b.label, invoices: [], totalOutstanding: 0 }));
    let totalOutstanding = 0;

    for (const invoice of b2bInvoices) {
      const paid = await this.getAmountPaid(invoice.id);
      const outstanding = Math.round((Number(invoice.amount) - paid) * 100) / 100;
      if (outstanding <= 0) continue;

      const dueTime = invoice.dueDate ? new Date(invoice.dueDate).getTime() : new Date(invoice.createdAt).getTime();
      const daysPastDue = Math.max(0, Math.floor((now - dueTime) / (24 * 60 * 60 * 1000)));

      const bucketDef = bucketDefs.find((b) => daysPastDue >= b.min && daysPastDue <= b.max) ?? bucketDefs[bucketDefs.length - 1];
      const bucket = buckets[bucketDefs.indexOf(bucketDef)];
      bucket.invoices.push(invoice);
      bucket.totalOutstanding = Math.round((bucket.totalOutstanding + outstanding) * 100) / 100;
      totalOutstanding = Math.round((totalOutstanding + outstanding) * 100) / 100;
    }

    return { buckets, totalOutstanding };
  }
}
