import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InvoicingService } from './invoicing.service';
import { InvoiceStatus, PaymentMethod } from './entities/invoice.entity';
import { EstimateStatus } from '../estimates/entities/estimate.entity';
import { JobCardStatus } from '../job-cards/entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { CustomerType } from '../appointments/entities/appointment.entity';

describe('InvoicingService', () => {
  let service: InvoicingService;
  let invoiceRepository: any;
  let paymentRepository: any;
  let estimateRepository: any;
  let jobCardsService: any;
  let glLedgerService: any;
  let queryBuilder: any;

  const invoice = (overrides: any = {}) =>
    ({
      id: 'inv-1',
      invoiceNumber: 'INV-0001',
      jobCardId: 'jc-1',
      amount: 1500,
      subtotal: 1428.57,
      vatRate: 5,
      vatAmount: 71.43,
      dueDate: new Date('2026-09-01'),
      status: InvoiceStatus.DRAFT,
      paymentMethod: null,
      amountReceived: null,
      paymentReference: null,
      paidAt: null,
      recordedByUserId: null,
      createdAt: new Date('2026-08-01'),
      ...overrides,
    } as any);

  const jobCard = (overrides: any = {}) =>
    ({
      id: 'jc-1',
      jobCardNumber: 'JC-0001',
      status: JobCardStatus.QC_PASSED,
      warrantyStatus: WarrantyStatus.OUT_OF_WARRANTY,
      appointment: { customerType: CustomerType.B2C, serviceCentre: { vatRate: 5 } },
      ...overrides,
    } as any);

  const approvedEstimate = (overrides: any = {}) =>
    ({
      id: 'est-1',
      jobCardId: 'jc-1',
      status: EstimateStatus.APPROVED,
      subtotal: 1428.57,
      vatAmount: 71.43,
      totalAmount: 1500,
      createdAt: new Date('2026-08-01'),
      ...overrides,
    } as any);

  const payment = (overrides: any = {}) =>
    ({
      id: 'pay-1',
      invoiceId: 'inv-1',
      method: PaymentMethod.CASH,
      amount: 500,
      reference: null,
      recordedByUserId: 'user-1',
      recordedAt: new Date('2026-08-02'),
      ...overrides,
    } as any);

  beforeEach(() => {
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    invoiceRepository = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((data: any) => data),
      save: jest.fn((data: any) => Promise.resolve({ ...data, id: data.id || 'inv-1' })),
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    paymentRepository = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((data: any) => data),
      save: jest.fn((data: any) => Promise.resolve({ ...data, id: data.id || 'pay-1' })),
    };
    estimateRepository = {
      find: jest.fn(),
    };
    jobCardsService = {
      findById: jest.fn(),
    };
    glLedgerService = {
      postInvoicePayment: jest.fn().mockResolvedValue({}),
      postDebitNote: jest.fn().mockResolvedValue({}),
    };

    service = new InvoicingService(invoiceRepository, paymentRepository, estimateRepository, jobCardsService, glLedgerService);
  });

  describe('findById', () => {
    it('returns the invoice when found', async () => {
      invoiceRepository.findOne.mockResolvedValue(invoice());

      const result = await service.findById('inv-1');

      expect(result.id).toBe('inv-1');
    });

    it('throws NotFoundException when missing', async () => {
      invoiceRepository.findOne.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByJobCardId', () => {
    it('returns null when no invoice exists yet for the job card', async () => {
      invoiceRepository.findOne.mockResolvedValue(null);

      const result = await service.findByJobCardId('jc-1');

      expect(result).toBeNull();
    });
  });

  describe('getAmountPaid / findPayments', () => {
    it('sums all payment amounts for the invoice', async () => {
      paymentRepository.find.mockResolvedValue([payment({ amount: 500 }), payment({ id: 'pay-2', amount: 300 })]);

      const result = await service.getAmountPaid('inv-1');

      expect(result).toBe(800);
    });

    it('returns 0 when no payments exist yet', async () => {
      paymentRepository.find.mockResolvedValue([]);

      const result = await service.getAmountPaid('inv-1');

      expect(result).toBe(0);
    });

    it('findPayments 404s for an unknown invoice before touching the payment table', async () => {
      invoiceRepository.findOne.mockResolvedValue(null);

      await expect(service.findPayments('missing')).rejects.toThrow(NotFoundException);
      expect(paymentRepository.find).not.toHaveBeenCalled();
    });

    it('findPayments returns the oldest-first payment history for a known invoice', async () => {
      invoiceRepository.findOne.mockResolvedValue(invoice());
      paymentRepository.find.mockResolvedValue([payment()]);

      const result = await service.findPayments('inv-1');

      expect(result).toHaveLength(1);
      expect(paymentRepository.find).toHaveBeenCalledWith({ where: { invoiceId: 'inv-1' }, order: { recordedAt: 'ASC' } });
    });
  });

  describe('getOrCreateForJobCard', () => {
    it('returns the existing invoice without touching the estimate table', async () => {
      invoiceRepository.findOne.mockResolvedValue(invoice());

      const result = await service.getOrCreateForJobCard('jc-1');

      expect(result.id).toBe('inv-1');
      expect(estimateRepository.find).not.toHaveBeenCalled();
    });

    it('rejects a Job Card that has not passed QC yet', async () => {
      invoiceRepository.findOne.mockResolvedValue(null);
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS }));

      await expect(service.getOrCreateForJobCard('jc-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects an in-warranty Job Card - nothing to invoice', async () => {
      invoiceRepository.findOne.mockResolvedValue(null);
      jobCardsService.findById.mockResolvedValue(jobCard({ warrantyStatus: WarrantyStatus.IN_WARRANTY }));

      await expect(service.getOrCreateForJobCard('jc-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects when no approved Estimate exists', async () => {
      invoiceRepository.findOne.mockResolvedValue(null);
      jobCardsService.findById.mockResolvedValue(jobCard());
      estimateRepository.find.mockResolvedValue([]);

      await expect(service.getOrCreateForJobCard('jc-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects (data integrity error) when more than one approved Estimate exists', async () => {
      invoiceRepository.findOne.mockResolvedValue(null);
      jobCardsService.findById.mockResolvedValue(jobCard());
      estimateRepository.find.mockResolvedValue([approvedEstimate({ id: 'est-1' }), approvedEstimate({ id: 'est-2' })]);

      await expect(service.getOrCreateForJobCard('jc-1')).rejects.toThrow(BadRequestException);
    });

    it('creates a DRAFT invoice snapshotting the approved Estimate totals (VAT breakdown included) and a generated INV-#### number', async () => {
      invoiceRepository.findOne.mockResolvedValue(null);
      jobCardsService.findById.mockResolvedValue(jobCard());
      estimateRepository.find.mockResolvedValue([approvedEstimate({ subtotal: 2333.33, vatAmount: 116.67, totalAmount: 2450 })]);
      queryBuilder.getOne.mockResolvedValue(null);

      const result = await service.getOrCreateForJobCard('jc-1');

      expect(result.invoiceNumber).toBe('INV-0001');
      expect(result.amount).toBe(2450);
      expect(result.subtotal).toBe(2333.33);
      expect(result.vatAmount).toBe(116.67);
      expect(result.vatRate).toBe(5);
      expect(result.status).toBe(InvoiceStatus.DRAFT);
      expect(result.jobCardId).toBe('jc-1');
      expect(result.dueDate).toBeInstanceOf(Date);
    });

    it('falls back to a 5% vatRate when the Service Centre has none on record', async () => {
      invoiceRepository.findOne.mockResolvedValue(null);
      jobCardsService.findById.mockResolvedValue(jobCard({ appointment: { customerType: CustomerType.B2C, serviceCentre: {} } }));
      estimateRepository.find.mockResolvedValue([approvedEstimate()]);
      queryBuilder.getOne.mockResolvedValue(null);

      const result = await service.getOrCreateForJobCard('jc-1');

      expect(result.vatRate).toBe(5);
    });

    it('increments the sequence off the highest existing INV-####', async () => {
      invoiceRepository.findOne.mockResolvedValue(null);
      jobCardsService.findById.mockResolvedValue(jobCard());
      estimateRepository.find.mockResolvedValue([approvedEstimate()]);
      queryBuilder.getOne.mockResolvedValue(invoice({ invoiceNumber: 'INV-0007' }));

      const result = await service.getOrCreateForJobCard('jc-1');

      expect(result.invoiceNumber).toBe('INV-0008');
    });

    it('race safety: a unique-constraint violation on save is treated as "someone else already created it" and refetches', async () => {
      invoiceRepository.findOne
        .mockResolvedValueOnce(null) // first check: none exists yet
        .mockResolvedValueOnce(invoice({ id: 'inv-winner' })); // refetch after the race loss
      jobCardsService.findById.mockResolvedValue(jobCard());
      estimateRepository.find.mockResolvedValue([approvedEstimate()]);
      queryBuilder.getOne.mockResolvedValue(null);
      invoiceRepository.save.mockRejectedValueOnce({ code: '23505' });

      const result = await service.getOrCreateForJobCard('jc-1');

      expect(result.id).toBe('inv-winner');
    });

    it('re-throws a non-unique-constraint save error', async () => {
      invoiceRepository.findOne.mockResolvedValue(null);
      jobCardsService.findById.mockResolvedValue(jobCard());
      estimateRepository.find.mockResolvedValue([approvedEstimate()]);
      queryBuilder.getOne.mockResolvedValue(null);
      invoiceRepository.save.mockRejectedValueOnce(new Error('connection lost'));

      await expect(service.getOrCreateForJobCard('jc-1')).rejects.toThrow('connection lost');
    });
  });

  describe('recordPayment', () => {
    it('rejects recording payment against an already fully-PAID invoice', async () => {
      invoiceRepository.findOne.mockResolvedValue(invoice({ status: InvoiceStatus.PAID }));

      await expect(service.recordPayment('inv-1', PaymentMethod.CASH, 1500, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects recording payment against a CANCELLED invoice', async () => {
      invoiceRepository.findOne.mockResolvedValue(invoice({ status: InvoiceStatus.CANCELLED }));

      await expect(service.recordPayment('inv-1', PaymentMethod.CASH, 1500, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects B2B_CREDIT for a non-B2B customer (closes the payment-bypass loophole)', async () => {
      invoiceRepository.findOne.mockResolvedValue(invoice());
      jobCardsService.findById.mockResolvedValue(jobCard({ appointment: { customerType: CustomerType.B2C } }));

      await expect(service.recordPayment('inv-1', PaymentMethod.B2B_CREDIT, 1500, 'user-1')).rejects.toThrow(ForbiddenException);
    });

    it('allows B2B_CREDIT for an actual B2B customer', async () => {
      invoiceRepository.findOne.mockResolvedValue(invoice());
      jobCardsService.findById.mockResolvedValue(jobCard({ appointment: { customerType: CustomerType.B2B } }));

      const result = await service.recordPayment('inv-1', PaymentMethod.B2B_CREDIT, 1500, 'user-1');

      expect(result.status).toBe(InvoiceStatus.PAID);
      expect(result.paymentMethod).toBe(PaymentMethod.B2B_CREDIT);
    });

    it('rejects an amount that exceeds the remaining balance (no overpayment)', async () => {
      invoiceRepository.findOne.mockResolvedValue(invoice({ amount: 1500 }));
      paymentRepository.find.mockResolvedValue([payment({ amount: 1000 })]);

      await expect(service.recordPayment('inv-1', PaymentMethod.CASH, 600, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('records a full Cash payment and marks the invoice PAID, posting a GL entry', async () => {
      invoiceRepository.findOne.mockResolvedValue(invoice({ amount: 1500 }));
      paymentRepository.find.mockResolvedValue([]);

      const result = await service.recordPayment('inv-1', PaymentMethod.CASH, 1500, 'user-1', 'receipt-99');

      expect(result.status).toBe(InvoiceStatus.PAID);
      expect(result.paymentMethod).toBe(PaymentMethod.CASH);
      expect(result.amountReceived).toBe(1500);
      expect(result.paymentReference).toBe('receipt-99');
      expect(result.recordedByUserId).toBe('user-1');
      expect(result.paidAt).toBeInstanceOf(Date);
      expect(paymentRepository.save).toHaveBeenCalled();
      expect(glLedgerService.postInvoicePayment).toHaveBeenCalledWith(
        expect.objectContaining({ invoiceId: 'inv-1', method: PaymentMethod.CASH, amount: 1500 }),
      );
    });

    it('records a partial payment, leaving the invoice PARTIALLY_PAID', async () => {
      invoiceRepository.findOne.mockResolvedValue(invoice({ amount: 1500 }));
      paymentRepository.find.mockResolvedValue([]);

      const result = await service.recordPayment('inv-1', PaymentMethod.CASH, 500, 'user-1');

      expect(result.status).toBe(InvoiceStatus.PARTIALLY_PAID);
    });

    it('a second partial payment that completes the balance marks the invoice PAID', async () => {
      invoiceRepository.findOne.mockResolvedValue(invoice({ amount: 1500, status: InvoiceStatus.PARTIALLY_PAID }));
      paymentRepository.find.mockResolvedValue([payment({ amount: 500 })]);

      const result = await service.recordPayment('inv-1', PaymentMethod.CASH, 1000, 'user-1');

      expect(result.status).toBe(InvoiceStatus.PAID);
    });
  });

  describe('isPayableForDelivery', () => {
    it('is payable when the invoice is PAID', async () => {
      invoiceRepository.findOne.mockResolvedValue(invoice({ status: InvoiceStatus.PAID }));

      const result = await service.isPayableForDelivery('jc-1');

      expect(result.payable).toBe(true);
    });

    it('is not payable while the invoice is still DRAFT', async () => {
      invoiceRepository.findOne.mockResolvedValue(invoice({ status: InvoiceStatus.DRAFT }));

      const result = await service.isPayableForDelivery('jc-1');

      expect(result.payable).toBe(false);
    });

    it('is not payable while PARTIALLY_PAID', async () => {
      invoiceRepository.findOne.mockResolvedValue(invoice({ status: InvoiceStatus.PARTIALLY_PAID }));

      const result = await service.isPayableForDelivery('jc-1');

      expect(result.payable).toBe(false);
    });
  });

  describe('getB2bAgingReport', () => {
    it('buckets an outstanding B2B invoice by days past its dueDate', async () => {
      const overdueInvoice = invoice({
        id: 'inv-b2b',
        amount: 1000,
        dueDate: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        status: InvoiceStatus.DRAFT,
        jobCard: { appointment: { customerType: CustomerType.B2B } },
      } as any);
      invoiceRepository.find.mockResolvedValue([overdueInvoice]);
      paymentRepository.find.mockResolvedValue([]);

      const result = await service.getB2bAgingReport();

      const bucket31to60 = result.buckets.find((b) => b.label === '31-60 days');
      expect(bucket31to60?.invoices).toHaveLength(1);
      expect(bucket31to60?.totalOutstanding).toBe(1000);
      expect(result.totalOutstanding).toBe(1000);
    });

    it('excludes non-B2B invoices from the report', async () => {
      const b2cInvoice = invoice({
        amount: 1000,
        jobCard: { appointment: { customerType: CustomerType.B2C } },
      } as any);
      invoiceRepository.find.mockResolvedValue([b2cInvoice]);
      paymentRepository.find.mockResolvedValue([]);

      const result = await service.getB2bAgingReport();

      expect(result.totalOutstanding).toBe(0);
    });

    it('excludes an invoice that is already fully paid off', async () => {
      const fullyPaidInvoice = invoice({
        amount: 1000,
        jobCard: { appointment: { customerType: CustomerType.B2B } },
      } as any);
      invoiceRepository.find.mockResolvedValue([fullyPaidInvoice]);
      paymentRepository.find.mockResolvedValue([payment({ amount: 1000 })]);

      const result = await service.getB2bAgingReport();

      expect(result.totalOutstanding).toBe(0);
    });
  });
});
