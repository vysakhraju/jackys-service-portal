import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GlPosting, GlSourceType } from './entities/gl-posting.entity';
import { PaymentMethod } from '../invoicing/entities/invoice.entity';

// Fixed account-code constants - see the entity's doc comment for why these are strings
// rather than rows in a real chart-of-accounts table (none exists yet).
const ACCOUNTS = {
  CASH: '1000-CASH',
  BANK: '1010-BANK',
  AR_CREDIT: '1020-AR-B2B-CREDIT',
  INTERDEPT_RECEIVABLE: '1030-INTERDEPT-RECEIVABLE',
  // Phase 9 (Dismantling): the recovered spare enters live inventory as a real asset
  // (debit), against a recognized-income credit - the appliance it came from was already
  // fully written off in Damage Location, so this value is newly realized, not a
  // transfer between two existing balances.
  INVENTORY_SPARES: '1040-INVENTORY-SPARES',
  SERVICE_REVENUE: '4000-SERVICE-REVENUE',
  DISMANTLING_RECOVERY_INCOME: '4010-DISMANTLING-RECOVERY',
  // Backend Phase 12 (Warranty Claims): account pairing follows the BRD's own literal
  // wording ("Debit Vendor Payable, Credit Warranty Recovery Account") rather than a
  // textbook-correct receivable/recovery pairing - same simplified-journal-entry
  // convention every other posting in this file already uses.
  VENDOR_PAYABLE: '2000-VENDOR-PAYABLE',
  WARRANTY_RECOVERY_INCOME: '4020-WARRANTY-RECOVERY',
};

function debitAccountForPaymentMethod(method: PaymentMethod): string {
  switch (method) {
    case PaymentMethod.CASH:
      return ACCOUNTS.CASH;
    case PaymentMethod.CARD:
    case PaymentMethod.BANK_TRANSFER:
      return ACCOUNTS.BANK;
    case PaymentMethod.B2B_CREDIT:
      return ACCOUNTS.AR_CREDIT;
    default:
      return ACCOUNTS.BANK;
  }
}

@Injectable()
export class GlLedgerService {
  constructor(
    @InjectRepository(GlPosting) private glPostingRepository: Repository<GlPosting>,
  ) {}

  /** Called by InvoicingService whenever a payment brings an invoice's balance to zero or
   * partially reduces it - one posting per payment, not one per invoice, so partial
   * payments show up as separate, individually-traceable journal lines. */
  async postInvoicePayment(params: {
    invoiceId: string;
    invoiceNumber: string;
    method: PaymentMethod;
    amount: number;
  }): Promise<GlPosting> {
    const posting = this.glPostingRepository.create({
      sourceType: GlSourceType.INVOICE_PAYMENT,
      sourceId: params.invoiceId,
      description: `Payment received for ${params.invoiceNumber} (${params.method})`,
      debitAccount: debitAccountForPaymentMethod(params.method),
      creditAccount: ACCOUNTS.SERVICE_REVENUE,
      amount: params.amount,
    });
    return this.glPostingRepository.save(posting);
  }

  /** Called by DebitNotesService.post() - one posting per debit note. */
  async postDebitNote(params: {
    debitNoteId: string;
    debitNoteNumber: string;
    amount: number;
  }): Promise<GlPosting> {
    const posting = this.glPostingRepository.create({
      sourceType: GlSourceType.DEBIT_NOTE,
      sourceId: params.debitNoteId,
      description: `Interdepartment recharge posted for ${params.debitNoteNumber}`,
      debitAccount: ACCOUNTS.INTERDEPT_RECEIVABLE,
      creditAccount: ACCOUNTS.SERVICE_REVENUE,
      amount: params.amount,
    });
    return this.glPostingRepository.save(posting);
  }

  /** Called by DismantlingService.priceAndPost() - one posting per DismantlingRecord,
   * for the total recovered value across every converted component (AC-30). */
  async postDismantlingRecovery(params: {
    dismantlingRecordId: string;
    recordNumber: string;
    amount: number;
  }): Promise<GlPosting> {
    const posting = this.glPostingRepository.create({
      sourceType: GlSourceType.DISMANTLING_RECOVERY,
      sourceId: params.dismantlingRecordId,
      description: `Recovered component value posted for ${params.recordNumber}`,
      debitAccount: ACCOUNTS.INVENTORY_SPARES,
      creditAccount: ACCOUNTS.DISMANTLING_RECOVERY_INCOME,
      amount: params.amount,
    });
    return this.glPostingRepository.save(posting);
  }

  /** Called by WarrantyClaimsService.recordCreditNote() - one posting per WarrantyClaim,
   * when its vendor credit note is recorded (BRD 12.4). */
  async postWarrantyCreditNote(params: {
    warrantyClaimId: string;
    claimNumber: string;
    amount: number;
  }): Promise<GlPosting> {
    const posting = this.glPostingRepository.create({
      sourceType: GlSourceType.WARRANTY_CLAIM_CREDIT,
      sourceId: params.warrantyClaimId,
      description: `Vendor credit note received for ${params.claimNumber}`,
      debitAccount: ACCOUNTS.VENDOR_PAYABLE,
      creditAccount: ACCOUNTS.WARRANTY_RECOVERY_INCOME,
      amount: params.amount,
    });
    return this.glPostingRepository.save(posting);
  }

  async findAll(sourceType?: GlSourceType): Promise<GlPosting[]> {
    return this.glPostingRepository.find({
      where: sourceType ? { sourceType } : {},
      order: { postedAt: 'DESC' },
    });
  }
}
