import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DismantlingService } from './dismantling.service';
import { DismantlingStatus, HarvestedComponentCondition } from './entities/dismantling-record.entity';
import { RecoveryCategory } from '../master-data/entities/component-yield-matrix.entity';
import { InventoryLocation } from '../inventory/entities/inventory-stock.entity';

describe('DismantlingService', () => {
  let service: DismantlingService;
  let dismantlingRecordRepository: any;
  let componentYieldMatrixRepository: any;
  let sparePartRepository: any;
  let dataSource: any;
  let glLedgerService: any;
  let recordQueryBuilder: any;
  let manager: any;

  const record = (overrides: any = {}) =>
    ({
      id: 'record-1',
      recordNumber: 'DISM-0001',
      applianceSerialNumber: 'SN-000987',
      modelId: 'M100',
      damageLocationNotes: null,
      status: DismantlingStatus.PENDING_HARVEST,
      harvestedComponents: [],
      createdById: 'user-creator',
      harvestedByUserId: null,
      harvestedAt: null,
      verifiedByUserId: null,
      verifiedAt: null,
      verificationNotes: null,
      pricedByUserId: null,
      postedAt: null,
      totalRecoveredValue: 0,
      cancellationReason: null,
      ...overrides,
    } as any);

  const matrixEntry = (overrides: any = {}) =>
    ({
      id: 'matrix-1',
      modelId: 'M100',
      originalBomItemCode: 'COMP-COMPRESSOR-01',
      itemName: 'Compressor Unit',
      category: RecoveryCategory.RECOVERABLE_SPARE,
      defaultRecoveryEvaluation: 50,
      convertedSparePartCode: 'SP-COMPRESSOR-01',
      isActive: true,
      ...overrides,
    } as any);

  const sparePart = (overrides: any = {}) =>
    ({
      id: 'sp-1',
      code: 'SP-COMPRESSOR-01',
      name: 'Recovered Compressor',
      models: [{ id: 'model-1' }],
      ...overrides,
    } as any);

  beforeEach(() => {
    recordQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };

    dismantlingRecordRepository = {
      createQueryBuilder: jest.fn(() => recordQueryBuilder),
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve(data)),
      findOne: jest.fn(),
      find: jest.fn(),
    };

    componentYieldMatrixRepository = {
      findOne: jest.fn(),
    };

    sparePartRepository = {
      findOne: jest.fn(),
    };

    manager = {
      query: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(),
      create: jest.fn((_entity, data) => data),
      save: jest.fn((data) => Promise.resolve(data)),
    };

    dataSource = {
      transaction: jest.fn((cb) => cb(manager)),
    };

    glLedgerService = {
      postDismantlingRecovery: jest.fn().mockResolvedValue({ id: 'gl-1' }),
    };

    service = new DismantlingService(
      dismantlingRecordRepository,
      componentYieldMatrixRepository,
      sparePartRepository,
      dataSource,
      glLedgerService,
    );
  });

  describe('create', () => {
    it('generates DISM-0001 for the first record', async () => {
      const result = await service.create({ applianceSerialNumber: 'SN-000987', modelId: 'M100' } as any, 'user-creator');
      expect(result.recordNumber).toBe('DISM-0001');
      expect(result.status).toBe(DismantlingStatus.PENDING_HARVEST);
      expect(result.createdById).toBe('user-creator');
    });

    it('increments the sequence from the last record number', async () => {
      recordQueryBuilder.getOne.mockResolvedValue({ recordNumber: 'DISM-0007' });
      const result = await service.create({ applianceSerialNumber: 'SN-1', modelId: 'M1' } as any, 'user-creator');
      expect(result.recordNumber).toBe('DISM-0008');
    });
  });

  describe('harvest', () => {
    it('throws if the record is not PENDING_HARVEST', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(record({ status: DismantlingStatus.VERIFIED }));
      await expect(
        service.harvest('record-1', { components: [{ originalBomItemCode: 'X', testedCondition: HarvestedComponentCondition.GOOD_WORKING, quantity: 1 }] } as any, 'tech-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('marks a GOOD_WORKING, RECOVERABLE_SPARE component eligible for conversion', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(record());
      componentYieldMatrixRepository.findOne.mockResolvedValue(matrixEntry());

      const result = await service.harvest(
        'record-1',
        { components: [{ originalBomItemCode: 'COMP-COMPRESSOR-01', testedCondition: HarvestedComponentCondition.GOOD_WORKING, quantity: 1 }] } as any,
        'tech-1',
      );

      expect(result.status).toBe(DismantlingStatus.COMPONENTS_LOGGED);
      expect(result.harvestedByUserId).toBe('tech-1');
      expect(result.harvestedComponents[0].eligibleForConversion).toBe(true);
      expect(result.harvestedComponents[0].convertedSparePartCode).toBe('SP-COMPRESSOR-01');
    });

    it('marks a DAMAGED component ineligible even if the matrix entry is RECOVERABLE_SPARE', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(record());
      componentYieldMatrixRepository.findOne.mockResolvedValue(matrixEntry());

      const result = await service.harvest(
        'record-1',
        { components: [{ originalBomItemCode: 'COMP-COMPRESSOR-01', testedCondition: HarvestedComponentCondition.DAMAGED, quantity: 1 }] } as any,
        'tech-1',
      );

      expect(result.harvestedComponents[0].eligibleForConversion).toBe(false);
    });

    it('marks a CONSUMABLE-category component ineligible per BRD step 15.5', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(record());
      componentYieldMatrixRepository.findOne.mockResolvedValue(matrixEntry({ category: RecoveryCategory.CONSUMABLE }));

      const result = await service.harvest(
        'record-1',
        { components: [{ originalBomItemCode: 'COMP-GASKET-01', testedCondition: HarvestedComponentCondition.GOOD_WORKING, quantity: 2 }] } as any,
        'tech-1',
      );

      expect(result.harvestedComponents[0].eligibleForConversion).toBe(false);
    });

    it('logs a component with no matching matrix entry as ineligible, not an error', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(record());
      componentYieldMatrixRepository.findOne.mockResolvedValue(null);

      const result = await service.harvest(
        'record-1',
        { components: [{ originalBomItemCode: 'UNKNOWN-CODE', testedCondition: HarvestedComponentCondition.GOOD_WORKING, quantity: 1 }] } as any,
        'tech-1',
      );

      expect(result.harvestedComponents[0].eligibleForConversion).toBe(false);
      expect(result.harvestedComponents[0].itemName).toBeNull();
    });
  });

  describe('verify', () => {
    it('throws if the record is not COMPONENTS_LOGGED', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(record({ status: DismantlingStatus.PENDING_HARVEST }));
      await expect(service.verify('record-1', 'notes', 'tl-1')).rejects.toThrow(BadRequestException);
    });

    it('throws (AC-31) if the verifier is the same person who harvested', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(record({ status: DismantlingStatus.COMPONENTS_LOGGED, harvestedByUserId: 'tech-1' }));
      await expect(service.verify('record-1', 'notes', 'tech-1')).rejects.toThrow(BadRequestException);
    });

    it('verifies successfully when the verifier differs from the harvester', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(record({ status: DismantlingStatus.COMPONENTS_LOGGED, harvestedByUserId: 'tech-1' }));
      const result = await service.verify('record-1', 'looks good', 'tl-1');
      expect(result.status).toBe(DismantlingStatus.VERIFIED);
      expect(result.verifiedByUserId).toBe('tl-1');
    });
  });

  describe('priceAndPost', () => {
    const verifiedRecord = () =>
      record({
        status: DismantlingStatus.VERIFIED,
        harvestedByUserId: 'tech-1',
        verifiedByUserId: 'tl-1',
        harvestedComponents: [
          {
            originalBomItemCode: 'COMP-COMPRESSOR-01',
            itemName: 'Compressor Unit',
            category: RecoveryCategory.RECOVERABLE_SPARE,
            convertedSparePartCode: 'SP-COMPRESSOR-01',
            testedCondition: HarvestedComponentCondition.GOOD_WORKING,
            quantity: 2,
            eligibleForConversion: true,
            selectedForConversion: false,
            recoveryUnitPrice: null,
            quantityConverted: null,
            convertedSparePartId: null,
          },
        ],
      });

    it('throws if the record is not VERIFIED', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(record({ status: DismantlingStatus.COMPONENTS_LOGGED }));
      await expect(
        service.priceAndPost('record-1', { conversions: [{ originalBomItemCode: 'X', recoveryUnitPrice: 10 }] } as any, 'sm-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws (AC-31) if the poster is the same as the harvester', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(verifiedRecord());
      await expect(
        service.priceAndPost('record-1', { conversions: [{ originalBomItemCode: 'COMP-COMPRESSOR-01', recoveryUnitPrice: 85 }] } as any, 'tech-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws (AC-31) if the poster is the same as the verifier', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(verifiedRecord());
      await expect(
        service.priceAndPost('record-1', { conversions: [{ originalBomItemCode: 'COMP-COMPRESSOR-01', recoveryUnitPrice: 85 }] } as any, 'tl-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws if a conversion references a component never harvested', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(verifiedRecord());
      await expect(
        service.priceAndPost('record-1', { conversions: [{ originalBomItemCode: 'NOT-LOGGED', recoveryUnitPrice: 85 }] } as any, 'sm-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws if the component was never marked eligible (e.g. DAMAGED or a consumable)', async () => {
      const rec = verifiedRecord();
      rec.harvestedComponents[0].eligibleForConversion = false;
      dismantlingRecordRepository.findOne.mockResolvedValue(rec);
      await expect(
        service.priceAndPost('record-1', { conversions: [{ originalBomItemCode: 'COMP-COMPRESSOR-01', recoveryUnitPrice: 85 }] } as any, 'sm-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws if quantityToConvert exceeds what was harvested', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(verifiedRecord());
      await expect(
        service.priceAndPost('record-1', { conversions: [{ originalBomItemCode: 'COMP-COMPRESSOR-01', recoveryUnitPrice: 85, quantityToConvert: 99 }] } as any, 'sm-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if the converted spare part code has no SparePart record', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(verifiedRecord());
      sparePartRepository.findOne.mockResolvedValue(null);
      await expect(
        service.priceAndPost('record-1', { conversions: [{ originalBomItemCode: 'COMP-COMPRESSOR-01', recoveryUnitPrice: 85 }] } as any, 'sm-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws (AC-17-style) if the resolved spare part has no linked SparePartModel', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(verifiedRecord());
      sparePartRepository.findOne.mockResolvedValue(sparePart({ models: [] }));
      await expect(
        service.priceAndPost('record-1', { conversions: [{ originalBomItemCode: 'COMP-COMPRESSOR-01', recoveryUnitPrice: 85 }] } as any, 'sm-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('posts successfully: increments MAIN_STORE stock, marks POSTED, and posts a GL entry for the total value', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(verifiedRecord());
      sparePartRepository.findOne.mockResolvedValue(sparePart());
      manager.findOne
        .mockResolvedValueOnce(verifiedRecord()) // current DismantlingRecord re-fetch inside transaction
        .mockResolvedValueOnce(null); // no existing InventoryStock row yet for this spare part

      const result = await service.priceAndPost(
        'record-1',
        { conversions: [{ originalBomItemCode: 'COMP-COMPRESSOR-01', recoveryUnitPrice: 85, quantityToConvert: 2 }] } as any,
        'sm-1',
      );

      expect(result.status).toBe(DismantlingStatus.POSTED);
      expect(result.pricedByUserId).toBe('sm-1');
      expect(result.totalRecoveredValue).toBe(170);
      expect(manager.save).toHaveBeenCalledWith(expect.objectContaining({ location: InventoryLocation.MAIN_STORE, quantityOnHand: 2 }));
      expect(glLedgerService.postDismantlingRecovery).toHaveBeenCalledWith({
        dismantlingRecordId: 'record-1',
        recordNumber: 'DISM-0001',
        amount: 170,
      });
    });

    it('throws if the record status changed underneath the transaction (concurrent post)', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(verifiedRecord());
      sparePartRepository.findOne.mockResolvedValue(sparePart());
      manager.findOne.mockResolvedValueOnce(record({ status: DismantlingStatus.POSTED }));

      await expect(
        service.priceAndPost('record-1', { conversions: [{ originalBomItemCode: 'COMP-COMPRESSOR-01', recoveryUnitPrice: 85 }] } as any, 'sm-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('cancel', () => {
    it('cancels while PENDING_HARVEST', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(record());
      const result = await service.cancel('record-1', 'nothing salvageable');
      expect(result.status).toBe(DismantlingStatus.CANCELLED);
      expect(result.cancellationReason).toBe('nothing salvageable');
    });

    it('cancels while COMPONENTS_LOGGED', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(record({ status: DismantlingStatus.COMPONENTS_LOGGED }));
      const result = await service.cancel('record-1', 'reason');
      expect(result.status).toBe(DismantlingStatus.CANCELLED);
    });

    it('throws if the record is already VERIFIED or beyond', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(record({ status: DismantlingStatus.VERIFIED }));
      await expect(service.cancel('record-1', 'reason')).rejects.toThrow(BadRequestException);
    });
  });

  describe('lookups', () => {
    it('findById throws NotFoundException when missing', async () => {
      dismantlingRecordRepository.findOne.mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });

    it('findAll passes the status filter through', async () => {
      dismantlingRecordRepository.find.mockResolvedValue([record()]);
      await service.findAll(DismantlingStatus.POSTED);
      expect(dismantlingRecordRepository.find).toHaveBeenCalledWith({ where: { status: DismantlingStatus.POSTED }, order: { createdAt: 'DESC' } });
    });

    it('findByApplianceSerial filters by serial number', async () => {
      dismantlingRecordRepository.find.mockResolvedValue([record()]);
      const result = await service.findByApplianceSerial('SN-000987');
      expect(result).toHaveLength(1);
      expect(dismantlingRecordRepository.find).toHaveBeenCalledWith({ where: { applianceSerialNumber: 'SN-000987' }, order: { createdAt: 'DESC' } });
    });
  });
});
