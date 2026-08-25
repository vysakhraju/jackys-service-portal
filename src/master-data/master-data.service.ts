import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Like, ILike } from 'typeorm';
import { ServiceCentre } from './entities/service-centre.entity';
import { FaultSymptom } from './entities/fault-symptom.entity';
import { SparePart } from './entities/spare-part.entity';
import { SparePartModel } from './entities/spare-part-model.entity';
import { ServicePriceList } from './entities/service-price-list.entity';
import { TechnicianKpiRule } from './entities/technician-kpi-rule.entity';
import { NotificationTemplate } from './entities/notification-template.entity';
import { WarrantyMaster } from './entities/warranty-master.entity';
import { ComponentYieldMatrix } from './entities/component-yield-matrix.entity';
import { Country } from './entities/service-centre.entity';
import { ApplianceCategory } from './entities/fault-symptom.entity';
import { ServiceActivityType } from './entities/service-price-list.entity';
import { NotificationTrigger, NotificationChannel } from './entities/notification-template.entity';
import { RecoveryCategory } from './entities/component-yield-matrix.entity';

@Injectable()
export class MasterDataService {
  constructor(
    @InjectRepository(ServiceCentre)
    private serviceCentreRepository: Repository<ServiceCentre>,
    @InjectRepository(FaultSymptom)
    private faultSymptomRepository: Repository<FaultSymptom>,
    @InjectRepository(SparePart)
    private sparePartRepository: Repository<SparePart>,
    @InjectRepository(SparePartModel)
    private sparePartModelRepository: Repository<SparePartModel>,
    @InjectRepository(ServicePriceList)
    private servicePriceListRepository: Repository<ServicePriceList>,
    @InjectRepository(TechnicianKpiRule)
    private technicianKpiRuleRepository: Repository<TechnicianKpiRule>,
    @InjectRepository(NotificationTemplate)
    private notificationTemplateRepository: Repository<NotificationTemplate>,
    @InjectRepository(WarrantyMaster)
    private warrantyMasterRepository: Repository<WarrantyMaster>,
    @InjectRepository(ComponentYieldMatrix)
    private componentYieldMatrixRepository: Repository<ComponentYieldMatrix>,
  ) {}

  // Service Centre
  async createServiceCentre(data: Partial<ServiceCentre>): Promise<ServiceCentre> {
    const existing = await this.serviceCentreRepository.findOne({ where: { code: data.code } });
    if (existing) {
      throw new ConflictException(`Service centre with code ${data.code} already exists`);
    }
    const centre = this.serviceCentreRepository.create(data);
    return this.serviceCentreRepository.save(centre);
  }

  async findAllServiceCentres(country?: Country): Promise<ServiceCentre[]> {
    const query = this.serviceCentreRepository.createQueryBuilder('centre');
    if (country) {
      query.where('centre.country = :country', { country });
    }
    query.andWhere('centre.isActive = :isActive', { isActive: true });
    return query.getMany();
  }

  async findServiceCentreById(id: string): Promise<ServiceCentre> {
    const centre = await this.serviceCentreRepository.findOne({ where: { id } });
    if (!centre) {
      throw new NotFoundException(`Service centre not found`);
    }
    return centre;
  }

  async updateServiceCentre(id: string, data: Partial<ServiceCentre>): Promise<ServiceCentre> {
    await this.findServiceCentreById(id);
    await this.serviceCentreRepository.update(id, data);
    return this.findServiceCentreById(id);
  }

  async deleteServiceCentre(id: string): Promise<void> {
    await this.findServiceCentreById(id);
    await this.serviceCentreRepository.update(id, { isActive: false });
  }

  // Fault & Symptom
  async createFaultSymptom(data: Partial<FaultSymptom>): Promise<FaultSymptom> {
    const existing = await this.faultSymptomRepository.findOne({
      where: [{ faultCode: data.faultCode }, { symptomCode: data.symptomCode }],
    });
    if (existing) {
      throw new ConflictException('Fault code or symptom code already exists');
    }
    const fault = this.faultSymptomRepository.create(data);
    return this.faultSymptomRepository.save(fault);
  }

  async findAllFaultSymptoms(category?: ApplianceCategory): Promise<FaultSymptom[]> {
    const query = this.faultSymptomRepository.createQueryBuilder('fault');
    query.where('fault.isActive = :isActive', { isActive: true });
    if (category) {
      query.andWhere('fault.category = :category', { category });
    }
    return query.getMany();
  }

  async findFaultByCode(faultCode: string): Promise<FaultSymptom> {
    const fault = await this.faultSymptomRepository.findOne({ where: { faultCode } });
    if (!fault) {
      throw new NotFoundException(`Fault code ${faultCode} not found`);
    }
    return fault;
  }

  async findSymptomByCode(symptomCode: string): Promise<FaultSymptom> {
    const fault = await this.faultSymptomRepository.findOne({ where: { symptomCode } });
    if (!fault) {
      throw new NotFoundException(`Symptom code ${symptomCode} not found`);
    }
    return fault;
  }

