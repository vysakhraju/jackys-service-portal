import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InvoicingService } from './invoicing.service';
import { InvoiceStatus, PaymentMethod, InvoicePriceSource } from './entities/invoice.entity';
import { EstimateStatus } from '../estimates/entities/estimate.entity';
import { JobCardStatus } from '../job-cards/entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { CustomerType } from '../master-data/entities/service-price-list.entity';
import { IsNull } from 'typeorm';

describe('InvoicingService', () => {
  let service: InvoicingService;
  let invoiceRepository: any;
  let paymentRepository: any;
  let estimateRepository: any;
  let priceListRepository: any;
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

  // Super-admin pricing matrix rebuild (2026-09-25) - the matched ServicePriceList row
  // for the Price-List-baseline fallback path. customerType is now part of the row's own
  // identity (baked into the lookup) rather than a client-side branch, and there is a
  // single `price` column instead of priceB2B/priceB2C/billingChannelRate.
  const priceRow = (overrides: any = {}) =>
    ({
      id: 'price-1',
      category: 'REFRIGERATOR',
      jobType: 'REPAIR',
      customerType: CustomerType.B2C,
      price: 200,
      billingChannelId: null,
      billingChannel: null,
      warrantyLaborCost: 0,
      isActive: true,
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
      remove: jest.fn((data: any) => Promise.resolve(data)),
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
    priceListRepository = {
      findOne: jest.fn(),
    };
    jobCardsService = {
      findById: jest.fn(),
    };
    glLedgerService = {
      postInvoicePayment: jest.fn().mockResolvedValue({}),
      postDebitNote: jest.fn().mockResolvedValue({}),
    };

    service = new InvoicingService(
      invoiceRepository,
      paymentRepository,
      estimateRepository,
      priceListRepository,
      jobCardsService,
      glLedgerService,
    );
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

    // Super-admin pricing matrix rebuild (2026-09-25): the real gap this closes - an OOW
    // Job Card can reach QC_PASSED via the FR-06 manual approve-customer stopgap with no
    // Estimate ever created. Invoice generation falls back to the Price List baseline
    // instead of hard-blocking; an approved Estimate, when one exists, still always
    // overrides it (covered by the existing tests above/below). customerType is now baked
    // into the Price List lookup itself (resolvePriceListRow), so there's no more
    // client-side B2B/B2C branch to test - only "which row comes back" and "no row / no
    // channel row -> throw".
    describe('Price List baseline fallback (no approved Estimate exists)', () => {
      it('resolves the plain (no Billing Channel picked) row for a B2C job with no approved Estimate', async () => {
        invoiceRepository.findOne.mockResolvedValue(null);
        jobCardsService.findById.mockResolvedValue(
          jobCard({
            appointment: {
              customerType: CustomerType.B2C,
              jobType: 'REPAIR',
              serviceCentre: { vatRate: 5 },
              applianceModel: { category: 'REFRIGERATOR' },
            },
          }),
        );
        estimateRepository.find.mockResolvedValue([]);
        priceListRepository.findOne.mockResolvedValue(priceRow({ customerType: CustomerType.B2C, price: 200 }));
        queryBuilder.getOne.mockResolvedValue(null);

        const result = await service.getOrCreateForJobCard('jc-1');

        expect(priceListRepository.findOne).toHaveBeenCalledWith({
          where: { category: 'REFRIGERATOR', jobType: 'REPAIR', customerType: CustomerType.B2C, billingChannelId: IsNull(), isActive: true },
          relations: { billingChannel: true },
        });
        expect(result.subtotal).toBe(200);
        expect(result.vatAmount).toBe(10);
        expect(result.amount).toBe(210);
        expect(result.priceSource).toBe(InvoicePriceSource.PRICE_LIST_BASELINE);
        expect(result.sourceEstimateId).toBeNull();
        expect(result.billingChannelId).toBeNull();
      });

      it('resolves the plain row for a B2B job with no approved Estimate', async () => {
        invoiceRepository.findOne.mockResolvedValue(null);
        jobCardsService.findById.mockResolvedValue(
          jobCard({
            appointment: {
              customerType: CustomerType.B2B,
              jobType: 'REPAIR',
              serviceCentre: { vatRate: 5 },
              applianceModel: { category: 'REFRIGERATOR' },
            },
          }),
        );
        estimateRepository.find.mockResolvedValue([]);
        priceListRepository.findOne.mockResolvedValue(priceRow({ customerType: CustomerType.B2B, price: 300 }));
        queryBuilder.getOne.mockResolvedValue(null);

        const result = await service.getOrCreateForJobCard('jc-1');

        expect(result.subtotal).toBe(300);
        expect(result.billingChannelId).toBeNull();
      });

      it('resolves the channel-specific row, and stamps the channel, for a job whose appointment has a Billing Channel picked', async () => {
        invoiceRepository.findOne.mockResolvedValue(null);
        jobCardsService.findById.mockResolvedValue(
          jobCard({
            appointment: {
              customerType: CustomerType.B2B_SALES_CHANNEL,
              jobType: 'REPAIR',
              serviceCentre: { vatRate: 5 },
              applianceModel: { category: 'REFRIGERATOR' },
              billingChannelId: 'bc-1',
              billingChannel: { id: 'bc-1', name: 'Acme Partner' },
            },
          }),
        );
        estimateRepository.find.mockResolvedValue([]);
        priceListRepository.findOne.mockResolvedValue(
          priceRow({ customerType: CustomerType.B2B_SALES_CHANNEL, price: 500, billingChannelId: 'bc-1', billingChannel: { id: 'bc-1', name: 'Acme Partner' } }),
        );
        queryBuilder.getOne.mockResolvedValue(null);

        const result = await service.getOrCreateForJobCard('jc-1');

        expect(priceListRepository.findOne).toHaveBeenCalledWith({
          where: { category: 'REFRIGERATOR', jobType: 'REPAIR', customerType: CustomerType.B2B_SALES_CHANNEL, billingChannelId: 'bc-1', isActive: true },
          relations: { billingChannel: true },
        });
        expect(result.subtotal).toBe(500);
        expect(result.billingChannelId).toBe('bc-1');
        expect(result.billingChannelName).toBe('Acme Partner');
      });

      it('applies a picked Billing Channel for a plain B2C job too - channel routing is not gated on customerType', async () => {
        invoiceRepository.findOne.mockResolvedValue(null);
        jobCardsService.findById.mockResolvedValue(
          jobCard({
            appointment: {
              customerType: CustomerType.B2C,
              jobType: 'REPAIR',
              serviceCentre: { vatRate: 5 },
              applianceModel: { category: 'REFRIGERATOR' },
              billingChannelId: 'bc-jer-c',
              billingChannel: { id: 'bc-jer-c', name: 'JER-C' },
            },
          }),
        );
        estimateRepository.find.mockResolvedValue([]);
        priceListRepository.findOne.mockResolvedValue(
          priceRow({ customerType: CustomerType.B2C, price: 55, billingChannelId: 'bc-jer-c', billingChannel: { id: 'bc-jer-c', name: 'JER-C' } }),
        );
        queryBuilder.getOne.mockResolvedValue(null);

        const result = await service.getOrCreateForJobCard('jc-1');

        expect(result.subtotal).toBe(55);
      });

      it("throws when the appointment picks a Billing Channel with no matching Price List row, rather than silently billing the plain price (the JER-C AED 0.00 bug)", async () => {
        invoiceRepository.findOne.mockResolvedValue(null);
        jobCardsService.findById.mockResolvedValue(
          jobCard({
            appointment: {
              customerType: CustomerType.B2B,
              jobType: 'REPAIR',
              serviceCentre: { vatRate: 5 },
              applianceModel: { category: 'REFRIGERATOR' },
              billingChannelId: 'bc-jer-c',
              billingChannel: { id: 'bc-jer-c', name: 'JER-C' },
            },
          }),
        );
        estimateRepository.find.mockResolvedValue([]);
        priceListRepository.findOne.mockResolvedValue(null);

        await expect(service.getOrCreateForJobCard('jc-1')).rejects.toThrow(BadRequestException);
        await expect(service.getOrCreateForJobCard('jc-1')).rejects.toThrow(/JER-C/);
      });

      it('throws when the appointment has no Appliance Model / Category linked, rather than silently inventing a price', async () => {
        invoiceRepository.findOne.mockResolvedValue(null);
        jobCardsService.findById.mockResolvedValue(
          jobCard({ appointment: { customerType: CustomerType.B2C, serviceCentre: { vatRate: 5 }, applianceModel: null } }),
        );
        estimateRepository.find.mockResolvedValue([]);

        await expect(service.getOrCreateForJobCard('jc-1')).rejects.toThrow(BadRequestException);
        expect(priceListRepository.findOne).not.toHaveBeenCalled();
      });

      it('throws when no active Price List row matches the category/jobType/customerType', async () => {
        invoiceRepository.findOne.mockResolvedValue(null);
        jobCardsService.findById.mockResolvedValue(
          jobCard({
            appointment: {
              customerType: CustomerType.B2C,
              jobType: 'REPAIR',
              serviceCentre: { vatRate: 5 },
              applianceModel: { category: 'REFRIGERATOR' },
            },
          }),
        );
        estimateRepository.find.mockResolvedValue([]);
        priceListRepository.findOne.mockResolvedValue(null);

        await expect(service.getOrCreateForJobCard('jc-1')).rejects.toThrow(BadRequestException);
      });
    });

    // Phase 11 (2026-09-24, billing verification for the Job Type split's Installation/
    // Delivery Installation flow) - a COMPLETED Job Card never goes through QC/Estimates
    // at all, and its category/jobType come from its own line items rather than a single
    // appointment-level Appliance Model (Phase 6 hides that field for these job types).
    describe('COMPLETED (ERP-sourced) Job Card line-item pricing', () => {
      const activityLineItem = (overrides: any = {}) =>
        ({
          applianceModelId: 'model-1',
          applianceModel: { id: 'model-1', brand: 'LG', model: 'GR-B247', category: 'REFRIGERATOR' },
          jobType: 'INSTALLATION',
          quantity: 1,
          finished: true,
          ...overrides,
        } as any);

      const activityJobCard = (overrides: any = {}) =>
        jobCard({
          status: JobCardStatus.COMPLETED,
          warrantyStatus: null,
          erpReferenceNumber: 'ERP-2026-04512',
          appointment: { customerType: CustomerType.B2C, jobType: 'INSTALLATION', serviceCentre: { vatRate: 5 } },
          activityLineItems: [activityLineItem()],
          ...overrides,
        });

      it('skips the QC/warranty gate entirely for a COMPLETED Job Card', async () => {
        invoiceRepository.findOne.mockResolvedValue(null);
        jobCardsService.findById.mockResolvedValue(activityJobCard());
        priceListRepository.findOne.mockResolvedValue(priceRow({ category: 'REFRIGERATOR', jobType: 'INSTALLATION', customerType: CustomerType.B2C, price: 400 }));
        queryBuilder.getOne.mockResolvedValue(null);

        const result = await service.getOrCreateForJobCard('jc-1');

        expect(result.subtotal).toBe(400);
        expect(estimateRepository.find).not.toHaveBeenCalled();
      });

      it('prices a single-line-item B2C job off that line\'s own category/jobType and quantity, tagged ACTIVITY_LINE_ITEMS', async () => {
        invoiceRepository.findOne.mockResolvedValue(null);
        jobCardsService.findById.mockResolvedValue(
          activityJobCard({ activityLineItems: [activityLineItem({ quantity: 2 })] }),
        );
        priceListRepository.findOne.mockResolvedValue(priceRow({ category: 'REFRIGERATOR', jobType: 'INSTALLATION', customerType: CustomerType.B2C, price: 400 }));
        queryBuilder.getOne.mockResolvedValue(null);

        const result = await service.getOrCreateForJobCard('jc-1');

        expect(result.subtotal).toBe(800);
        expect(result.vatAmount).toBe(40);
        expect(result.amount).toBe(840);
        expect(result.priceSource).toBe(InvoicePriceSource.ACTIVITY_LINE_ITEMS);
        expect(result.lineItemsBreakdown).toEqual([
          expect.objectContaining({ applianceModelId: 'model-1', category: 'REFRIGERATOR', jobType: 'INSTALLATION', quantity: 2, unitPrice: 400, lineTotal: 800 }),
        ]);
      });

      it('sums several line items with different categories/job types into one invoice', async () => {
        invoiceRepository.findOne.mockResolvedValue(null);
        jobCardsService.findById.mockResolvedValue(
          activityJobCard({
            activityLineItems: [
              activityLineItem({ applianceModelId: 'model-1', applianceModel: { id: 'model-1', brand: 'LG', model: 'GR-B247', category: 'REFRIGERATOR' }, jobType: 'INSTALLATION', quantity: 2 }),
              activityLineItem({ applianceModelId: 'model-2', applianceModel: { id: 'model-2', brand: 'Samsung', model: 'WW90', category: 'WASHING_MACHINE' }, jobType: 'DELIVERY_INSTALLATION', quantity: 1 }),
            ],
          }),
        );
        priceListRepository.findOne
          .mockResolvedValueOnce(priceRow({ category: 'REFRIGERATOR', jobType: 'INSTALLATION', customerType: CustomerType.B2C, price: 400 }))
          .mockResolvedValueOnce(priceRow({ category: 'WASHING_MACHINE', jobType: 'DELIVERY_INSTALLATION', customerType: CustomerType.B2C, price: 250 }));
        queryBuilder.getOne.mockResolvedValue(null);

        const result = await service.getOrCreateForJobCard('jc-1');

        // 2 x 400 (fridge installs) + 1 x 250 (washer delivery+install) = 1050
        expect(result.subtotal).toBe(1050);
        expect(result.lineItemsBreakdown).toHaveLength(2);
      });

      it('resolves the channel-specific row per line for a B2B_SALES_CHANNEL job whose appointment has a Billing Channel picked', async () => {
        invoiceRepository.findOne.mockResolvedValue(null);
        jobCardsService.findById.mockResolvedValue(
          activityJobCard({
            appointment: {
              customerType: CustomerType.B2B_SALES_CHANNEL,
              jobType: 'INSTALLATION',
              serviceCentre: { vatRate: 5 },
              billingChannelId: 'bc-1',
              billingChannel: { id: 'bc-1', name: 'Acme Partner' },
            },
          }),
        );
        priceListRepository.findOne.mockResolvedValue(
          priceRow({ category: 'REFRIGERATOR', jobType: 'INSTALLATION', customerType: CustomerType.B2B_SALES_CHANNEL, price: 500, billingChannelId: 'bc-1', billingChannel: { id: 'bc-1', name: 'Acme Partner' } }),
        );
        queryBuilder.getOne.mockResolvedValue(null);

        const result = await service.getOrCreateForJobCard('jc-1');

        expect(result.subtotal).toBe(500);
        expect(result.billingChannelId).toBe('bc-1');
        expect(result.billingChannelName).toBe('Acme Partner');
      });

      it('rejects a COMPLETED Job Card with zero line items - a data-integrity gap, not a normal state', async () => {
        invoiceRepository.findOne.mockResolvedValue(null);
        jobCardsService.findById.mockResolvedValue(activityJobCard({ activityLineItems: [] }));

        await expect(service.getOrCreateForJobCard('jc-1')).rejects.toThrow(BadRequestException);
        expect(priceListRepository.findOne).not.toHaveBeenCalled();
      });

      it('throws, naming the line, when a line item\'s Appliance Model has no Category set', async () => {
        invoiceRepository.findOne.mockResolvedValue(null);
        jobCardsService.findById.mockResolvedValue(
          activityJobCard({ activityLineItems: [activityLineItem({ applianceModel: { id: 'model-1', brand: 'LG', model: 'GR-B247', category: null } })] }),
        );

        await expect(service.getOrCreateForJobCard('jc-1')).rejects.toThrow(BadRequestException);
      });

      it('throws, naming the job card, when no active Price List row matches a line\'s category/jobType/customerType', async () => {
        invoiceRepository.findOne.mockResolvedValue(null);
        jobCardsService.findById.mockResolvedValue(activityJobCard());
        priceListRepository.findOne.mockResolvedValue(null);

        await expect(service.getOrCreateForJobCard('jc-1')).rejects.toThrow(BadRequestException);
        await expect(service.getOrCreateForJobCard('jc-1')).rejects.toThrow(/JC-0001/);
      });
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
      // Approved Estimate always overrides the Price List baseline - the locked
      // "billing tiebreaker" decision (Phase 4). The baseline path is never even
      // consulted when an approved Estimate exists.
      expect(result.priceSource).toBe(InvoicePriceSource.ESTIMATE);
      expect(result.sourceEstimateId).toBe('est-1');
      expect(priceListRepository.findOne).not.toHaveBeenCalled();
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

  describe('regenerateDraftInvoice', () => {
    it('throws when no invoice exists yet for the Job Card', async () => {
      invoiceRepository.findOne.mockResolvedValue(null);

      await expect(service.regenerateDraftInvoice('jc-1', 'user-1')).rejects.toThrow(BadRequestException);
      expect(invoiceRepository.remove).not.toHaveBeenCalled();
    });

    it('throws when the invoice is not DRAFT (PAID/PARTIALLY_PAID/CANCELLED are all frozen)', async () => {
      invoiceRepository.findOne.mockResolvedValue(invoice({ status: InvoiceStatus.PARTIALLY_PAID }));

      await expect(service.regenerateDraftInvoice('jc-1', 'user-1')).rejects.toThrow(BadRequestException);
      expect(invoiceRepository.remove).not.toHaveBeenCalled();
    });

    it('throws when any payment has already been recorded, even if the status is still (stale) DRAFT', async () => {
      invoiceRepository.findOne.mockResolvedValue(invoice({ status: InvoiceStatus.DRAFT }));
      paymentRepository.find.mockResolvedValue([payment({ amount: 50 })]);

      await expect(service.regenerateDraftInvoice('jc-1', 'user-1')).rejects.toThrow(BadRequestException);
      expect(invoiceRepository.remove).not.toHaveBeenCalled();
    });

    it('deletes the stale never-paid DRAFT and recreates it from current master data under a new invoice number (the JER-C AED 0.00 fix)', async () => {
      const stale = invoice({ id: 'inv-1', invoiceNumber: 'INV-0001', amount: 0, status: InvoiceStatus.DRAFT });
      invoiceRepository.findOne
        .mockResolvedValueOnce(stale) // findByJobCardId inside regenerateDraftInvoice
        .mockResolvedValueOnce(null); // findByJobCardId inside the getOrCreateForJobCard it calls next
      paymentRepository.find.mockResolvedValue([]);
      jobCardsService.findById.mockResolvedValue(
        jobCard({
          appointment: {
            customerType: CustomerType.B2B,
            jobType: 'INSTALLATION',
            serviceCentre: { vatRate: 5 },
            applianceModel: { category: 'REFRIGERATOR' },
            billingChannelId: 'bc-jer-c',
            billingChannel: { id: 'bc-jer-c', name: 'JER-C' },
          },
        }),
      );
      estimateRepository.find.mockResolvedValue([]);
      priceListRepository.findOne.mockResolvedValue(
        priceRow({ jobType: 'INSTALLATION', customerType: CustomerType.B2B, price: 55, billingChannelId: 'bc-jer-c', billingChannel: { id: 'bc-jer-c', name: 'JER-C' } }),
      );
      queryBuilder.getOne.mockResolvedValue(invoice({ invoiceNumber: 'INV-0001' }));

      const result = await service.regenerateDraftInvoice('jc-1', 'user-1');

      expect(invoiceRepository.remove).toHaveBeenCalledWith(stale);
      expect(result.oldInvoiceNumber).toBe('INV-0001');
      expect(result.oldAmount).toBe(0);
      expect(result.invoice.invoiceNumber).toBe('INV-0002');
      expect(result.invoice.subtotal).toBe(55);
      expect(result.invoice.billingChannelId).toBe('bc-jer-c');
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
