import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiBody } from '@nestjs/swagger';
import { MasterDataService } from './master-data.service';
import { CreateServiceCentreDto, UpdateServiceCentreDto } from './dto/create-service-centre.dto';
import { CreateFaultSymptomDto } from './dto/create-fault-symptom.dto';
import { CreateSparePartDto } from './dto/create-spare-part.dto';
import { CreateSparePartModelDto } from './dto/create-spare-part-model.dto';
import { LinkSparePartModelDto } from './dto/link-spare-part-model.dto';
import { CreatePriceListDto } from './dto/create-price-list.dto';
import { CreateKpiRuleDto } from './dto/create-kpi-rule.dto';
import { CreateNotificationTemplateDto } from './dto/create-notification-template.dto';
import { CreateWarrantyMasterDto } from './dto/create-warranty-master.dto';
import { CreateComponentYieldDto } from './dto/create-component-yield.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequiresCapability } from '../auth/decorators/requires-capability.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction } from '../auth/entities/audit-log.entity';
import { Country } from './entities/service-centre.entity';
import { ApplianceCategory } from './entities/fault-symptom.entity';
import { ServiceActivityType } from './entities/service-price-list.entity';
import { NotificationTrigger, NotificationChannel } from './entities/notification-template.entity';
import { RecoveryCategory } from './entities/component-yield-matrix.entity';
import { ServiceCentre } from './entities/service-centre.entity';
import { FaultSymptom } from './entities/fault-symptom.entity';
import { SparePart } from './entities/spare-part.entity';
import { SparePartModel } from './entities/spare-part-model.entity';
import { ServicePriceList } from './entities/service-price-list.entity';
import { TechnicianKpiRule } from './entities/technician-kpi-rule.entity';
import { NotificationTemplate } from './entities/notification-template.entity';
import { WarrantyMaster } from './entities/warranty-master.entity';
import { ComponentYieldMatrix } from './entities/component-yield-matrix.entity';

