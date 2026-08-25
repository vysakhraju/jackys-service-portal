import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { DeliveryStatus } from './entities/delivery.entity';
import { JobCardStatus } from '../job-cards/entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { InvoiceStatus } from '../invoicing/entities/invoice.entity';

describe('DeliveryService', () => {
  let service: DeliveryService;
  let deliveryRepository: any;
  let dataSource: any;
  let manager: any;
  let jobCardsService: any;
  let invoicingService: any;
  let queryBuilder: any;

  const delivery = (overrides: any = {}) =>
    ({
      id: 'dlv-1',
      deliveryNumber: 'DLV-0001',
      status: DeliveryStatus.PENDING,
      dispatcherUserId: 'dispatcher-1',
      driverUserId: null,
      dispatchedAt: null,
      deliveredAt: null,
      podSignatureBase64: null,
      podPhotoBase64: null,
      podRecipientName: null,
      podNotes: null,
      cancellationReason: null,
      ...overrides,
    } as any);

  const jobCard = (overrides: any = {}) =>
    ({
      id: 'jc-1',
      jobCardNumber: 'JC-0001',
      status: JobCardStatus.QC_PASSED,
      warrantyStatus: WarrantyStatus.IN_WARRANTY,
      deliveryId: null,
      ...overrides,
    } as any);

  beforeEach(() => {
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    manager = {
      query: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      // Newly-created entities (Delivery via manager.create) have no id yet - mirror a
      // real save() by assigning one, matching deliveryRepository.findOne's default mock
      // below (id 'dlv-1') so downstream assertions on jobCard.deliveryId line up.
      save: jest.fn((entity: any) => Promise.resolve(entity.id ? entity : { ...entity, id: 'dlv-1' })),
      create: jest.fn((_cls: any, data: any) => data),
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    dataSource = { transaction: jest.fn((cb: any) => cb(manager)) };
    deliveryRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn((entity: any) => Promise.resolve(entity)),
    };
    jobCardsService = {
      findById: jest.fn(),
      findReadyForDelivery: jest.fn(),
      findByDeliveryId: jest.fn(),
    };
    invoicingService = {
      findByJobCardId: jest.fn(),
      isPayableForDelivery: jest.fn(),
    };

    service = new DeliveryService(deliveryRepository, dataSource, jobCardsService, invoicingService);
  });

  describe('findById', () => {
    it('returns the delivery when found', async () => {
      deliveryRepository.findOne.mockResolvedValue(delivery());

      const result = await service.findById('dlv-1');

      expect(result.id).toBe('dlv-1');
    });

    it('throws NotFoundException when missing', async () => {
      deliveryRepository.findOne.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByJobCardId', () => {
    it('returns null when the Job Card has no deliveryId yet', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ deliveryId: null }));

      const result = await service.findByJobCardId('jc-1');

      expect(result).toBeNull();
      expect(deliveryRepository.findOne).not.toHaveBeenCalled();
    });

    it('returns the attached delivery when set', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ deliveryId: 'dlv-1' }));
      deliveryRepository.findOne.mockResolvedValue(delivery());

      const result = await service.findByJobCardId('jc-1');

      expect(result?.id).toBe('dlv-1');
    });
  });

  describe('findReady', () => {
    it('marks an in-warranty job as payable=true without ever looking up an invoice', async () => {
      jobCardsService.findReadyForDelivery.mockResolvedValue([jobCard({ warrantyStatus: WarrantyStatus.IN_WARRANTY })]);

      const result = await service.findReady();

      expect(result[0].payable).toBe(true);
      expect(result[0].invoiceStatus).toBeNull();
      expect(invoicingService.findByJobCardId).not.toHaveBeenCalled();
    });

    it('looks up (without creating) the invoice for an out-of-warranty job and reports payability', async () => {
      jobCardsService.findReadyForDelivery.mockResolvedValue([jobCard({ id: 'jc-2', warrantyStatus: WarrantyStatus.OUT_OF_WARRANTY })]);
      invoicingService.findByJobCardId.mockResolvedValue({ status: InvoiceStatus.PAID });

      const result = await service.findReady();

      expect(invoicingService.findByJobCardId).toHaveBeenCalledWith('jc-2');
      expect(result[0].invoiceStatus).toBe(InvoiceStatus.PAID);
      expect(result[0].payable).toBe(true);
    });

    it('reports payable=false and invoiceStatus=null for an OOW job with no invoice drafted yet', async () => {
      jobCardsService.findReadyForDelivery.mockResolvedValue([jobCard({ warrantyStatus: WarrantyStatus.OUT_OF_WARRANTY })]);
      invoicingService.findByJobCardId.mockResolvedValue(null);

      const result = await service.findReady();

      expect(result[0].invoiceStatus).toBeNull();
      expect(result[0].payable).toBe(false);
    });
  });

  describe('create', () => {
    it('throws NotFoundException when a listed Job Card does not exist', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(service.create({ jobCardIds: ['jc-missing'] }, 'dispatcher-1')).rejects.toThrow(NotFoundException);
    });

    it('rejects a Job Card that is not QC_PASSED', async () => {
      manager.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS }));

      await expect(service.create({ jobCardIds: ['jc-1'] }, 'dispatcher-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects a Job Card already attached to another delivery - closes the double-claim race', async () => {
      manager.findOne.mockResolvedValue(jobCard({ deliveryId: 'dlv-other' }));

      await expect(service.create({ jobCardIds: ['jc-1'] }, 'dispatcher-1')).rejects.toThrow(ConflictException);
    });

    it('locks the delivery-number sequence first, then every job card in sorted order (deadlock-safe order)', async () => {
      manager.findOne.mockImplementation((_entity: any, opts: any) => Promise.resolve(jobCard({ id: opts.where.id })));
      jobCardsService.findByDeliveryId.mockResolvedValue([]);
      deliveryRepository.findOne.mockResolvedValue(delivery());

      await service.create({ jobCardIds: ['jc-2', 'jc-1'] }, 'dispatcher-1');

      const lockCalls = manager.query.mock.calls.map((call: any) => call[1][0]);
      expect(lockCalls).toEqual(['delivery:number-sequence', 'jobcard:jc-1', 'jobcard:jc-2']);
    });

    it('blocks the whole batch (409, with blockers) when an out-of-warranty member is unpaid', async () => {
      manager.findOne.mockImplementation((_entity: any, opts: any) =>
        Promise.resolve(opts.where.id === 'jc-1' ? jobCard({ id: 'jc-1', warrantyStatus: WarrantyStatus.OUT_OF_WARRANTY }) : jobCard({ id: 'jc-2' })),
      );
      invoicingService.isPayableForDelivery.mockResolvedValue({
        payable: false,
        invoice: { id: 'inv-1', status: InvoiceStatus.DRAFT, amount: 1500 },
      });

      await expect(service.create({ jobCardIds: ['jc-1', 'jc-2'] }, 'dispatcher-1')).rejects.toThrow(ConflictException);
      // Nothing should have been persisted once the batch is rejected.
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('creates the delivery and claims every member (paid OOW job included) when everything clears', async () => {
      manager.findOne.mockImplementation((_entity: any, opts: any) =>
        Promise.resolve(opts.where.id === 'jc-1' ? jobCard({ id: 'jc-1', warrantyStatus: WarrantyStatus.OUT_OF_WARRANTY }) : jobCard({ id: 'jc-2' })),
      );
      invoicingService.isPayableForDelivery.mockResolvedValue({
        payable: true,
        invoice: { id: 'inv-1', status: InvoiceStatus.PAID, amount: 1500 },
      });
      const members = [jobCard({ id: 'jc-1', deliveryId: 'dlv-1' }), jobCard({ id: 'jc-2', deliveryId: 'dlv-1' })];
      deliveryRepository.findOne.mockResolvedValue(delivery());
      jobCardsService.findByDeliveryId.mockResolvedValue(members);

      const result = await service.create({ jobCardIds: ['jc-1', 'jc-2'] }, 'dispatcher-1');

      expect(result.delivery.deliveryNumber).toBe('DLV-0001');
      expect(result.jobCards).toBe(members);
      // Both member job cards were saved with the new delivery id.
      const savedJobCards = manager.save.mock.calls.map((c: any) => c[0]).filter((e: any) => e.jobCardNumber);
      expect(savedJobCards.every((jc: any) => jc.deliveryId === 'dlv-1')).toBe(true);
    });

    it('increments the sequence off the highest existing DLV-####', async () => {
      manager.findOne.mockResolvedValue(jobCard());
      queryBuilder.getOne.mockResolvedValue(delivery({ deliveryNumber: 'DLV-0042' }));
      deliveryRepository.findOne.mockResolvedValue(delivery({ deliveryNumber: 'DLV-0043' }));
      jobCardsService.findByDeliveryId.mockResolvedValue([]);

      const result = await service.create({ jobCardIds: ['jc-1'] }, 'dispatcher-1');

      expect(result.delivery.deliveryNumber).toBe('DLV-0043');
    });
  });

  describe('dispatch', () => {
    it('marks a PENDING delivery DISPATCHED and records the driver', async () => {
      deliveryRepository.findOne.mockResolvedValue(delivery({ status: DeliveryStatus.PENDING }));

      const result = await service.dispatch('dlv-1', 'driver-1');

      expect(result.status).toBe(DeliveryStatus.DISPATCHED);
      expect(result.driverUserId).toBe('driver-1');
      expect(result.dispatchedAt).toBeInstanceOf(Date);
    });

    it('rejects dispatching a delivery that is not PENDING', async () => {
      deliveryRepository.findOne.mockResolvedValue(delivery({ status: DeliveryStatus.DISPATCHED }));

      await expect(service.dispatch('dlv-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('capturePod', () => {
    it('rejects when neither signature nor photo is provided (AC-12)', async () => {
      await expect(service.capturePod('dlv-1', { recipientName: 'Anita' } as any)).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects capturing POD on a delivery that is not DISPATCHED', async () => {
      manager.findOne.mockResolvedValue(delivery({ status: DeliveryStatus.PENDING }));

      await expect(
        service.capturePod('dlv-1', { signatureBase64: 'abc', recipientName: 'Anita' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('re-checks the OOW-paid gate and blocks (409) if a member is no longer payable', async () => {
      manager.findOne.mockResolvedValue(delivery({ status: DeliveryStatus.DISPATCHED }));
      manager.find.mockResolvedValue([jobCard({ warrantyStatus: WarrantyStatus.OUT_OF_WARRANTY })]);
      invoicingService.isPayableForDelivery.mockResolvedValue({
        payable: false,
        invoice: { id: 'inv-1', status: InvoiceStatus.DRAFT, amount: 1500 },
      });

      await expect(
        service.capturePod('dlv-1', { signatureBase64: 'abc', recipientName: 'Anita' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('marks the delivery and every member Job Card DELIVERED on success', async () => {
      manager.findOne.mockResolvedValue(delivery({ status: DeliveryStatus.DISPATCHED }));
      const members = [jobCard({ id: 'jc-1' }), jobCard({ id: 'jc-2' })];
      manager.find.mockResolvedValue(members);

      const result = await service.capturePod('dlv-1', { signatureBase64: 'sig-data', recipientName: 'Anita Kumar', notes: 'ok' } as any);

      expect(result.status).toBe(DeliveryStatus.DELIVERED);
      expect(result.podRecipientName).toBe('Anita Kumar');
      expect(result.deliveredAt).toBeInstanceOf(Date);
      expect(members.every((jc) => jc.status === JobCardStatus.DELIVERED)).toBe(true);
    });
  });

  describe('cancel', () => {
    it('rejects cancelling a delivery that is not PENDING', async () => {
      manager.findOne.mockResolvedValue(delivery({ status: DeliveryStatus.DISPATCHED }));

      await expect(service.cancel('dlv-1', 'wrong batch')).rejects.toThrow(BadRequestException);
    });

    it('releases every member Job Card and marks the delivery CANCELLED', async () => {
      manager.findOne.mockResolvedValue(delivery({ status: DeliveryStatus.PENDING }));
      const members = [jobCard({ id: 'jc-1', deliveryId: 'dlv-1' }), jobCard({ id: 'jc-2', deliveryId: 'dlv-1' })];
      manager.find.mockResolvedValue(members);

      const result = await service.cancel('dlv-1', 'wrong batch');

      expect(result.status).toBe(DeliveryStatus.CANCELLED);
      expect(result.cancellationReason).toBe('wrong batch');
      expect(members.every((jc) => jc.deliveryId === null)).toBe(true);
    });
  });
});