  // Spare Parts
  async createSparePart(data: Partial<SparePart>): Promise<SparePart> {
    const existing = await this.sparePartRepository.findOne({ where: { code: data.code } });
    if (existing) {
      throw new ConflictException(`Spare part with code ${data.code} already exists`);
    }
    const spare = this.sparePartRepository.create(data);
    return this.sparePartRepository.save(spare);
  }

  async findAllSpareParts(filters?: { category?: string; brand?: string; active?: boolean }): Promise<SparePart[]> {
    const query = this.sparePartRepository.createQueryBuilder('spare')
      .leftJoinAndSelect('spare.models', 'model');

    if (filters?.category) {
      query.andWhere('spare.category = :category', { category: filters.category });
    }
    if (filters?.brand) {
      query.andWhere('spare.brand = :brand', { brand: filters.brand });
    }
    if (filters?.active !== undefined) {
      query.andWhere('spare.isActive = :active', { active: filters.active });
    } else {
      query.andWhere('spare.isActive = :active', { active: true });
    }

    return query.getMany();
  }

  async findSparePartById(id: string): Promise<SparePart> {
    const spare = await this.sparePartRepository.findOne({
      where: { id },
      relations: { models: true },
    });
    if (!spare) {
      throw new NotFoundException(`Spare part not found`);
    }
    return spare;
  }

  /**
   * Phase 5 (AC-17): GRN refuses to receive stock for a spare part with no linked
   * appliance model. This was the only way to actually create that link - the
   * many-to-many spare_part_model_links table previously had no REST-reachable writer,
   * only the CSV bulk-import path.
   */
  async linkSparePartToModel(sparePartId: string, modelId: string): Promise<SparePart> {
    const spare = await this.sparePartRepository.findOne({ where: { id: sparePartId }, relations: { models: true } });
    if (!spare) {
      throw new NotFoundException(`Spare part not found`);
    }
    const model = await this.sparePartModelRepository.findOne({ where: { id: modelId } });
    if (!model) {
      throw new NotFoundException(`Spare part model not found`);
    }
    if (!spare.models.some((m) => m.id === modelId)) {
      spare.models.push(model);
      await this.sparePartRepository.save(spare);
    }
    return spare;
  }

  async findSparePartsByModel(modelId: string): Promise<SparePart[]> {
    return this.sparePartRepository
      .createQueryBuilder('spare')
      .innerJoin('spare.models', 'model', 'model.modelId = :modelId', { modelId })
      .where('spare.isActive = :active', { active: true })
      .getMany();
  }

  async updateSparePartStock(id: string, quantity: number, location: 'main' | 'van'): Promise<SparePart> {
    const spare = await this.findSparePartById(id);
    if (location === 'main') {
      // This will be handled by inventory reservations
      return spare;
    } else if (location === 'van') {
      spare.vanStockLevel = Math.max(0, spare.vanStockLevel + quantity);
      return this.sparePartRepository.save(spare);
    }
    return spare;
  }

  // Spare Part Models
  async createSparePartModel(data: Partial<SparePartModel>): Promise<SparePartModel> {
    const existing = await this.sparePartModelRepository.findOne({ where: { modelId: data.modelId } });
    if (existing) {
      throw new ConflictException(`Model ${data.modelId} already exists`);
    }
    const model = this.sparePartModelRepository.create(data);
    return this.sparePartModelRepository.save(model);
  }

  async findAllSparePartModels(): Promise<SparePartModel[]> {
    return this.sparePartModelRepository.find({ relations: { spareParts: true } });
  }

  // Service Price List
  async createServicePriceList(data: Partial<ServicePriceList>): Promise<ServicePriceList> {
    const price = this.servicePriceListRepository.create(data);
    return this.servicePriceListRepository.save(price);
  }

  async findPriceList(activityType: ServiceActivityType, modelId?: string): Promise<ServicePriceList[]> {
    const query = this.servicePriceListRepository.createQueryBuilder('price')
      .where('price.activityType = :activityType', { activityType })
      .andWhere('price.isActive = :isActive', { isActive: true });

    if (modelId) {
      query.andWhere('price.modelId = :modelId', { modelId });
    }

    return query.getMany();
  }

  // Technician KPI Rules
  async createKpiRule(data: Partial<TechnicianKpiRule>): Promise<TechnicianKpiRule> {
    const existing = await this.technicianKpiRuleRepository.findOne({ where: { kpiName: data.kpiName } });
    if (existing) {
      throw new ConflictException(`KPI rule ${data.kpiName} already exists`);
    }
    const rule = this.technicianKpiRuleRepository.create(data);
    return this.technicianKpiRuleRepository.save(rule);
  }

  async findAllKpiRules(): Promise<TechnicianKpiRule[]> {
    return this.technicianKpiRuleRepository.find({ where: { isActive: true } });
  }

