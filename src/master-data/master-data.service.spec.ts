import { NotFoundException, ConflictException } from '@nestjs/common';
import { MasterDataService } from './master-data.service';

describe('MasterDataService', () => {
  let service: MasterDataService;
  let serviceCentreRepository: any;
  let faultSymptomRepository: any;
  let sparePartRepository: any;
  let sparePartModelRepository: any;
  let servicePriceListRepository: any;
  let technicianKpiRuleRepository: any;
  let notificationTemplateRepository: any;
  let warrantyMasterRepository: any;
  let componentYieldMatrixRepository: any;

  const buildQb = (result: any, isMany = false) => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(isMany ? result : []),
    getOne: jest.fn().mockResolvedValue(!isMany ? result : null),
  });

  beforeEach(() => {
    const repoFactory = () => ({
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((data: any) => data),
      save: jest.fn((data: any) => Promise.resolve({ ...data, id: data.id || 'generated-id' })),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    });

    serviceCentreRepository = repoFactory();
    faultSymptomRepository = repoFactory();
    sparePartRepository = repoFactory();
    sparePartModelRepository = repoFactory();
    servicePriceListRepository = repoFactory();
    technicianKpiRuleRepository = repoFactory();
    notificationTemplateRepository = repoFactory();
    warrantyMasterRepository = repoFactory();
    componentYieldMatrixRepository = repoFactory();

    service = new MasterDataService(
      serviceCentreRepository,
      faultSymptomRepository,
      sparePartRepository,
      sparePartModelRepository,
      servicePriceListRepository,
      technicianKpiRuleRepository,
      notificationTemplateRepository,
      warrantyMasterRepository,
      componentYieldMatrixRepository,
    );
  });

  describe('Service Centre', () => {
    it('creates a service centre when the code is not already used', async () => {
      serviceCentreRepository.findOne.mockResolvedValue(null);

      const result = await service.createServiceCentre({ code: 'SC-1', name: 'Dubai' });

      expect(result).toEqual(expect.objectContaining({ code: 'SC-1' }));
    });

    it('throws ConflictException when the code already exists', async () => {
      serviceCentreRepository.findOne.mockResolvedValue({ id: 'x', code: 'SC-1' });

      await expect(service.createServiceCentre({ code: 'SC-1' })).rejects.toThrow(ConflictException);
    });

    it('filters active service centres, optionally by country', async () => {
      const qb = buildQb([{ id: '1' }], true);
      serviceCentreRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAllServiceCentres('UAE' as any);

      expect(qb.where).toHaveBeenCalledWith('centre.country = :country', { country: 'UAE' });
      expect(qb.andWhere).toHaveBeenCalledWith('centre.isActive = :isActive', { isActive: true });
      expect(result).toEqual([{ id: '1' }]);
    });

    it('skips the country filter when none is given', async () => {
      const qb = buildQb([], true);
      serviceCentreRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAllServiceCentres();

      expect(qb.where).not.toHaveBeenCalled();
      expect(qb.andWhere).toHaveBeenCalledWith('centre.isActive = :isActive', { isActive: true });
    });

    it('returns a service centre by id', async () => {
      serviceCentreRepository.findOne.mockResolvedValue({ id: '1' });

      const result = await service.findServiceCentreById('1');

      expect(result).toEqual({ id: '1' });
    });

    it('throws NotFoundException when the service centre does not exist', async () => {
      serviceCentreRepository.findOne.mockResolvedValue(null);

      await expect(service.findServiceCentreById('missing')).rejects.toThrow(NotFoundException);
    });

    it('updates an existing service centre', async () => {
      serviceCentreRepository.findOne.mockResolvedValue({ id: '1', name: 'Old' });

      const result = await service.updateServiceCentre('1', { name: 'New' });

      expect(serviceCentreRepository.update).toHaveBeenCalledWith('1', { name: 'New' });
      expect(result).toEqual({ id: '1', name: 'Old' });
    });

    it('soft-deletes a service centre by setting isActive false', async () => {
      serviceCentreRepository.findOne.mockResolvedValue({ id: '1' });

      await service.deleteServiceCentre('1');

      expect(serviceCentreRepository.update).toHaveBeenCalledWith('1', { isActive: false });
    });
  });

  describe('Fault & Symptom', () => {
    it('creates a fault/symptom when codes are unused', async () => {
      faultSymptomRepository.findOne.mockResolvedValue(null);

      const result = await service.createFaultSymptom({ faultCode: 'F1', symptomCode: 'S1' });

      expect(result).toEqual(expect.objectContaining({ faultCode: 'F1' }));
    });

    it('throws ConflictException when the fault or symptom code exists', async () => {
      faultSymptomRepository.findOne.mockResolvedValue({ id: 'x' });

      await expect(
        service.createFaultSymptom({ faultCode: 'F1', symptomCode: 'S1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('finds active fault symptoms filtered by category when provided', async () => {
      const qb = buildQb([{ id: '1' }], true);
      faultSymptomRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAllFaultSymptoms('WASHING_MACHINE' as any);

      expect(qb.andWhere).toHaveBeenCalledWith('fault.category = :category', {
        category: 'WASHING_MACHINE',
      });
    });

    it('finds a fault by code', async () => {
      faultSymptomRepository.findOne.mockResolvedValue({ faultCode: 'F1' });
      const result = await service.findFaultByCode('F1');
      expect(result).toEqual({ faultCode: 'F1' });
    });

    it('throws NotFoundException for an unknown fault code', async () => {
      faultSymptomRepository.findOne.mockResolvedValue(null);
      await expect(service.findFaultByCode('NOPE')).rejects.toThrow(NotFoundException);
    });

    it('finds a symptom by code', async () => {
      faultSymptomRepository.findOne.mockResolvedValue({ symptomCode: 'S1' });
      const result = await service.findSymptomByCode('S1');
      expect(result).toEqual({ symptomCode: 'S1' });
    });

    it('throws NotFoundException for an unknown symptom code', async () => {
      faultSymptomRepository.findOne.mockResolvedValue(null);
      await expect(service.findSymptomByCode('NOPE')).rejects.toThrow(NotFoundException);
    });
  });

  describe('Spare Parts', () => {
    it('creates a spare part when the code is unused', async () => {
      sparePartRepository.findOne.mockResolvedValue(null);
      const result = await service.createSparePart({ code: 'SP-1' });
      expect(result).toEqual(expect.objectContaining({ code: 'SP-1' }));
    });

    it('throws ConflictException when the spare part code exists', async () => {
      sparePartRepository.findOne.mockResolvedValue({ id: 'x' });
      await expect(service.createSparePart({ code: 'SP-1' })).rejects.toThrow(ConflictException);
    });

    it('defaults to active-only spare parts when no active filter is given', async () => {
      const qb = buildQb([], true);
      sparePartRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAllSpareParts({ category: 'MOTOR' });

      expect(qb.andWhere).toHaveBeenCalledWith('spare.category = :category', { category: 'MOTOR' });
      expect(qb.andWhere).toHaveBeenCalledWith('spare.isActive = :active', { active: true });
    });

    it('respects an explicit active:false filter', async () => {
      const qb = buildQb([], true);
      sparePartRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAllSpareParts({ active: false });

      expect(qb.andWhere).toHaveBeenCalledWith('spare.isActive = :active', { active: false });
    });

    it('returns a spare part with its models', async () => {
      sparePartRepository.findOne.mockResolvedValue({ id: '1', models: [] });
      const result = await service.findSparePartById('1');
      expect(sparePartRepository.findOne).toHaveBeenCalledWith({
        where: { id: '1' },
        relations: { models: true },
      });
      expect(result).toEqual({ id: '1', models: [] });
    });

    it('throws NotFoundException when the spare part does not exist', async () => {
      sparePartRepository.findOne.mockResolvedValue(null);
      await expect(service.findSparePartById('missing')).rejects.toThrow(NotFoundException);
    });

    it('finds spare parts linked to a model', async () => {
      const qb = buildQb([{ id: '1' }], true);
      sparePartRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findSparePartsByModel('model-1');

      expect(qb.innerJoin).toHaveBeenCalledWith('spare.models', 'model', 'model.modelId = :modelId', {
        modelId: 'model-1',
      });
      expect(result).toEqual([{ id: '1' }]);
    });

    it('increases van stock and clamps at zero on updateSparePartStock("van")', async () => {
      sparePartRepository.findOne.mockResolvedValue({ id: '1', vanStockLevel: 2 });

      const result = await service.updateSparePartStock('1', -10, 'van');

      expect(result).toEqual(expect.objectContaining({ vanStockLevel: 0 }));
    });

    it('leaves the spare part untouched for "main" location updates', async () => {
      const spare = { id: '1', vanStockLevel: 2 };
      sparePartRepository.findOne.mockResolvedValue(spare);

      const result = await service.updateSparePartStock('1', 5, 'main');

      expect(result).toEqual(spare);
      expect(sparePartRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('Spare Part Models', () => {
    it('creates a model when the modelId is unused', async () => {
      sparePartModelRepository.findOne.mockResolvedValue(null);
      const result = await service.createSparePartModel({ modelId: 'M-1' });
      expect(result).toEqual(expect.objectContaining({ modelId: 'M-1' }));
    });

    it('throws ConflictException when the modelId already exists', async () => {
      sparePartModelRepository.findOne.mockResolvedValue({ id: 'x' });
      await expect(service.createSparePartModel({ modelId: 'M-1' })).rejects.toThrow(ConflictException);
    });

    it('lists all models with their spare parts', async () => {
      sparePartModelRepository.find.mockResolvedValue([{ id: '1' }]);
      const result = await service.findAllSparePartModels();
      expect(sparePartModelRepository.find).toHaveBeenCalledWith({ relations: { spareParts: true } });
      expect(result).toEqual([{ id: '1' }]);
    });
  });

  describe('Service Price List', () => {
    it('creates a price list entry', async () => {
      const result = await service.createServicePriceList({ activityType: 'REPAIR' as any });
      expect(result).toEqual(expect.objectContaining({ activityType: 'REPAIR' }));
    });

    it('filters by activity type and active status, optionally by model', async () => {
      const qb = buildQb([{ id: '1' }], true);
      servicePriceListRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findPriceList('REPAIR' as any, 'model-1');

      expect(qb.where).toHaveBeenCalledWith('price.activityType = :activityType', { activityType: 'REPAIR' });
      expect(qb.andWhere).toHaveBeenCalledWith('price.isActive = :isActive', { isActive: true });
      expect(qb.andWhere).toHaveBeenCalledWith('price.modelId = :modelId', { modelId: 'model-1' });
    });

    it('skips the model filter when no modelId is given', async () => {
      const qb = buildQb([], true);
      servicePriceListRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findPriceList('REPAIR' as any);

      expect(qb.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('modelId'),
        expect.anything(),
      );
    });
  });

  describe('Technician KPI Rules', () => {
    it('creates a KPI rule when the name is unused', async () => {
      technicianKpiRuleRepository.findOne.mockResolvedValue(null);
      const result = await service.createKpiRule({ kpiName: 'FTR' });
      expect(result).toEqual(expect.objectContaining({ kpiName: 'FTR' }));
    });

    it('throws ConflictException when the KPI name already exists', async () => {
      technicianKpiRuleRepository.findOne.mockResolvedValue({ id: 'x' });
      await expect(service.createKpiRule({ kpiName: 'FTR' })).rejects.toThrow(ConflictException);
    });

    it('lists only active KPI rules', async () => {
      technicianKpiRuleRepository.find.mockResolvedValue([{ id: '1' }]);
      const result = await service.findAllKpiRules();
      expect(technicianKpiRuleRepository.find).toHaveBeenCalledWith({ where: { isActive: true } });
      expect(result).toEqual([{ id: '1' }]);
    });
  });

  describe('Notification Templates', () => {
    it('creates a template for an unused trigger/channel pair', async () => {
      notificationTemplateRepository.findOne.mockResolvedValue(null);
      const result = await service.createNotificationTemplate({
        trigger: 'APPOINTMENT_CREATED' as any,
        channel: 'SMS' as any,
      });
      expect(result).toEqual(expect.objectContaining({ trigger: 'APPOINTMENT_CREATED' }));
    });

    it('throws ConflictException when a template already exists for the trigger/channel', async () => {
      notificationTemplateRepository.findOne.mockResolvedValue({ id: 'x' });
      await expect(
        service.createNotificationTemplate({ trigger: 'APPOINTMENT_CREATED' as any, channel: 'SMS' as any }),
      ).rejects.toThrow(ConflictException);
    });

    it('finds a single active template by trigger and channel', async () => {
      notificationTemplateRepository.findOne.mockResolvedValue({ id: '1' });
      const result = await service.findTemplate('APPOINTMENT_CREATED' as any, 'SMS' as any);
      expect(result).toEqual({ id: '1' });
    });

    it('lists all active templates', async () => {
      notificationTemplateRepository.find.mockResolvedValue([{ id: '1' }]);
      const result = await service.findAllTemplates();
      expect(result).toEqual([{ id: '1' }]);
    });
  });

  describe('Component Yield Matrix', () => {
    it('creates a yield matrix entry', async () => {
      const result = await service.createComponentYield({ modelId: 'M-1' });
      expect(result).toEqual(expect.objectContaining({ modelId: 'M-1' }));
    });

    it('finds active yield entries for a model', async () => {
      componentYieldMatrixRepository.find.mockResolvedValue([{ id: '1' }]);
      const result = await service.findYieldByModel('M-1');
      expect(componentYieldMatrixRepository.find).toHaveBeenCalledWith({
        where: { modelId: 'M-1', isActive: true },
      });
      expect(result).toEqual([{ id: '1' }]);
    });

    it('finds active yield entries for a recovery category', async () => {
      componentYieldMatrixRepository.find.mockResolvedValue([{ id: '1' }]);
      const result = await service.findYieldByCategory('REFURBISH' as any);
      expect(componentYieldMatrixRepository.find).toHaveBeenCalledWith({
        where: { category: 'REFURBISH', isActive: true },
      });
      expect(result).toEqual([{ id: '1' }]);
    });
  });

  describe('Warranty', () => {
    it('reports no warranty when nothing matches the serial', async () => {
      const qb = buildQb([], true);
      warrantyMasterRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.checkWarranty('SN-123');

      expect(result).toEqual({ isUnderWarranty: false, warrantyPeriodMonths: 0, supplier: 'Unknown' });
    });

    it('reports warranty details from the first matching record', async () => {
      const qb = buildQb(
        [{ warrantyPeriodMonths: 12, supplier: 'Samsung' }],
        true,
      );
      warrantyMasterRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.checkWarranty('SN-123', 'Samsung');

      expect(qb.andWhere).toHaveBeenCalledWith('warranty.brand = :brand', { brand: 'Samsung' });
      expect(result).toEqual({ isUnderWarranty: true, warrantyPeriodMonths: 12, supplier: 'Samsung' });
    });

    it('counts successful imports and skips failures', async () => {
      warrantyMasterRepository.create.mockImplementation((d: any) => d);
      warrantyMasterRepository.save
        .mockResolvedValueOnce({ id: '1' })
        .mockRejectedValueOnce(new Error('bad row'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const count = await service.bulkImportWarrantyMaster([
        { serialNumberRange: 'A' } as any,
        { serialNumberRange: 'B' } as any,
      ]);

      expect(count).toBe(1);
      consoleSpy.mockRestore();
    });
  });

  describe('bulkImportFromCsv', () => {
    it('routes rows to the right creator and counts successes/errors', async () => {
      serviceCentreRepository.findOne.mockResolvedValue(null);
      faultSymptomRepository.findOne.mockResolvedValueOnce({ id: 'dup' });

      const result = await service.bulkImportFromCsv('service-centre', [{ code: 'SC-1' }]);
      expect(result).toEqual({ success: 1, errors: [] });
    });

    it('records an error for an unknown entity type without throwing', async () => {
      const result = await service.bulkImportFromCsv('not-a-type', [{}]);
      expect(result.success).toBe(0);
      expect(result.errors).toEqual(['Unknown entity type: not-a-type']);
    });

    it('captures per-row errors thrown by the underlying create call', async () => {
      faultSymptomRepository.findOne.mockResolvedValue({ id: 'dup' });

      const result = await service.bulkImportFromCsv('fault-symptom', [
        { faultCode: 'F1', symptomCode: 'S1' },
      ]);

      expect(result.success).toBe(0);
      expect(result.errors[0]).toContain('fault-symptom row error');
    });
  });

  describe('linkSparePartToModel', () => {
    it('links a spare part to a model and saves the join', async () => {
      const spare = { id: 'spare-1', code: 'SP-1', models: [] };
      const model = { id: 'model-1', modelId: 'WA80J5710' };
      sparePartRepository.findOne.mockResolvedValue(spare);
      sparePartModelRepository.findOne.mockResolvedValue(model);

      const result = await service.linkSparePartToModel('spare-1', 'model-1');

      expect(result.models).toContainEqual(model);
      expect(sparePartRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'spare-1', models: [model] }),
      );
    });

    it('is idempotent - linking an already-linked model does not duplicate or re-save', async () => {
      const model = { id: 'model-1', modelId: 'WA80J5710' };
      const spare = { id: 'spare-1', code: 'SP-1', models: [model] };
      sparePartRepository.findOne.mockResolvedValue(spare);
      sparePartModelRepository.findOne.mockResolvedValue(model);

      const result = await service.linkSparePartToModel('spare-1', 'model-1');

      expect(result.models).toHaveLength(1);
      expect(sparePartRepository.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the spare part does not exist', async () => {
      sparePartRepository.findOne.mockResolvedValue(null);

      await expect(service.linkSparePartToModel('missing', 'model-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the model does not exist', async () => {
      sparePartRepository.findOne.mockResolvedValue({ id: 'spare-1', models: [] });
      sparePartModelRepository.findOne.mockResolvedValue(null);

      await expect(service.linkSparePartToModel('spare-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });
});