@ApiTags('master-data')
@Controller('master-data')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class MasterDataController {
  constructor(private masterDataService: MasterDataService) {}

  // === Service Centres ===
  // createServiceCentre/updateServiceCentre migrated onto the designation permission matrix
  // (2026-09-10) as MASTER_DATA_SERVICE_CENTRE_CREATE/_UPDATE - see capability-catalog.ts's
  // "Master Data" section. deleteServiceCentre below is deliberately NOT migrated: its
  // @Roles('SUPER_ADMIN') is asymmetric (SUPER_ADMIN only, no SERVICE_HEAD), and the
  // matrix's SUPER_ADMIN+SERVICE_HEAD bypass can't preserve that - same finding as
  // Warranty Claims' CREDIT_NOTE_ROLES (2026-09-10).
  @Post('service-centres')
  @RequiresCapability('MASTER_DATA_SERVICE_CENTRE_CREATE')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CREATE,
    entityType: 'ServiceCentre',
    getEntityId: (args) => args.body?.code,
  })
  @ApiOperation({ summary: 'Create service centre' })
  @ApiBody({ type: CreateServiceCentreDto })
  @ApiResponse({ status: 201, type: ServiceCentre })
  createServiceCentre(@Body() data: CreateServiceCentreDto) {
    return this.masterDataService.createServiceCentre(data);
  }

  @Get('service-centres')
  @ApiOperation({ summary: 'Get all service centres' })
  @ApiQuery({ name: 'country', required: false, enum: Country })
  @ApiResponse({ status: 200, type: [ServiceCentre] })
  findAllServiceCentres(@Query('country') country?: Country) {
    return this.masterDataService.findAllServiceCentres(country);
  }

  @Get('service-centres/:id')
  @ApiOperation({ summary: 'Get service centre by ID' })
  @ApiResponse({ status: 200, type: ServiceCentre })
  findServiceCentre(@Param('id') id: string) {
    return this.masterDataService.findServiceCentreById(id);
  }

  @Put('service-centres/:id')
  @RequiresCapability('MASTER_DATA_SERVICE_CENTRE_UPDATE')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'ServiceCentre',
    getEntityId: (args) => args.params?.id,
  })
  @ApiOperation({ summary: 'Update service centre' })
  @ApiBody({ type: UpdateServiceCentreDto })
  @ApiResponse({ status: 200, type: ServiceCentre })
  updateServiceCentre(@Param('id') id: string, @Body() data: UpdateServiceCentreDto) {
    return this.masterDataService.updateServiceCentre(id, data);
  }

  // Deliberately still hardcoded @Roles('SUPER_ADMIN') - asymmetric (no SERVICE_HEAD),
  // cannot be migrated onto the matrix without silently widening SERVICE_HEAD's access.
  @Delete('service-centres/:id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete service centre (soft)' })
  deleteServiceCentre(@Param('id') id: string) {
    return this.masterDataService.deleteServiceCentre(id);
  }

  // === Fault & Symptoms ===
  @Post('fault-symptoms')
  @RequiresCapability('MASTER_DATA_FAULT_SYMPTOM_MANAGE')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CREATE,
    entityType: 'FaultSymptom',
    getEntityId: (args) => args.body?.faultCode,
  })
  @ApiOperation({ summary: 'Create fault/symptom' })
  @ApiBody({ type: CreateFaultSymptomDto })
  @ApiResponse({ status: 201, type: FaultSymptom })
  createFaultSymptom(@Body() data: CreateFaultSymptomDto) {
    return this.masterDataService.createFaultSymptom(data);
  }

  @Get('fault-symptoms')
  @ApiOperation({ summary: 'Get all fault/symptoms' })
  @ApiQuery({ name: 'category', required: false, enum: ApplianceCategory })
  @ApiResponse({ status: 200, type: [FaultSymptom] })
  findAllFaultSymptoms(@Query('category') category?: ApplianceCategory) {
    return this.masterDataService.findAllFaultSymptoms(category);
  }

  @Get('fault-symptoms/code/:faultCode')
  @ApiOperation({ summary: 'Find fault by code' })
  @ApiResponse({ status: 200, type: FaultSymptom })
  findFaultByCode(@Param('faultCode') faultCode: string) {
    return this.masterDataService.findFaultByCode(faultCode);
  }

  @Get('fault-symptoms/symptom/:symptomCode')
  @ApiOperation({ summary: 'Find symptom by code' })
  @ApiResponse({ status: 200, type: FaultSymptom })
  findSymptomByCode(@Param('symptomCode') symptomCode: string) {
    return this.masterDataService.findSymptomByCode(symptomCode);
  }

  // === Spare Parts ===
  @Post('spare-parts')
  @RequiresCapability('MASTER_DATA_SPARE_PARTS_MANAGE')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CREATE,
    entityType: 'SparePart',
    getEntityId: (args) => args.body?.code,
  })
  @ApiOperation({ summary: 'Create spare part' })
  @ApiBody({ type: CreateSparePartDto })
  @ApiResponse({ status: 201, type: SparePart })
  createSparePart(@Body() data: CreateSparePartDto) {
    return this.masterDataService.createSparePart(data);
  }

  @Get('spare-parts')
  @ApiOperation({ summary: 'Get all spare parts' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'brand', required: false })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  @ApiResponse({ status: 200, type: [SparePart] })
  findAllSpareParts(
    @Query('category') category?: string,
    @Query('brand') brand?: string,
    @Query('active') active?: string,
  ) {
    return this.masterDataService.findAllSpareParts({
      category,
      brand,
      active: active === undefined ? undefined : active === 'true',
    });
  }

  @Get('spare-parts/:id')
  @ApiOperation({ summary: 'Get spare part by ID' })
  @ApiResponse({ status: 200, type: SparePart })
  findSparePart(@Param('id') id: string) {
    return this.masterDataService.findSparePartById(id);
  }

  @Get('spare-parts/model/:modelId')
  @ApiOperation({ summary: 'Get spare parts by model' })
  @ApiResponse({ status: 200, type: [SparePart] })
  findSparePartsByModel(@Param('modelId') modelId: string) {
    return this.masterDataService.findSparePartsByModel(modelId);
  }

  @Post('spare-parts/:id/link-model')
  @RequiresCapability('MASTER_DATA_SPARE_PARTS_MANAGE')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'SparePart',
    getEntityId: (args) => args.params?.id,
  })
  @ApiOperation({ summary: 'Link a spare part to an appliance model (required before GRN will accept stock for it - AC-17)' })
  @ApiBody({ type: LinkSparePartModelDto })
  @ApiResponse({ status: 200, type: SparePart })
  linkSparePartToModel(@Param('id') id: string, @Body() dto: LinkSparePartModelDto) {
    return this.masterDataService.linkSparePartToModel(id, dto.modelId);
  }

  // === Spare Part Models ===
  @Post('spare-part-models')
  @RequiresCapability('MASTER_DATA_SPARE_PARTS_MANAGE')
  @ApiOperation({ summary: 'Create spare part model' })
  @ApiBody({ type: CreateSparePartModelDto })
  @ApiResponse({ status: 201, type: SparePartModel })
  createSparePartModel(@Body() data: CreateSparePartModelDto) {
    return this.masterDataService.createSparePartModel(data);
  }

  @Get('spare-part-models')
  @ApiOperation({ summary: 'Get all spare part models' })
  @ApiResponse({ status: 200, type: [SparePartModel] })
  findAllSparePartModels() {
    return this.masterDataService.findAllSparePartModels();
  }

  // === Service Price List ===
  @Post('price-lists')
  @RequiresCapability('MASTER_DATA_PRICE_LIST_MANAGE')
  @ApiOperation({ summary: 'Create service price list' })
  @ApiBody({ type: CreatePriceListDto })
  @ApiResponse({ status: 201, type: ServicePriceList })
  createPriceList(@Body() data: CreatePriceListDto) {
    return this.masterDataService.createServicePriceList(data);
  }

  @Get('price-lists')
  @ApiOperation({ summary: 'Get price list by activity type' })
  @ApiQuery({ name: 'activityType', required: true, enum: ServiceActivityType })
  @ApiQuery({ name: 'modelId', required: false })
  @ApiResponse({ status: 200, type: [ServicePriceList] })
  findPriceList(
    @Query('activityType') activityType: ServiceActivityType,
    @Query('modelId') modelId?: string,
  ) {
    return this.masterDataService.findPriceList(activityType, modelId);
  }

  // === Technician KPI Rules ===
  @Post('kpi-rules')
  @RequiresCapability('MASTER_DATA_KPI_RULE_MANAGE')
  @ApiOperation({ summary: 'Create technician KPI rule' })
  @ApiBody({ type: CreateKpiRuleDto })
  @ApiResponse({ status: 201, type: TechnicianKpiRule })
  createKpiRule(@Body() data: CreateKpiRuleDto) {
    return this.masterDataService.createKpiRule(data);
  }

  @Get('kpi-rules')
  @ApiOperation({ summary: 'Get all KPI rules' })
  @ApiResponse({ status: 200, type: [TechnicianKpiRule] })
  findAllKpiRules() {
    return this.masterDataService.findAllKpiRules();
  }

  // === Notification Templates ===
  @Post('notification-templates')
  @RequiresCapability('MASTER_DATA_NOTIFICATION_TEMPLATE_MANAGE')
  @ApiOperation({ summary: 'Create notification template' })
  @ApiBody({ type: CreateNotificationTemplateDto })
  @ApiResponse({ status: 201, type: NotificationTemplate })
  createNotificationTemplate(@Body() data: CreateNotificationTemplateDto) {
    return this.masterDataService.createNotificationTemplate(data);
  }

  @Get('notification-templates')
  @ApiOperation({ summary: 'Get all notification templates' })
  @ApiResponse({ status: 200, type: [NotificationTemplate] })
  findAllTemplates() {
    return this.masterDataService.findAllTemplates();
  }

  @Get('notification-templates/:trigger/:channel')
  @ApiOperation({ summary: 'Get notification template by trigger & channel' })
  @ApiResponse({ status: 200, type: NotificationTemplate })
  findTemplate(
    @Param('trigger') trigger: NotificationTrigger,
    @Param('channel') channel: NotificationChannel,
  ) {
    return this.masterDataService.findTemplate(trigger, channel);
  }

  // === Warranty Master ===
  @Post('warranty-master')
  @RequiresCapability('MASTER_DATA_WARRANTY_MASTER_MANAGE')
  @ApiOperation({ summary: 'Create warranty master entry' })
  @ApiBody({ type: CreateWarrantyMasterDto })
  @ApiResponse({ status: 201, type: WarrantyMaster })
  createWarrantyMaster(@Body() data: CreateWarrantyMasterDto) {
    return this.masterDataService.createWarrantyMaster({
      ...data,
      effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : undefined,
      effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : undefined,
    });
  }

  @Get('warranty-master/check/:serialNumber')
  @ApiQuery({ name: 'brand', required: false })
  @ApiOperation({ summary: 'Check warranty status by serial number' })
  @ApiResponse({ status: 200 })
  checkWarranty(
    @Param('serialNumber') serialNumber: string,
    @Query('brand') brand?: string,
  ) {
    return this.masterDataService.checkWarranty(serialNumber, brand);
  }

  // === Component Yield Matrix ===
  @Post('component-yield')
  @RequiresCapability('MASTER_DATA_COMPONENT_YIELD_MANAGE')
  @ApiOperation({ summary: 'Create component yield matrix entry' })
  @ApiBody({ type: CreateComponentYieldDto })
  @ApiResponse({ status: 201, type: ComponentYieldMatrix })
  createComponentYield(@Body() data: CreateComponentYieldDto) {
    return this.masterDataService.createComponentYield(data);
  }

  @Get('component-yield/model/:modelId')
  @ApiOperation({ summary: 'Get component yield by model' })
  @ApiResponse({ status: 200, type: [ComponentYieldMatrix] })
  findYieldByModel(@Param('modelId') modelId: string) {
    return this.masterDataService.findYieldByModel(modelId);
  }

  @Get('component-yield/category/:category')
  @ApiOperation({ summary: 'Get component yield by recovery category' })
  @ApiResponse({ status: 200, type: [ComponentYieldMatrix] })
  findYieldByCategory(@Param('category') category: RecoveryCategory) {
    return this.masterDataService.findYieldByCategory(category);
  }

  // === Bulk Import ===
  @Post('bulk-import/:entityType')
  @RequiresCapability('MASTER_DATA_BULK_IMPORT')
  @ApiOperation({ summary: 'Bulk import master data from CSV/Excel' })
  @ApiResponse({ status: 200 })
  bulkImport(@Param('entityType') entityType: string, @Body() data: any[]) {
    return this.masterDataService.bulkImportFromCsv(entityType, data);
  }
}