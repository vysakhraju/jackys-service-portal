import { Injectable, NotFoundException } from '@nestjs/common';
import { JobCardsService } from '../job-cards/job-cards.service';
import { EstimatesService } from '../estimates/estimates.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { DeliveryService } from '../delivery/delivery.service';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { JobCard } from '../job-cards/entities/job-card.entity';

/**
 * EPIC-005 Customer Portal: "Track job, approve estimate, pay invoice, download job
 * card" (discovery persona). Estimate approve/reject already has its own public,
 * token-gated flow (EstimatesPublicController, Phase 4) - not duplicated here. This
 * module covers the remaining three: track, view-what's-owed ("pay invoice" - see the
 * class-level note on why this is view-only), and a consolidated download/summary view.
 *
 * Every method here is customer-facing and MUST return only what a customer should see:
 * no internal user ids, no staff notes, no audit trail detail. All three take the Job
 * Card's own publicToken (JobCard.publicToken, generated at creation - see that entity's
 * doc comment) - unknown or expired tokens are treated identically (a plain 404) so a
 * token-guessing attempt can't distinguish "wrong" from "expired".
 *
 * "Pay invoice" is deliberately NOT an online payment capture: S2 in the discovery doc
 * ("Payment gateway explicitly out of scope?") is Closed/Confirmed, and FR-14 says
 * payment is manual only (Cash/Card/Bank/Credit, recorded by staff). So this portal shows
 * the customer what they owe and its status, not a checkout flow - a real payment still
 * has to happen through a human and InvoicingController.recordPayment.
 */
@Injectable()
export class CustomerPortalService {
  constructor(
    private jobCardsService: JobCardsService,
    private estimatesService: EstimatesService,
    private invoicingService: InvoicingService,
    private deliveryService: DeliveryService,
  ) {}

  private async resolveByToken(token: string): Promise<JobCard> {
    const jobCard = await this.jobCardsService.findByPublicToken(token);
    if (!jobCard) {
      throw new NotFoundException('Tracking link not found or expired');
    }
    return jobCard;
  }

  /** Customer-safe status timeline - no internal ids, no staff notes. */
  async trackByToken(token: string): Promise<Record<string, unknown>> {
    const jobCard = await this.resolveByToken(token);
    const delivery = await this.deliveryService.findByJobCardId(jobCard.id);

    return {
      jobCardNumber: jobCard.jobCardNumber,
      brand: jobCard.brand,
      status: jobCard.status,
      warrantyStatus: jobCard.warrantyStatus,
      customerApproved: jobCard.customerApproved,
      qcApprovedAt: jobCard.qcApprovedAt,
      delivery: delivery
        ? {
            deliveryNumber: delivery.deliveryNumber,
            status: delivery.status,
            dispatchedAt: delivery.dispatchedAt,
            deliveredAt: delivery.deliveredAt,
          }
        : null,
      createdAt: jobCard.createdAt,
    };
  }

  /** View-only amount-due summary - see class doc comment for why there's no "pay now". */
  async getInvoiceByToken(token: string): Promise<Record<string, unknown>> {
    const jobCard = await this.resolveByToken(token);

    if (jobCard.warrantyStatus === WarrantyStatus.IN_WARRANTY) {
      return { applicable: false, message: 'This job is covered by warranty - there is nothing to pay.' };
    }

    const invoice = await this.invoicingService.findByJobCardId(jobCard.id);
    if (!invoice) {
      return { applicable: true, invoiceCreated: false, message: 'No invoice has been generated yet.' };
    }

    const amountPaid = await this.invoicingService.getAmountPaid(invoice.id);
    const amountDue = Math.round((Number(invoice.amount) - amountPaid) * 100) / 100;

    return {
      applicable: true,
      invoiceCreated: true,
      invoiceNumber: invoice.invoiceNumber,
      subtotal: invoice.subtotal,
      vatRate: invoice.vatRate,
      vatAmount: invoice.vatAmount,
      totalAmount: invoice.amount,
      amountPaid,
      amountDue,
      status: invoice.status,
      message: amountDue > 0 ? 'Please contact us to arrange payment - Cash, Card, or Bank Transfer.' : 'Fully paid - thank you.',
    };
  }

  /** Consolidated "download job card" view for the frontend to render as a printable
   * summary page. Combines job card + estimate (if any) + invoice (if any) + delivery
   * (if any) essentials into one payload. */
  async getSummaryByToken(token: string): Promise<Record<string, unknown>> {
    const jobCard = await this.resolveByToken(token);
    const estimates = await this.estimatesService.findByJobCardId(jobCard.id);
    const latestEstimate = estimates[0] ?? null;
    const invoiceView = await this.getInvoiceByToken(token);
    const delivery = await this.deliveryService.findByJobCardId(jobCard.id);

    return {
      jobCardNumber: jobCard.jobCardNumber,
      brand: jobCard.brand,
      faultCode: jobCard.faultCode,
      symptomCode: jobCard.symptomCode,
      status: jobCard.status,
      warrantyStatus: jobCard.warrantyStatus,
      createdAt: jobCard.createdAt,
      estimate: latestEstimate
        ? {
            lineItems: latestEstimate.lineItems,
            subtotal: latestEstimate.subtotal,
            vatAmount: latestEstimate.vatAmount,
            totalAmount: latestEstimate.totalAmount,
            status: latestEstimate.status,
          }
        : null,
      invoice: invoiceView,
      delivery: delivery
        ? { deliveryNumber: delivery.deliveryNumber, status: delivery.status, deliveredAt: delivery.deliveredAt }
        : null,
    };
  }
}