  // Notification Templates
  async createNotificationTemplate(data: Partial<NotificationTemplate>): Promise<NotificationTemplate> {
    const existing = await this.notificationTemplateRepository.findOne({
      where: { trigger: data.trigger, channel: data.channel },
    });
    if (existing) {
      throw new ConflictException(`Template for ${data.trigger} on ${data.channel} already exists`);
    }
    const template = this.notificationTemplateRepository.create(data);
    return this.notificationTemplateRepository.save(template);
  }

  async findTemplate(trigger: NotificationTrigger, channel: NotificationChannel): Promise<NotificationTemplate | null> {
    return this.notificationTemplateRepository.findOne({
      where: { trigger, channel, isActive: true },
    });
  }

  async findAllTemplates(): Promise<NotificationTemplate[]> {
    return this.notificationTemplateRepository.find({ where: { isActive: true } });
  }

  // Warranty Master
  async createWarrantyMaster(data: Partial<WarrantyMaster>): Promise<WarrantyMaster> {
    const warranty = this.warrantyMasterRepository.create(data);
    return this.warrantyMasterRepository.save(warranty);
  }

  async findWarrantyBySerial(serialNumber: string, brand?: string): Promise<WarrantyMaster[]> {
    // serialNumberRange is stored as a single "START-END" string (e.g. "SN100000-SN199999").
    // The original query compared `:serial BETWEEN warranty.serialNumberRange AND
    // warranty.serialNumberRange` - a range of one value against itself - which only ever
    // matched a serial equal to the literal range string, so warranty lookups always came
    // back empty for any real serial number. Split the range and compare lexicographically
    // against both bounds instead (fine as long as serials in a range share a common format).
    const query = this.warrantyMasterRepository.createQueryBuilder('warranty')
      .where('warranty.isActive = :isActive', { isActive: true })
      .andWhere(
        ':serial BETWEEN split_part(warranty."serialNumberRange", \'-\', 1) AND split_part(warranty."serialNumberRange", \'-\', 2)',
        { serial: serialNumber },
      );

    if (brand) {
      query.andWhere('warranty.brand = :brand', { brand });
    }

    return query.getMany();
  }

  async checkWarranty(serialNumber: string, brand?: string): Promise<{
    isUnderWarranty: boolean;
    warrantyPeriodMonths: number;
    supplier: string;
  }> {
    const warranties = await this.findWarrantyBySerial(serialNumber, brand);

    if (warranties.length === 0) {
      return { isUnderWarranty: false, warrantyPeriodMonths: 0, supplier: 'Unknown' };
    }

    // For simplicity, return the first match
    const warranty = warranties[0];
    return {
      isUnderWarranty: true,
      warrantyPeriodMonths: warranty.warrantyPeriodMonths,
      supplier: warranty.supplier,
    };
  }

  async bulkImportWarrantyMaster(data: Partial<WarrantyMaster>[]): Promise<number> {
    let count = 0;
    for (const item of data) {
      try {
        await this.createWarrantyMaster(item);
        count++;
      } catch (error) {
        console.error(`Failed to import warranty for ${item.serialNumberRange}:`, error);
      }
    }
    return count;
  }

  // Component Yield Matrix
  async createComponentYield(data: Partial<ComponentYieldMatrix>): Promise<ComponentYieldMatrix> {
    const yieldMatrix = this.componentYieldMatrixRepository.create(data);
    return this.componentYieldMatrixRepository.save(yieldMatrix);
  }

  async findYieldByModel(modelId: string): Promise<ComponentYieldMatrix[]> {
    return this.componentYieldMatrixRepository.find({
      where: { modelId, isActive: true },
    });
  }

  async findYieldByCategory(category: RecoveryCategory): Promise<ComponentYieldMatrix[]> {
    return this.componentYieldMatrixRepository.find({
      where: { category, isActive: true },
    });
  }

  // Bulk import from CSV/Excel
  async bulkImportFromCsv(entityType: string, data: any[]): Promise<{ success: number; errors: string[] }> {
    const errors: string[] = [];
    let success = 0;

    for (const row of data) {
      try {
        switch (entityType) {
          case 'service-centre':
            await this.createServiceCentre(row);
            break;
          case 'fault-symptom':
            await this.createFaultSymptom(row);
            break;
          case 'spare-part':
            await this.createSparePart(row);
            break;
          case 'spare-part-model':
            await this.createSparePartModel(row);
            break;
          case 'price-list':
            await this.createServicePriceList(row);
            break;
          case 'kpi-rule':
            await this.createKpiRule(row);
            break;
          case 'notification-template':
            await this.createNotificationTemplate(row);
            break;
          case 'warranty-master':
            await this.createWarrantyMaster(row);
            break;
          case 'component-yield':
            await this.createComponentYield(row);
            break;
          default:
            errors.push(`Unknown entity type: ${entityType}`);
            continue;
        }
        success++;
      } catch (error) {
        errors.push(`${entityType} row error: ${error.message}`);
      }
    }

    return { success, errors };
  }
}