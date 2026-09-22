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
  let cityRepository: any;
  let cancellationReasonRepository: any;
  let applianceModelRepository: any;
  let billingChannelRepository: any;
  let appointmentFieldConfigRepository: any;
  let userRepository: any;

  const buildQb = (result: any, isMany = false) => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(isMany ? result : []),
    getOne: jest.fn().mockResolvedValue(!isMany ? result : null),
    select: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(isMany ? result : []),
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
    cityRepository = repoFactory();
    cancellationReasonRepository = repoFactory();
    applianceModelRepository = repoFactory();
    billingChannelRepository = repoFactory();
    appointmentFieldConfigRepository = repoFactory();
    userRepository = repoFactory();

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
      cityRepository,
      cancellationReasonRepository,
      applianceModelRepository,
      billingChannelRepository,
      appointmentFieldConfigRepository,
      userRepository,
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

    describe('listActiveFieldTechnicians (#218/#253)', () => {
      it('returns active field technicians as {id, name}, ordered by first/last name', async () => {
        userRepository.find.mockResolvedValue([
          { id: 't1', fullName: 'Ahmed Al Farsi' },
          { id: 't2', fullName: 'Sanjay Rao' },
        ]);

        const result = await service.listActiveFieldTechnicians();

        expect(userRepository.find).toHaveBeenCalledWith({
          where: { role: { name: 'TECHNICIAN_FIELD' }, status: 'ACTIVE' },
          relations: { role: true },
          order: { firstName: 'ASC', lastName: 'ASC' },
        });
        expect(result).toEqual([
          { id: 't1', name: 'Ahmed Al Farsi' },
          { id: 't2', name: 'Sanjay Rao' },
        ]);
      });

      it('returns an empty array when no field technicians are active', async () => {
        userRepository.find.mockResolvedValue([]);

        const result = await service.listActiveFieldTechnicians();

        expect(result).toEqual([]);
      });
    });
  });

  describe('Fault & Symptom', () => {
    it('creates a fault/symptom when codes are unused', async () => {
      faultSymptomRepository.findOne.mockResolvedValue(null);

      const result = await service.createFaultSymptom({ faultCode: 'F1', symptomCode: 'S1' });

      expect(result).toEqual(expect.objectContaining({ faultCode: 'F1' }));
    });

    it('throws ConflictException when the fault code already exists', async () => {
      faultSymptomRepository.findOne.mockResolvedValue({ id: 'x' });

      await expect(
        service.createFaultSymptom({ faultCode: 'F1', symptomCode: 'S1' }),
      ).rejects.toThrow(ConflictException);
      expect(faultSymptomRepository.findOne).toHaveBeenCalledWith({ where: { faultCode: 'F1' } });
    });

    it('does NOT reject a repeated symptom code paired with a new fault code (many faults can share one symptom)', async () => {
      faultSymptomRepository.findOne.mockResolvedValue(null);

      const result = await service.createFaultSymptom({ faultCode: 'F2', symptomCode: 'S1' });

      expect(result).toEqual(expect.objectContaining({ faultCode: 'F2', symptomCode: 'S1' }));
      expect(faultSymptomRepository.findOne).toHaveBeenCalledWith({ where: { faultCode: 'F2' } });
      expect(faultSymptomRepository.findOne).not.toHaveBeenCalledWith({ where: { symptomCode: 'S1' } });
    });

    it('does not check for an existing fault code at all when none is supplied (auto-generation path)', async () => {
      const qb = buildQb([], true);
      faultSymptomRepository.createQueryBuilder.mockReturnValue(qb);

      await service.createFaultSymptom({ symptomDescription: 'No cooling' } as any);

      expect(faultSymptomRepository.findOne).not.toHaveBeenCalled();
    });

    it('auto-generates faultCode/symptomCode from scratch when the master is empty', async () => {
      const qb = buildQb([], true);
      faultSymptomRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.createFaultSymptom({ faultDescription: 'Compressor failure' } as any);

      expect(result).toEqual(expect.objectContaining({ faultCode: 'FLT-0001', symptomCode: 'SYM-0001' }));
    });

    it('auto-generates the next code after the highest existing numeric suffix for that prefix', async () => {
      const qb = buildQb([{ code: 'FLT-0003' }, { code: 'FLT-0007' }, { code: 'FLT-0002' }], true);
      faultSymptomRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.createFaultSymptom({ symptomCode: 'S9' } as any);

      expect(result).toEqual(expect.objectContaining({ faultCode: 'FLT-0008' }));
    });

    it('passes standardRepairMinutes (SRT) through to the created fault symptom when given', async () => {
      faultSymptomRepository.findOne.mockResolvedValue(null);

      const result = await service.createFaultSymptom({
        faultCode: 'F1',
        symptomCode: 'S1',
        standardRepairMinutes: 45,
      });

      expect(result).toEqual(expect.objectContaining({ standardRepairMinutes: 45 }));
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

    it('finds a fault/symptom by id', async () => {
      faultSymptomRepository.findOne.mockResolvedValue({ id: '1', faultCode: 'F1' });
      const result = await service.findFaultSymptomById('1');
      expect(result).toEqual({ id: '1', faultCode: 'F1' });
    });

    it('throws NotFoundException when updating/deleting an unknown fault/symptom id', async () => {
      faultSymptomRepository.findOne.mockResolvedValue(null);
      await expect(service.findFaultSymptomById('nope')).rejects.toThrow(NotFoundException);
      await expect(service.updateFaultSymptom('nope', { faultDescription: 'x' })).rejects.toThrow(NotFoundException);
      await expect(service.deleteFaultSymptom('nope')).rejects.toThrow(NotFoundException);
    });

    it('updates a fault/symptom by id and returns the refreshed row', async () => {
      faultSymptomRepository.findOne
        .mockResolvedValueOnce({ id: '1', faultDescription: 'Old' })
        .mockResolvedValueOnce({ id: '1', faultDescription: 'New' });

      const result = await service.updateFaultSymptom('1', { faultDescription: 'New' });

      expect(faultSymptomRepository.update).toHaveBeenCalledWith('1', { faultDescription: 'New' });
      expect(result).toEqual({ id: '1', faultDescription: 'New' });
    });

    it('soft-deletes (deactivates) a fault/symptom rather than removing the row', async () => {
      faultSymptomRepository.findOne.mockResolvedValue({ id: '1', faultCode: 'F1' });

      await service.deleteFaultSymptom('1');

      expect(faultSymptomRepository.update).toHaveBeenCalledWith('1', { isActive: false });
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

  // Price List rebuild (requested 2026-09-22, Phase 3) - full CRUD + uniqueness on
  // (category, jobType), replacing the old activityType/modelId shape.
  describe('Service Price List', () => {
    it('creates a price list row when the category/jobType combo is unused', async () => {
      servicePriceListRepository.findOne.mockResolvedValue(null);

      const result = await service.createServicePriceList({ category: 'AC' as any, jobType: 'REPAIR' as any });

      expect(servicePriceListRepository.findOne).toHaveBeenCalledWith({
        where: { category: 'AC', jobType: 'REPAIR' },
      });
      expect(result).toEqual(expect.objectContaining({ category: 'AC', jobType: 'REPAIR' }));
    });

    it('throws ConflictException when a row for that category/jobType already exists', async () => {
      servicePriceListRepository.findOne.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createServicePriceList({ category: 'AC' as any, jobType: 'REPAIR' as any }),
      ).rejects.toThrow(ConflictException);
    });

    it('filters active rows, optionally by category and/or job type', async () => {
      const qb = buildQb([{ id: '1' }], true);
      servicePriceListRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAllPriceLists('AC' as any, 'REPAIR' as any);

      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('price.billingChannel', 'billingChannel');
      expect(qb.where).toHaveBeenCalledWith('price.isActive = :isActive', { isActive: true });
      expect(qb.andWhere).toHaveBeenCalledWith('price.category = :category', { category: 'AC' });
      expect(qb.andWhere).toHaveBeenCalledWith('price.jobType = :jobType', { jobType: 'REPAIR' });
      expect(result).toEqual([{ id: '1' }]);
    });

    it('skips both filters when neither category nor jobType is given', async () => {
      const qb = buildQb([], true);
      servicePriceListRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAllPriceLists();

      expect(qb.andWhere).not.toHaveBeenCalledWith(expect.stringContaining('category'), expect.anything());
      expect(qb.andWhere).not.toHaveBeenCalledWith(expect.stringContaining('jobType'), expect.anything());
    });

    it('throws NotFoundException for a missing price list row', async () => {
      servicePriceListRepository.findOne.mockResolvedValue(null);

      await expect(service.findPriceListById('missing')).rejects.toThrow(NotFoundException);
    });

    it('updates rates/status on an existing row', async () => {
      servicePriceListRepository.findOne.mockResolvedValue({ id: '1', category: 'AC', jobType: 'REPAIR' });

      await service.updatePriceList('1', { priceB2B: 150 });

      expect(servicePriceListRepository.update).toHaveBeenCalledWith('1', { priceB2B: 150 });
    });

    it('soft-deletes an existing row', async () => {
      servicePriceListRepository.findOne.mockResolvedValue({ id: '1', category: 'AC', jobType: 'REPAIR' });

      await service.deletePriceList('1');

      expect(servicePriceListRepository.update).toHaveBeenCalledWith('1', { isActive: false });
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

  // Appointment/Mobile/Job Card overhaul (2026-09-16) Phase 1 - City/CancellationReason/
  // ApplianceModel all share the same create/findAll(active-only)/update/soft-delete
  // shape as Service Centre above, so these tests mirror that block's structure.
  describe('City', () => {
    it('creates a city when the name is not already used', async () => {
      cityRepository.findOne.mockResolvedValue(null);

      const result = await service.createCity({ name: 'DXB' });

      expect(cityRepository.save).toHaveBeenCalled();
      expect(result).toMatchObject({ name: 'DXB' });
    });

    it('throws ConflictException when the name is already used', async () => {
      cityRepository.findOne.mockResolvedValue({ id: 'existing', name: 'DXB' });

      await expect(service.createCity({ name: 'DXB' })).rejects.toThrow(ConflictException);
    });

    it('finds only active cities', async () => {
      cityRepository.find.mockResolvedValue([{ id: '1', name: 'DXB', isActive: true }]);

      const result = await service.findAllCities();

      expect(cityRepository.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { name: 'ASC' },
      });
      expect(result).toHaveLength(1);
    });

    it('throws NotFoundException when updating a city that does not exist', async () => {
      cityRepository.findOne.mockResolvedValue(null);

      await expect(service.updateCity('missing', { name: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('soft-deletes (deactivates) a city rather than removing the row', async () => {
      cityRepository.findOne.mockResolvedValue({ id: '1', name: 'DXB', isActive: true });

      await service.deleteCity('1');

      expect(cityRepository.update).toHaveBeenCalledWith('1', { isActive: false });
    });
  });

  // Master-Data/New-Appointment billing modification (requested 2026-09-21) Phase 1 -
  // same create/findAll(active-only)/update/soft-delete shape as City above.
  describe('Billing Channel', () => {
    it('creates a billing channel when the name is not already used', async () => {
      billingChannelRepository.findOne.mockResolvedValue(null);

      const result = await service.createBillingChannel({ name: 'Corporate Interdepartment' });

      expect(billingChannelRepository.save).toHaveBeenCalled();
      expect(result).toMatchObject({ name: 'Corporate Interdepartment' });
    });

    it('throws ConflictException when the name is already used', async () => {
      billingChannelRepository.findOne.mockResolvedValue({ id: 'existing', name: 'Retail' });

      await expect(service.createBillingChannel({ name: 'Retail' })).rejects.toThrow(ConflictException);
    });

    // Phase 5 (2026-09-22, per-appointment Billing Channel override) - createBillingChannel/
    // updateBillingChannel take Partial<BillingChannel> straight through to the repository
    // (no hand-curated field list), so the new defaultRate column needs no service-layer
    // change - just confirming that generic passthrough actually carries it.
    it('persists defaultRate when creating a billing channel', async () => {
      billingChannelRepository.findOne.mockResolvedValue(null);

      const result = await service.createBillingChannel({ name: 'Acme Partner', defaultRate: 450 });

      expect(billingChannelRepository.save).toHaveBeenCalled();
      expect(result).toMatchObject({ name: 'Acme Partner', defaultRate: 450 });
    });

    it('persists defaultRate when updating a billing channel', async () => {
      billingChannelRepository.findOne.mockResolvedValue({ id: '1', name: 'Retail', isActive: true, defaultRate: null });

      await service.updateBillingChannel('1', { defaultRate: 500 });

      expect(billingChannelRepository.update).toHaveBeenCalledWith('1', { defaultRate: 500 });
    });

    it('finds only active billing channels', async () => {
      billingChannelRepository.find.mockResolvedValue([{ id: '1', name: 'Retail', isActive: true }]);

      const result = await service.findAllBillingChannels();

      expect(billingChannelRepository.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { name: 'ASC' },
      });
      expect(result).toHaveLength(1);
    });

    it('throws NotFoundException when updating a billing channel that does not exist', async () => {
      billingChannelRepository.findOne.mockResolvedValue(null);

      await expect(service.updateBillingChannel('missing', { name: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('soft-deletes (deactivates) a billing channel rather than removing the row', async () => {
      billingChannelRepository.findOne.mockResolvedValue({ id: '1', name: 'Retail', isActive: true });

      await service.deleteBillingChannel('1');

      expect(billingChannelRepository.update).toHaveBeenCalledWith('1', { isActive: false });
    });
  });

  // Same request, req. 1 - only isMandatory is ever updated, no create/delete route.
  describe('Appointment Field Config', () => {
    it('lists all field configs ordered by label', async () => {
      appointmentFieldConfigRepository.find.mockResolvedValue([{ id: '1', fieldKey: 'jobType', isMandatory: true }]);

      const result = await service.findAllAppointmentFieldConfigs();

      expect(appointmentFieldConfigRepository.find).toHaveBeenCalledWith({ order: { fieldLabel: 'ASC' } });
      expect(result).toHaveLength(1);
    });

    it('throws NotFoundException when updating a field config that does not exist', async () => {
      appointmentFieldConfigRepository.findOne.mockResolvedValue(null);

      await expect(service.updateAppointmentFieldConfig('missing', true)).rejects.toThrow(NotFoundException);
    });

    it('updates isMandatory on an existing field config', async () => {
      appointmentFieldConfigRepository.findOne.mockResolvedValue({ id: '1', fieldKey: 'jobType', isMandatory: false });

      await service.updateAppointmentFieldConfig('1', true);

      expect(appointmentFieldConfigRepository.update).toHaveBeenCalledWith('1', { isMandatory: true });
    });
  });

  describe('Cancellation Reason', () => {
    it('creates a cancellation reason when the label is not already used', async () => {
      cancellationReasonRepository.findOne.mockResolvedValue(null);

      const result = await service.createCancellationReason({ label: 'Customer not available' });

      expect(cancellationReasonRepository.save).toHaveBeenCalled();
      expect(result).toMatchObject({ label: 'Customer not available' });
    });

    it('throws ConflictException when the label is already used', async () => {
      cancellationReasonRepository.findOne.mockResolvedValue({ id: 'existing' });

      await expect(service.createCancellationReason({ label: 'BER' })).rejects.toThrow(ConflictException);
    });

    it('finds only active cancellation reasons', async () => {
      cancellationReasonRepository.find.mockResolvedValue([{ id: '1', label: 'BER', isActive: true }]);

      const result = await service.findAllCancellationReasons();

      expect(cancellationReasonRepository.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { label: 'ASC' },
      });
      expect(result).toHaveLength(1);
    });

    it('soft-deletes (deactivates) a cancellation reason rather than removing the row', async () => {
      cancellationReasonRepository.findOne.mockResolvedValue({ id: '1', label: 'BER', isActive: true });

      await service.deleteCancellationReason('1');

      expect(cancellationReasonRepository.update).toHaveBeenCalledWith('1', { isActive: false });
    });
  });

  describe('Appliance Model', () => {
    it('creates an appliance model when the brand+model combination is not already used', async () => {
      applianceModelRepository.findOne.mockResolvedValue(null);

      const result = await service.createApplianceModel({ brand: 'Samsung', model: 'RT28' });

      expect(applianceModelRepository.save).toHaveBeenCalled();
      expect(result).toMatchObject({ brand: 'Samsung', model: 'RT28' });
    });

    it('throws ConflictException when the same brand+model combination already exists', async () => {
      applianceModelRepository.findOne.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createApplianceModel({ brand: 'Samsung', model: 'RT28' }),
      ).rejects.toThrow(ConflictException);
    });

    it('finds only active appliance models, optionally filtered by brand', async () => {
      const qb = buildQb([{ id: '1', brand: 'Samsung', model: 'RT28' }], true);
      applianceModelRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAllApplianceModels('Samsung');

      expect(qb.andWhere).toHaveBeenCalledWith('model.brand = :brand', { brand: 'Samsung' });
      expect(result).toHaveLength(1);
    });

    it('soft-deletes (deactivates) an appliance model rather than removing the row', async () => {
      applianceModelRepository.findOne.mockResolvedValue({ id: '1', brand: 'Samsung', model: 'RT28' });

      await service.deleteApplianceModel('1');

      expect(applianceModelRepository.update).toHaveBeenCalledWith('1', { isActive: false });
    });
  });

  describe('bulkImportFromCsv - new master types', () => {
    it('routes a city row to createCity', async () => {
      cityRepository.findOne.mockResolvedValue(null);

      const result = await service.bulkImportFromCsv('city', [{ name: 'SHJ' }]);

      expect(result).toEqual({ success: 1, errors: [] });
    });

    it('routes a cancellation-reason row to createCancellationReason', async () => {
      cancellationReasonRepository.findOne.mockResolvedValue(null);

      const result = await service.bulkImportFromCsv('cancellation-reason', [{ label: 'Not agreed for repair' }]);

      expect(result).toEqual({ success: 1, errors: [] });
    });

    it('routes an appliance-model row to createApplianceModel', async () => {
      applianceModelRepository.findOne.mockResolvedValue(null);

      const result = await service.bulkImportFromCsv('appliance-model', [{ brand: 'LG', model: 'GR-B247' }]);

      expect(result).toEqual({ success: 1, errors: [] });
    });
  });
});
