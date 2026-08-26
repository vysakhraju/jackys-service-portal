import { GlLedgerService } from './gl-ledger.service';
import { GlSourceType } from './entities/gl-posting.entity';
import { PaymentMethod } from '../invoicing/entities/invoice.entity';

describe('GlLedgerService', () => {
  let service: GlLedgerService;
  let glPostingRepository: any;

  beforeEach(() => {
    glPostingRepository = {
      create: jest.fn((data: any) => data),
      save: jest.fn((data: any) => Promise.resolve({ ...data, id: 'gl-1' })),
      find: jest.fn().mockResolvedValue([]),
    };
    service = new GlLedgerService(glPostingRepository);
  });

  describe('postInvoicePayment', () => {
    it('debits Cash for a CASH payment, credits Service Revenue', async () => {
      const result = await service.postInvoicePayment({
        invoiceId: 'inv-1',
        invoiceNumber: 'INV-0001',
        method: PaymentMethod.CASH,
        amount: 500,
      });

      expect(result.sourceType).toBe(GlSourceType.INVOICE_PAYMENT);
      expect(result.debitAccount).toBe('1000-CASH');
      expect(result.creditAccount).toBe('4000-SERVICE-REVENUE');
      expect(result.amount).toBe(500);
    });

    it('debits Bank for a BANK_TRANSFER payment', async () => {
      const result = await service.postInvoicePayment({
        invoiceId: 'inv-1',
        invoiceNumber: 'INV-0001',
        method: PaymentMethod.BANK_TRANSFER,
        amount: 500,
      });

      expect(result.debitAccount).toBe('1010-BANK');
    });

    it('debits Bank for a CARD payment', async () => {
      const result = await service.postInvoicePayment({
        invoiceId: 'inv-1',
        invoiceNumber: 'INV-0001',
        method: PaymentMethod.CARD,
        amount: 500,
      });

      expect(result.debitAccount).toBe('1010-BANK');
    });

    it('debits the B2B Credit AR account for a B2B_CREDIT payment', async () => {
      const result = await service.postInvoicePayment({
        invoiceId: 'inv-1',
        invoiceNumber: 'INV-0001',
        method: PaymentMethod.B2B_CREDIT,
        amount: 500,
      });

      expect(result.debitAccount).toBe('1020-AR-B2B-CREDIT');
    });
  });

  describe('postDebitNote', () => {
    it('debits the interdepartment receivable account, credits Service Revenue', async () => {
      const result = await service.postDebitNote({
        debitNoteId: 'dn-1',
        debitNoteNumber: 'DN-0001',
        amount: 150,
      });

      expect(result.sourceType).toBe(GlSourceType.DEBIT_NOTE);
      expect(result.debitAccount).toBe('1030-INTERDEPT-RECEIVABLE');
      expect(result.creditAccount).toBe('4000-SERVICE-REVENUE');
      expect(result.amount).toBe(150);
    });
  });

  describe('findAll', () => {
    it('filters by sourceType when provided', async () => {
      await service.findAll(GlSourceType.DEBIT_NOTE);

      expect(glPostingRepository.find).toHaveBeenCalledWith({
        where: { sourceType: GlSourceType.DEBIT_NOTE },
        order: { postedAt: 'DESC' },
      });
    });

    it('lists everything when no sourceType is given', async () => {
      await service.findAll();

      expect(glPostingRepository.find).toHaveBeenCalledWith({
        where: {},
        order: { postedAt: 'DESC' },
      });
    });
  });
});
