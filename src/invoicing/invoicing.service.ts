import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice, InvoiceStatus, PaymentMethod, InvoicePriceSource } from './entities/invoice.entity';
import { Payment } from './entities/payment.entity';
import { Estimate, EstimateStatus } from '../estimates/entities/estimate.entity';
import { ServicePriceList, JobType, CustomerType } from '../master-data/entities/service-price-list.entity';
import { JobCardsService } from '../job-cards/job-cards.service';
import { JobCard, JobCardStatus } from '../job-cards/entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { GlLedgerService } from '../gl-ledger/gl-ledger.service';
import { resolvePriceListRow } from '../master-data/billing-channel-resolution.util';

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
    @InjectRepository(ServicePriceList) private priceListRepository: Repository<ServicePriceList>,
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
   * Billing logic + Billing Channel routing (2026-09-22, Phase 4; rebuilt 2026-09-25 for
   * the super-admin pricing matrix). Real gap found before Phase 4 was written: an OOW
   * Job Card can reach QC_PASSED/DELIVERED with NO Estimate at all -
   * JobCardsService.approveCustomer's FR-06 manual stopgap sets customerApproved=true
   * directly, bypassing the Estimate flow entirely - and getOrCreateForJobCard used to
   * hard-block ("cannot determine an invoice amount") whenever that happened. This
   * computes the Price List baseline for that case instead: an approved Estimate, when
   * one exists, still always overrides this (the "billing tiebreaker" decision locked in
   * the original 2026-09-22 request) - this method is only ever called when none does.
   *
   * Category comes from the appointment's linked ApplianceModel (never the legacy
   * modelNumber string), crossed with the appointment's own jobType and customerType -
   * all 4 Price List dimensions now (category, jobType, customerType, billingChannelId)
   * are resolved in one call to resolvePriceListRow(), which does the whole lookup
   * (including "channel picked but no row configured for it") and returns the single
   * `price` column directly - no more client-side B2B/B2C/channel branching. Same
   * hard-stop philosophy on every failure mode (no Category set, no matching active
   * Price List row, no row for a picked channel) - a silently-invented price is a worse
   * outcome than a clear 400 telling staff what master-data gap to fix first.
   */
  private async resolveBaselinePricing(jobCard: JobCard): Promise<{
    subtotal: number;
    vatRate: number;
    vatAmount: number;
    amount: number;
    billingChannelId: string | null;
    billingChannelName: string | null;
  }> {
    // Never called for a COMPLETED (ERP-sourced) Job Card - see
    // resolveActivityLineItemsPricing below, which getOrCreateForJobCard routes to
    // instead. Guarded here too since this method's own category resolution
    // (appointment.applianceModel) is meaningless for that flow - Phase 6 hides the
    // Brand/Model field entirely for INSTALLATION/DELIVERY_INSTALLATION appointments, so
    // appointment.applianceModel is always null for them regardless of what a caller
    // passes in.
    const appointment: Appointment | null | undefined = jobCard.appointment;
    const category = appointment?.applianceModel?.category ?? null;
    if (!category) {
      throw new BadRequestException(
        "This appointment's Appliance Model has no Category set (or no model is linked at all) - set one on the Appliance Model master before an invoice can be generated for it without an approved Estimate.",
      );
    }
    const jobType = appointment?.jobType ?? JobType.REPAIR;
    const customerType = appointment?.customerType ?? CustomerType.B2C;

    // 2026-09-25 pricing matrix rebuild: customerType is now baked into the Price List
    // lookup itself (one row per Category/JobType/CustomerType/BillingChannel), so there's
    // no more separate B2B/B2C branch here - resolvePriceListRow does the whole lookup,
    // including the "channel picked but no row configured for it" hard-stop.
    const resolved = await resolvePriceListRow(this.priceListRepository, {
      category,
      jobType,
      customerType,
      billingChannelId: appointment?.billingChannelId ?? null,
      billingChannelName: appointment?.billingChannel?.name ?? null,
    });
    const basePrice = Number(resolved.row.price);

    const vatRate = Number(appointment?.serviceCentre?.vatRate ?? 5);
    const subtotal = Math.round(basePrice * 100) / 100;
    const vatAmount = Math.round(subtotal * (vatRate / 100) * 100) / 100;
    const amount = Math.round((subtotal + vatAmount) * 100) / 100;

    return {
      subtotal,
      vatRate,
      vatAmount,
      amount,
      billingChannelId: resolved.billingChannelId,
      billingChannelName: resolved.billingChannelName,
    };
  }

  /**
   * Phase 11 (2026-09-24) - billing for a COMPLETED (ERP-sourced) Job Card from the Job
   * Type split's Installation/Delivery Installation flow (Phase 10). These Job Cards
   * never go through QC/Estimates at all (point 11 of the original 2026-09-22 request:
   * "financial billing routes through the existing Billing Channel/Price List logic
   * unchanged" - reaching COMPLETED is itself the billing trigger, not a QC pass), and
   * their appointment never carries an ApplianceModel (Phase 6 hides that field entirely
   * for these 2 job types) - so unlike resolveBaselinePricing above, Category/JobType
   * come from the Job Card's own JobCardActivityLineItem rows (Phase 10), one line per
   * appliance/quantity the CCE or technician recorded, not from a single appointment-wide
   * model. A Job Card can carry several lines with different categories/job types (e.g.
   * deliver 2 units, install 3 others under one ERP reference) - each line is priced
   * independently against the Price List and the results summed into one invoice, per
   * your own confirmation this round ("several line items, potentially different
   * appliance categories & qty... price is calculated based on that from price master").
   *
   * B2C/B2B/B2B_SALES_CHANNEL routing and the appointment's own Billing Channel override
   * (Phase 5) are unchanged in spirit from resolveBaselinePricing, just applied per line:
   * for a B2B_SALES_CHANNEL job whose appointment has its own picked Billing Channel, that
   * channel's flat `defaultRate` (originally designed as a single per-job rate on a
   * REPAIR-flow, one-appliance job) is applied here as a PER-UNIT rate on every line -
   * documented as-designed rather than silently guessed, since there's no existing
   * multi-line precedent to follow; revisit this specific rule if it turns out wrong once
   * a real multi-line B2B_SALES_CHANNEL install is billed. A line whose Price List row has
   * its OWN configured Billing Channel (no appointment-level override) is unaffected by
   * this note - that per-row rate was already designed to be a per-unit rate.
   *
   * Same hard-stop philosophy as resolveBaselinePricing on every failure mode (missing
   * Category, no matching active Price List row, no Billing Channel defaultRate) - a
   * silently-invented price is worse than a clear 400 naming which line and what master-
   * data gap to fix. "Keep room for pricing new logic later" (your own framing this
   * round): this method is the one, single place per-line activity pricing happens, so a
   * future pricing rule change has one call site to touch, not several.
   */
  private async resolveActivityLineItemsPricing(jobCard: JobCard): Promise<{
    subtotal: number;
    vatRate: number;
    vatAmount: number;
    amount: number;
    billingChannelId: string | null;
    billingChannelName: string | null;
    lineItemsBreakdown: NonNullable<Invoice['lineItemsBreakdown']>;
  }> {
    const appointment: Appointment | null | undefined = jobCard.appointment;
    const lineItems = jobCard.activityLineItems ?? [];
    if (lineItems.length === 0) {
      throw new BadRequestException(
        `Job Card ${jobCard.jobCardNumber} is COMPLETED but has no line items recorded - nothing to invoice. This indicates a data-integrity gap, not a normal state.`,
      );
    }

    let runningBillingChannelId: string | null = null;
    let runningBillingChannelName: string | null = null;
    let subtotal = 0;
    const lineItemsBreakdown: NonNullable<Invoice['lineItemsBreakdown']> = [];

    for (const line of lineItems) {
      const category = line.applianceModel?.category ?? null;
      if (!category) {
        throw new BadRequestException(
          `Line item for Appliance Model ${line.applianceModelId} on Job Card ${jobCard.jobCardNumber} has no Category set - set one on the Appliance Model master before an invoice can be generated.`,
        );
      }
      const customerType = appointment?.customerType ?? CustomerType.B2C;

      // 2026-09-25 pricing matrix rebuild - same "customerType baked into the lookup,
      // no separate B2B/B2C branch" change as resolveBaselinePricing above, applied
      // per-line since each line can carry its own category/jobType.
      let lineResolved;
      try {
        lineResolved = await resolvePriceListRow(this.priceListRepository, {
          category,
          jobType: line.jobType,
          customerType,
          billingChannelId: appointment?.billingChannelId ?? null,
          billingChannelName: appointment?.billingChannel?.name ?? null,
        });
      } catch (err) {
        if (err instanceof BadRequestException) {
          throw new BadRequestException(
            `${err.message} (Job Card ${jobCard.jobCardNumber}, line for Appliance Model ${line.applianceModelId})`,
          );
        }
        throw err;
      }
      const unitPrice = Number(lineResolved.row.price);
      const billingChannelId = lineResolved.billingChannelId;
      const billingChannelName = lineResolved.billingChannelName;

      const lineTotal = Math.round(unitPrice * line.quantity * 100) / 100;
      subtotal = Math.round((subtotal + lineTotal) * 100) / 100;
      if (billingChannelId) {
        runningBillingChannelId = billingChannelId;
        runningBillingChannelName = billingChannelName;
      }

      lineItemsBreakdown.push({
        applianceModelId: line.applianceModelId,
        brand: line.applianceModel?.brand ?? '',
        model: line.applianceModel?.model ?? '',
        category,
        jobType: line.jobType,
        quantity: line.quantity,
        unitPrice,
        lineTotal,
        billingChannelId,
        billingChannelName,
      });
    }

    const vatRate = Number(appointment?.serviceCentre?.vatRate ?? 5);
    const vatAmount = Math.round(subtotal * (vatRate / 100) * 100) / 100;
    const amount = Math.round((subtotal + vatAmount) * 100) / 100;

    return {
      subtotal,
      vatRate,
      vatAmount,
      amount,
      billingChannelId: runningBillingChannelId,
      billingChannelName: runningBillingChannelName,
      lineItemsBreakdown,
    };
  }

  /**
   * Lazily creates a DRAFT invoice the first time one's needed for a QC_PASSED, OOW Job
   * Card - or, per Phase 11, for a COMPLETED (ERP-sourced) Job Card, whose own COMPLETED
   * status is the billing trigger instead of QC. Deliberately not eagerly created at
   * QC-approve/activity-finish time (Phase 6 stays untouched for REPAIR).
   * Never called for IW REPAIR jobs (nothing to invoice - warranty covers it); COMPLETED
   * Job Cards have no warrantyStatus concept at all (nulled per Phase 10) and always go
   * through this path.
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

    // Phase 11: a COMPLETED (ERP-sourced) Job Card never enters the QC/warranty pipeline
    // at all - reaching COMPLETED IS the billing trigger for it, per your own framing
    // this round ("once status is completed for that job, billing happens... dont rely
    // on repair workflow as qc completed or delivery"). Every other status still goes
    // through the REPAIR-flow QC/warranty gate exactly as before.
    const isActivityJobCard = jobCard.status === JobCardStatus.COMPLETED;
    if (!isActivityJobCard) {
      if (jobCard.status !== JobCardStatus.QC_PASSED && jobCard.status !== JobCardStatus.DELIVERED) {
        throw new BadRequestException(`Cannot generate an invoice for a Job Card that hasn't passed QC yet (current status: ${jobCard.status}).`);
      }
      if (jobCard.warrantyStatus !== WarrantyStatus.OUT_OF_WARRANTY) {
        throw new BadRequestException('This Job Card is in-warranty - there is nothing to invoice.');
      }
    }

    // Estimates.create() blocks a new active estimate from ever existing alongside an
    // already-APPROVED one (409 gate) - so at most one APPROVED estimate can exist per Job
    // Card, ever. Still ordering + defensively erroring loud rather than silently picking
    // one, in case that invariant is ever violated by a future change. Skipped entirely
    // for an activity Job Card - Estimates are a REPAIR-flow-only concept (point 10 of
    // the original request routes these through a wholly separate creation path), so
    // there's no approved-estimate table to even check.
    const approvedEstimates = isActivityJobCard
      ? []
      : await this.estimateRepository.find({
          where: { jobCardId, status: EstimateStatus.APPROVED },
          order: { createdAt: 'DESC' },
        });
    if (approvedEstimates.length > 1) {
      throw new BadRequestException(`Data integrity error: Job Card ${jobCardId} has ${approvedEstimates.length} APPROVED estimates - expected at most one. Needs manual review before an invoice can be generated.`);
    }

    let amount: number;
    let subtotal: number;
    let vatRate: number;
    let vatAmount: number;
    let priceSource: InvoicePriceSource;
    let sourceEstimateId: string | null = null;
    let billingChannelId: string | null = null;
    let billingChannelName: string | null = null;
    let lineItemsBreakdown: Invoice['lineItemsBreakdown'] = null;

    if (approvedEstimates.length === 1) {
      // Approved Estimate always overrides the Price List baseline - the locked
      // "billing tiebreaker" decision. Unchanged from before Phase 4.
      const estimate = approvedEstimates[0];
      amount = estimate.totalAmount;
      subtotal = estimate.subtotal;
      vatAmount = estimate.vatAmount;
      vatRate = Number(jobCard.appointment?.serviceCentre?.vatRate ?? 5);
      priceSource = InvoicePriceSource.ESTIMATE;
      sourceEstimateId = estimate.id;
    } else if (isActivityJobCard) {
      // Phase 11: COMPLETED Job Card, priced per its own line items - see
      // resolveActivityLineItemsPricing's own doc comment for the full design.
      const baseline = await this.resolveActivityLineItemsPricing(jobCard);
      amount = baseline.amount;
      subtotal = baseline.subtotal;
      vatRate = baseline.vatRate;
      vatAmount = baseline.vatAmount;
      priceSource = InvoicePriceSource.ACTIVITY_LINE_ITEMS;
      billingChannelId = baseline.billingChannelId;
      billingChannelName = baseline.billingChannelName;
      lineItemsBreakdown = baseline.lineItemsBreakdown;
    } else {
      // No approved Estimate exists (most likely the FR-06 manual approve-customer
      // stopgap was used instead of the real Estimate flow) - fall back to the Price
      // List baseline rather than hard-blocking invoice generation.
      const baseline = await this.resolveBaselinePricing(jobCard);
      amount = baseline.amount;
      subtotal = baseline.subtotal;
      vatRate = baseline.vatRate;
      vatAmount = baseline.vatAmount;
      priceSource = InvoicePriceSource.PRICE_LIST_BASELINE;
      billingChannelId = baseline.billingChannelId;
      billingChannelName = baseline.billingChannelName;
    }

    const now = new Date();

    try {
      const invoice = this.invoiceRepository.create({
        invoiceNumber: await this.generateInvoiceNumber(),
        jobCardId,
        amount,
        subtotal,
        vatRate,
        vatAmount,
        priceSource,
        sourceEstimateId,
        billingChannelId,
        billingChannelName,
        lineItemsBreakdown,
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
   * Safety valve for a DRAFT invoice that was computed wrong because of a master-data
   * gap that has since been fixed (2026-09-25, following the JER-C AED 0.00 dead-end -
   * see billing-channel-resolution.util.ts's doc comment for the root cause). Invoice
   * generation is otherwise a deliberate one-shot, immutable computation - this does NOT
   * change that: it never edits an invoice's numbers in place. It only deletes a DRAFT
   * that has zero payments recorded against it and lets getOrCreateForJobCard build a
   * fresh one from current master data, under a brand-new invoice number.
   *
   * Why this is safe where in-place editing wouldn't be: a DRAFT with nothing paid
   * against it was never a real financial record to begin with - nothing to reconcile
   * against, no "why did this number change" question for Finance, no clobbering a
   * concurrent payment (blocked below). Once a single AED has been recorded against it,
   * this refuses outright and the invoice is permanently frozen exactly as before - nothing
   * about this method weakens that guarantee for a paid or partially-paid invoice.
   *
   * No GL posting here - unlike recordPayment, nothing financial actually happened (no
   * money moved), so there is nothing for the ledger to record. Traceability instead
   * comes from the controller's @Audit(AuditAction.INVOICE_REGENERATE) - old/new invoice
   * number and amount are both passed back to the caller for that log entry.
   */
  async regenerateDraftInvoice(
    jobCardId: string,
    requestedByUserId: string,
  ): Promise<{ invoice: Invoice; oldInvoiceNumber: string; oldAmount: number }> {
    const existing = await this.findByJobCardId(jobCardId);
    if (!existing) {
      throw new BadRequestException(`No invoice exists yet for Job Card ${jobCardId} - nothing to regenerate.`);
    }
    if (existing.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        `Invoice ${existing.invoiceNumber} is ${existing.status}, not DRAFT - only a never-paid draft invoice can be regenerated.`,
      );
    }
    const alreadyPaid = await this.getAmountPaid(existing.id);
    if (alreadyPaid > 0) {
      throw new BadRequestException(
        `Invoice ${existing.invoiceNumber} already has ${alreadyPaid} recorded against it - it cannot be regenerated. Contact Finance for a correction.`,
      );
    }

    const oldInvoiceNumber = existing.invoiceNumber;
    const oldAmount = Number(existing.amount);
    await this.invoiceRepository.remove(existing);

    const invoice = await this.getOrCreateForJobCard(jobCardId);
    return { invoice, oldInvoiceNumber, oldAmount };
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
