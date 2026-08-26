import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AmcService } from './amc.service';
import { AmcContractStatus, VisitFrequency, AmcPaymentTerms, CoverageType } from './entities/amc-contract.entity';
import { AmcBillingStatus } from './entities/amc-billing-invoice.entity';
import { AppointmentStatus, AppointmentType, CustomerType } from '../appointments/entities/appointment.entity';
import { PaymentMethod } from '../invoicing/entities/invoice.entity';
import { EstimateStatus } from '../estimates/entities/estimate.entity';

describe('AmcService', () => {
  let service: AmcService;
  let amcContractRepository: any;
  let visitCompletionRepository: any;
  let billingInvoiceRepository: any;
  let appointmentRepository: any;
  let serviceCentreRepository: any;
  let estimateRepository: any;
  let notificationsService: any;
  let contractQueryBuilder: any;
  let invoiceQueryBuilder: any;
  let appointmentQueryBuilder: any;

  const contract = (overrides: any = {}) =>
    ({
      id: 'contract-1',
      contractNumber: 'AMC-0001',
      customerName: 'Al Futtaim Facilities LLC',
      customerPhone: '+971501234567',
      customerEmail: 'facilities@example.com',
      customerAddress: null,
      customerType: CustomerType.B2C,
      serviceCentreId: 'sc-1',
      coveredSerialNumbers: ['SN-000123'],
      brand: 'BrandX',
      modelNumber: 'M100',
      coverageType: CoverageType.COMPREHENSIVE,
      serviceLevel: 'Standard',
      visitFrequency: VisitFrequency.QUARTERLY,
      startDate: new Date('2026-09-01T00:00:00.000Z'),
      endDate: new Date('2027-08-31T00:00:00.000Z'),
      totalAmount: 4800,
      paymentTerms: AmcPaymentTerms.FULL_UPFRONT,
      assignedTechnicianId: null,
      status: AmcContractStatus.ACTIVE,
      cancellationReason: null,
      renewalReminderSentAt: null,
      renewalReminderChannelsAttempted: [],
      renewalReminderChannelsDelivered: [],
      previousContractId: null,
      createdById: 'user-1',
      ...overrides,
    } as any);

  const amcAppointment = (overrides: any = {}) =>
    ({
      id: 'apt-1',
      type: AppointmentType.AMC,
      status: AppointmentStatus.SCHEDULED,
      amcContractId: 'contract-1',
      scheduledAt: new Date('2026-09-01T00:00:00.000Z'),
      actualEndAt: null,
      ...overrides,
    } as any);

  const billingInvoice = (overrides: any = {}) =>
    ({
      id: 'bi-1',
      invoiceNumber: 'AMCINV-0001',
      amcContractId: 'contract-1',
      periodLabel: 'Full Term',
      amount: 4800,
      status: AmcBillingStatus.DRAFT,
      paymentMethod: null,
      paymentReference: null,
      paidAt: null,
      recordedByUserId: null,
      ...overrides,
    } as any);

  beforeEach(() => {
    contractQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    invoiceQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    appointmentQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };

    amcContractRepository = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((data: any) => data),
      save: jest.fn((data: any) => Promise.resolve({ ...data, id: data.id || 'contract-1' })),
      createQueryBuilder: jest.fn(() => contractQueryBuilder),
    };
    visitCompletionRepository = {
      findOne: jest.fn(),
      create: jest.fn((data: any) => data),
      save: jest.fn((data: any) => Promise.resolve({ ...data, id: data.id || 'vc-1' })),
    };
    billingInvoiceRepository = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((data: any) => data),
      save: jest.fn((data: any) => Promise.resolve({ ...data, id: data.id || 'bi-1' })),
      createQueryBuilder: jest.fn(() => invoiceQueryBuilder),
    };
    appointmentRepository = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((data: any) => data),
      save: jest.fn((data: any) => Promise.resolve({ ...data, id: data.id || 'apt-x' })),
      createQueryBuilder: jest.fn(() => appointmentQueryBuilder),
    };
    serviceCentreRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'sc-1', isActive: true, vatRate: 5 }),
    };
    estimateRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    notificationsService = {
      sendAll: jest.fn().mockResolvedValue({ attempted: ['EMAIL'], delivered: [], results: [] }),
    };

    service = new AmcService(
      amcContractRepository,
      visitCompletionRepository,
      billingInvoiceRepository,
      appointmentRepository,
      serviceCentreRepository,
      estimateRepository,
      notificationsService,
    );
  });

  describe('createContract', () => {
    const dto: any = {
      customerName: 'Al Futtaim Facilities LLC',
      customerPhone: '+971501234567',
      customerEmail: 'facilities@example.com',
      customerType: CustomerType.B2C,
      serviceCentreId: 'sc-1',
      coveredSerialNumbers: ['SN-000123'],
      brand: 'BrandX',
      modelNumber: 'M100',
      coverageType: CoverageType.COMPREHENSIVE,
      visitFrequency: VisitFrequency.QUARTERLY,
      startDate: '2026-09-01T00:00:00.000Z',
      endDate: '2027-08-31T00:00:00.000Z',
      totalAmount: 4800,
      paymentTerms: AmcPaymentTerms.FULL_UPFRONT,
    };

    it('creates the contract and auto-generates its quarterly PM visit schedule', async () => {
      amcContractRepository.findOne.mockResolvedValue(contract());

      const result = await service.createContract(dto, 'user-1');

      expect(result.contractNumber).toBe('AMC-0001');
      // 2026-09-01, 12-01, 2027-03-01, 06-01 = 4 quarterly visits before 2027-08-31
      expect(appointmentRepository.save).toHaveBeenCalledTimes(4);
      const firstSaveArg = appointmentRepository.save.mock.calls[0][0];
      expect(firstSaveArg.type).toBe(AppointmentType.AMC);
      expect(firstSaveArg.amcContractId).toBe('contract-1');
    });

    it('rejects an inactive/missing service centre', async () => {
      serviceCentreRepository.findOne.mockResolvedValue(null);

      await expect(service.createContract(dto, 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('rejects endDate <= startDate', async () => {
      await expect(
        service.createContract({ ...dto, startDate: '2027-01-01T00:00:00.000Z', endDate: '2026-01-01T00:00:00.000Z' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a schedule that would exceed the 60-visit safety cap', async () => {
      await expect(
        service.createContract(
          { ...dto, visitFrequency: VisitFrequency.MONTHLY, startDate: '2020-01-01T00:00:00.000Z', endDate: '2026-06-01T00:00:00.000Z' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(appointmentRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('completeVisit', () => {
    it('completes a visit and marks the appointment COMPLETED', async () => {
      appointmentRepository.findOne.mockResolvedValue(amcAppointment());
      amcContractRepository.findOne.mockResolvedValue(contract());
      visitCompletionRepository.findOne.mockResolvedValue(null);
      appointmentRepository.find.mockResolvedValue([amcAppointment()]);

      const result = await service.completeVisit('apt-1', { checklistNotes: 'All good' }, 'tech-1');

      expect(result.completedByUserId).toBe('tech-1');
      expect(appointmentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: AppointmentStatus.COMPLETED }),
      );
    });

    it('rejects an appointment that is not an AMC visit', async () => {
      appointmentRepository.findOne.mockResolvedValue(amcAppointment({ type: AppointmentType.WARRANTY, amcContractId: null }));

      await expect(service.completeVisit('apt-1', {}, 'tech-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects a visit that has already been completed', async () => {
      appointmentRepository.findOne.mockResolvedValue(amcAppointment({ status: AppointmentStatus.COMPLETED }));

      await expect(service.completeVisit('apt-1', {}, 'tech-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects an extra charge without customer approval', async () => {
      appointmentRepository.findOne.mockResolvedValue(amcAppointment());

      await expect(
        service.completeVisit('apt-1', { extraChargeAmount: 150, extraChargeApprovedByCustomer: false }, 'tech-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts an extra charge when customer approval is explicit', async () => {
      appointmentRepository.findOne.mockResolvedValue(amcAppointment());
      amcContractRepository.findOne.mockResolvedValue(contract());
      visitCompletionRepository.findOne.mockResolvedValue(null);
      appointmentRepository.find.mockResolvedValue([amcAppointment()]);

      const result = await service.completeVisit(
        'apt-1',
        { extraChargeAmount: 150, extraChargeDescription: 'Extra filter', extraChargeApprovedByCustomer: true },
        'tech-1',
      );

      expect(result.extraChargeAmount).toBe(150);
      expect(result.extraChargeApprovedByCustomer).toBe(true);
    });

    it('rejects double-completion of the same visit', async () => {
      appointmentRepository.findOne.mockResolvedValue(amcAppointment());
      visitCompletionRepository.findOne.mockResolvedValue({ id: 'vc-existing' });

      await expect(service.completeVisit('apt-1', {}, 'tech-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('renewContract', () => {
    const renewDto: any = {
      startDate: '2027-09-01T00:00:00.000Z',
      endDate: '2028-08-31T00:00:00.000Z',
      totalAmount: 5000,
    };

    it('creates a new contract chained to the original and marks the original RENEWED', async () => {
      amcContractRepository.findOne.mockResolvedValueOnce(contract()).mockResolvedValueOnce({ ...contract(), id: 'contract-2' });

      const result = await service.renewContract('contract-1', renewDto, 'user-1');

      expect(amcContractRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: AmcContractStatus.RENEWED, id: 'contract-1' }),
      );
      const newContractSave = amcContractRepository.save.mock.calls.find((c: any) => c[0].previousContractId === 'contract-1');
      expect(newContractSave).toBeDefined();
    });

    it('rejects renewing a CANCELLED contract', async () => {
      amcContractRepository.findOne.mockResolvedValue(contract({ status: AmcContractStatus.CANCELLED }));

      await expect(service.renewContract('contract-1', renewDto, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects renewing an already-RENEWED contract', async () => {
      amcContractRepository.findOne.mockResolvedValue(contract({ status: AmcContractStatus.RENEWED }));

      await expect(service.renewContract('contract-1', renewDto, 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancelContract', () => {
    it('cancels an ACTIVE contract and its future SCHEDULED PM visits', async () => {
      amcContractRepository.findOne.mockResolvedValue(contract());

      const result = await service.cancelContract('contract-1', 'Customer requested termination');

      expect(result.status).toBe(AmcContractStatus.CANCELLED);
      expect(result.cancellationReason).toBe('Customer requested termination');
      expect(appointmentQueryBuilder.update).toHaveBeenCalled();
      expect(appointmentQueryBuilder.execute).toHaveBeenCalled();
    });

    it('rejects cancelling a non-ACTIVE contract', async () => {
      amcContractRepository.findOne.mockResolvedValue(contract({ status: AmcContractStatus.EXPIRED }));

      await expect(service.cancelContract('contract-1', 'reason')).rejects.toThrow(BadRequestException);
    });
  });

  describe('getExpiringContracts', () => {
    it('queries ACTIVE contracts within the given day window', async () => {
      amcContractRepository.find.mockResolvedValue([contract()]);

      const result = await service.getExpiringContracts(30);

      expect(result).toHaveLength(1);
      expect(amcContractRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: AmcContractStatus.ACTIVE }) }),
      );
    });
  });

  describe('sendRenewalReminder', () => {
    it('sends the AMC_RENEWAL_REMINDER trigger and records attempted/delivered channels', async () => {
      amcContractRepository.findOne.mockResolvedValue(contract());
      notificationsService.sendAll.mockResolvedValue({ attempted: ['WHATSAPP', 'EMAIL', 'SMS'], delivered: [], results: [] });

      const result = await service.sendRenewalReminder('contract-1');

      expect(result.attempted).toEqual(['WHATSAPP', 'EMAIL', 'SMS']);
      expect(amcContractRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ renewalReminderChannelsAttempted: ['WHATSAPP', 'EMAIL', 'SMS'] }),
      );
    });

    it('rejects sending a reminder for a non-ACTIVE contract', async () => {
      amcContractRepository.findOne.mockResolvedValue(contract({ status: AmcContractStatus.CANCELLED }));

      await expect(service.sendRenewalReminder('contract-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('generateBillingInvoice', () => {
    it('splits the total into 4 for QUARTERLY payment terms', async () => {
      amcContractRepository.findOne.mockResolvedValue(contract({ totalAmount: 4800, paymentTerms: AmcPaymentTerms.QUARTERLY }));

      const result = await service.generateBillingInvoice('contract-1', 'Q1 2026');

      expect(result.amount).toBe(1200);
      expect(result.periodLabel).toBe('Q1 2026');
      expect(result.invoiceNumber).toBe('AMCINV-0001');
    });

    it('splits the total into 2 for HALF_YEARLY payment terms', async () => {
      amcContractRepository.findOne.mockResolvedValue(contract({ totalAmount: 5000, paymentTerms: AmcPaymentTerms.HALF_YEARLY }));

      const result = await service.generateBillingInvoice('contract-1', 'H1 2026');

      expect(result.amount).toBe(2500);
    });

    it('charges the full amount for FULL_UPFRONT payment terms', async () => {
      amcContractRepository.findOne.mockResolvedValue(contract({ totalAmount: 4800, paymentTerms: AmcPaymentTerms.FULL_UPFRONT }));

      const result = await service.generateBillingInvoice('contract-1', 'Full Term');

      expect(result.amount).toBe(4800);
    });

    it('rejects billing a non-ACTIVE contract', async () => {
      amcContractRepository.findOne.mockResolvedValue(contract({ status: AmcContractStatus.CANCELLED }));

      await expect(service.generateBillingInvoice('contract-1', 'Full Term')).rejects.toThrow(BadRequestException);
    });
  });

  describe('recordBillingPayment', () => {
    it('marks a DRAFT invoice PAID', async () => {
      billingInvoiceRepository.findOne.mockResolvedValue(billingInvoice());

      const result = await service.recordBillingPayment('bi-1', PaymentMethod.BANK_TRANSFER, 'REF-1', 'user-1');

      expect(result.status).toBe(AmcBillingStatus.PAID);
      expect(result.paymentMethod).toBe(PaymentMethod.BANK_TRANSFER);
      expect(result.recordedByUserId).toBe('user-1');
    });

    it('rejects recording payment against an already-PAID invoice', async () => {
      billingInvoiceRepository.findOne.mockResolvedValue(billingInvoice({ status: AmcBillingStatus.PAID }));

      await expect(service.recordBillingPayment('bi-1', PaymentMethod.CASH, undefined, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects B2B Credit for a non-B2B contract', async () => {
      billingInvoiceRepository.findOne.mockResolvedValue(billingInvoice());
      amcContractRepository.findOne.mockResolvedValue(contract({ customerType: CustomerType.B2C }));

      await expect(service.recordBillingPayment('bi-1', PaymentMethod.B2B_CREDIT, undefined, 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('accepts B2B Credit for a B2B contract', async () => {
      billingInvoiceRepository.findOne.mockResolvedValue(billingInvoice());
      amcContractRepository.findOne.mockResolvedValue(contract({ customerType: CustomerType.B2B }));

      const result = await service.recordBillingPayment('bi-1', PaymentMethod.B2B_CREDIT, undefined, 'user-1');

      expect(result.status).toBe(AmcBillingStatus.PAID);
    });
  });

  describe('getRwrUpsellCandidates', () => {
    it('excludes customers whose phone number is already on an ACTIVE AMC contract', async () => {
      amcContractRepository.find.mockResolvedValue([contract({ customerPhone: '+971500000001' })]);
      estimateRepository.find.mockResolvedValue([
        {
          totalAmount: 500,
          jobCard: { id: 'jc-1', jobCardNumber: 'JC-0001', appointment: { customerName: 'Covered Customer', customerPhone: '+971500000001' } },
        },
        {
          totalAmount: 700,
          jobCard: { id: 'jc-2', jobCardNumber: 'JC-0002', appointment: { customerName: 'New Customer', customerPhone: '+971500000002' } },
        },
      ]);

      const result = await service.getRwrUpsellCandidates();

      expect(result).toHaveLength(1);
      expect(result[0].customerPhone).toBe('+971500000002');
    });

    it('dedups multiple approved estimates from the same phone number', async () => {
      amcContractRepository.find.mockResolvedValue([]);
      estimateRepository.find.mockResolvedValue([
        {
          totalAmount: 500,
          jobCard: { id: 'jc-1', jobCardNumber: 'JC-0001', appointment: { customerName: 'Same Customer', customerPhone: '+971500000003' } },
        },
        {
          totalAmount: 300,
          jobCard: { id: 'jc-2', jobCardNumber: 'JC-0002', appointment: { customerName: 'Same Customer', customerPhone: '+971500000003' } },
        },
      ]);

      const result = await service.getRwrUpsellCandidates();

      expect(result).toHaveLength(1);
    });
  });
});
