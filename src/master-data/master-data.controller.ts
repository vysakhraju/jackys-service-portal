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
import { CreateFaultSymptomDto, UpdateFaultSymptomDto } from './dto/create-fault-symptom.dto';
import { CreateSparePartDto } from './dto/create-spare-part.dto';
import { CreateSparePartModelDto } from './dto/create-spare-part-model.dto';
import { LinkSparePartModelDto } from './dto/link-spare-part-model.dto';
import { CreatePriceListDto } from './dto/create-price-list.dto';
import { CreateKpiRuleDto } from './dto/create-kpi-rule.dto';
import { CreateNotificationTemplateDto } from './dto/create-notification-template.dto';
import { CreateWarrantyMasterDto } from './dto/create-warranty-master.dto';
import { CreateComponentYieldDto } from './dto/create-component-yield.dto';
import { CreateCityDto, UpdateCityDto } from './dto/create-city.dto';
import { CreateCancellationReasonDto, UpdateCancellationReasonDto } from './dto/create-cancellation-reason.dto';
import { CreateApplianceModelDto, UpdateApplianceModelDto } from './dto/create-appliance-model.dto';
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
import { City } from './entities/city.entity';
import { CancellationReason } from './entities/cancellation-reason.entity';
import { ApplianceModel } from './entities/appliance-model.entity';

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

  @Get('service-centres/field-technicians')
  @RequiresCapability('MASTER_DATA_SERVICE_CENTRE_CREATE')
  @ApiOperation({ summary: '#218: list active Field Technician users, for the Service Centres name-based picker (GET /users is admin-only, GET /technician-schedule/gantt is Team-Leader-only - neither reachable by CCE, who creates/edits centres)' })
  @ApiResponse({ status: 200, description: 'Active field technicians as {id, name}' })
  listFieldTechnicians() {
    return this.masterDataService.listActiveFieldTechnicians();
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

  // findAllFaultSymptoms/findFaultByCode/findSymptomByCode gated MASTER_DATA_VIEW
  // (2026-09-14, live-tested finding): a real gap, not a migration - these had NO
  // @Roles()/@RequiresCapability() at all before, so RolesGuard (fails open with no
  // decorator) let any authenticated user browse them. Confirmed unused anywhere outside
  // the Master Data admin UI (FaultSymptomsPage) before adding this gate, so nothing else
  // in the app breaks - see capability-catalog.ts's MASTER_DATA_VIEW entry for the full
  // reasoning and which endpoints were deliberately left open instead.
  @Get('fault-symptoms')
  @RequiresCapability('MASTER_DATA_VIEW')
  @ApiOperation({ summary: 'Get all fault/symptoms' })
  @ApiQuery({ name: 'category', required: false, enum: ApplianceCategory })
  @ApiResponse({ status: 200, type: [FaultSymptom] })
  findAllFaultSymptoms(@Query('category') category?: ApplianceCategory) {
    return this.masterDataService.findAllFaultSymptoms(category);
  }

  @Get('fault-symptoms/code/:faultCode')
  @RequiresCapability('MASTER_DATA_VIEW')
  @ApiOperation({ summary: 'Find fault by code' })
  @ApiResponse({ status: 200, type: FaultSymptom })
  findFaultByCode(@Param('faultCode') faultCode: string) {
    return this.masterDataService.findFaultByCode(faultCode);
  }

  @Get('fault-symptoms/symptom/:symptomCode')
  @RequiresCapability('MASTER_DATA_VIEW')
  @ApiOperation({ summary: 'Find symptom by code' })
  @ApiResponse({ status: 200, type: FaultSymptom })
  findSymptomByCode(@Param('symptomCode') symptomCode: string) {
    return this.masterDataService.findSymptomByCode(symptomCode);
  }

  // #301 follow-up: previously create+list only - a typo needed a direct DB fix and
  // there was no way to retire a row at all. Same MANAGE/SUPER_ADMIN split as City/
  // Cancellation Reason/Appliance Model above: full edit via MANAGE, soft-delete
  // hardcoded to Super Admin (deactivate is the same operation via PUT with
  // isActive:false, for anyone holding MASTER_DATA_FAULT_SYMPTOM_MANAGE).
  @Put('fault-symptoms/:id')
  @RequiresCapability('MASTER_DATA_FAULT_SYMPTOM_MANAGE')
  @UseInterceptors(AuditInterceptor)
  @Audit({ action: AuditAction.UPDATE, entityType: 'FaultSymptom', getEntityId: (args) => args.params?.id })
  @ApiOperation({ summary: 'Update a fault/symptom (also used to reactivate one)' })
  @ApiBody({ type: UpdateFaultSymptomDto })
  @ApiResponse({ status: 200, type: FaultSymptom })
  updateFaultSymptom(@Param('id') id: string, @Body() data: UpdateFaultSymptomDto) {
    return this.masterDataService.updateFaultSymptom(id, data);
  }

  @Delete('fault-symptoms/:id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete a fault/symptom (soft)' })
  deleteFaultSymptom(@Param('id') id: string) {
    return this.masterDataService.deleteFaultSymptom(id);
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

  // Gated MASTER_DATA_VIEW (2026-09-14) - confirmed only used by the Master Data admin UI
  // (SparePartModelsPage, and via useSparePartModelOptions by PriceListsPage/
  // ComponentYieldPage's own model pickers - both themselves Master Data admin pages), not
  // by any operational flow elsewhere. See MASTER_DATA_VIEW's own catalog comment.
  @Get('spare-part-models')
  @RequiresCapability('MASTER_DATA_VIEW')
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

  // Gated MASTER_DATA_VIEW (2026-09-14) - confirmed only called from PriceListsPage (Master
  // Data admin). Estimates/Invoicing compute prices via MasterDataService directly in-
  // process, never through this HTTP route, so they're unaffected.
  @Get('price-lists')
  @RequiresCapability('MASTER_DATA_VIEW')
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

  // Gated MASTER_DATA_VIEW (2026-09-14) - only used by KpiRulesPage (Master Data admin).
  @Get('kpi-rules')
  @RequiresCapability('MASTER_DATA_VIEW')
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

  // Gated MASTER_DATA_VIEW (2026-09-14) - only used by NotificationTemplatesPage (Master
  // Data admin). The actual notification-sending flow reads templates via
  // MasterDataService directly in-process, never through this HTTP route.
  @Get('notification-templates')
  @RequiresCapability('MASTER_DATA_VIEW')
  @ApiOperation({ summary: 'Get all notification templates' })
  @ApiResponse({ status: 200, type: [NotificationTemplate] })
  findAllTemplates() {
    return this.masterDataService.findAllTemplates();
  }

  @Get('notification-templates/:trigger/:channel')
  @RequiresCapability('MASTER_DATA_VIEW')
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

  // Gated MASTER_DATA_VIEW (2026-09-14) - only used by WarrantyMasterPage (Master Data
  // admin) as a manual lookup tool. The real S/N warranty check during a technician's
  // field visit (TechnicianService.captureSerialNumber, FR-03) calls
  // MasterDataService.checkWarranty() directly in-process, never through this HTTP route.
  @Get('warranty-master/check/:serialNumber')
  @RequiresCapability('MASTER_DATA_VIEW')
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

  // Gated MASTER_DATA_VIEW (2026-09-14) - only used by ComponentYieldPage (Master Data
  // admin). findYieldByModel just above is deliberately left open - HarvestModal
  // (Dismantling, used by technicians logging harvested components) calls it directly.
  @Get('component-yield/category/:category')
  @RequiresCapability('MASTER_DATA_VIEW')
  @ApiOperation({ summary: 'Get component yield by recovery category' })
  @ApiResponse({ status: 200, type: [ComponentYieldMatrix] })
  findYieldByCategory(@Param('category') category: RecoveryCategory) {
    return this.masterDataService.findYieldByCategory(category);
  }

  // === City === (Appointment/Mobile/Job Card overhaul, 2026-09-16 Phase 1, req. 1c)
  // List is deliberately open (no capability check) - same exception as service-centres/
  // spare-parts list above: this backs the New Appointment popup's City dropdown for
  // every CCE-type user, not just Master Data admins, so gating it behind MASTER_DATA_VIEW
  // (default: nobody) would break appointment creation for everyone until a Super Admin
  // separately granted that too.
  @Post('cities')
  @RequiresCapability('MASTER_DATA_CITY_MANAGE')
  @UseInterceptors(AuditInterceptor)
  @Audit({ action: AuditAction.CREATE, entityType: 'City', getEntityId: (args) => args.body?.name })
  @ApiOperation({ summary: 'Create a city' })
  @ApiBody({ type: CreateCityDto })
  @ApiResponse({ status: 201, type: City })
  createCity(@Body() data: CreateCityDto) {
    return this.masterDataService.createCity(data);
  }

  @Get('cities')
  @ApiOperation({ summary: 'Get all active cities' })
  @ApiResponse({ status: 200, type: [City] })
  findAllCities() {
    return this.masterDataService.findAllCities();
  }

  @Put('cities/:id')
  @RequiresCapability('MASTER_DATA_CITY_MANAGE')
  @UseInterceptors(AuditInterceptor)
  @Audit({ action: AuditAction.UPDATE, entityType: 'City', getEntityId: (args) => args.params?.id })
  @ApiOperation({ summary: 'Update a city (also used to reactivate one)' })
  @ApiBody({ type: UpdateCityDto })
  @ApiResponse({ status: 200, type: City })
  updateCity(@Param('id') id: string, @Body() data: UpdateCityDto) {
    return this.masterDataService.updateCity(id, data);
  }

  // Hardcoded @Roles('SUPER_ADMIN') rather than a capability - same asymmetric pattern as
  // deleteServiceCentre above (this is the "delete" the request explicitly asked to be a
  // Super Admin action; "deactivate" is the same operation via PUT above with
  // isActive:false, for anyone holding MASTER_DATA_CITY_MANAGE).
  @Delete('cities/:id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete a city (soft)' })
  deleteCity(@Param('id') id: string) {
    return this.masterDataService.deleteCity(id);
  }

  // === Cancellation Reason === (req. 3f - mobile Cancellation action's reason dropdown)
  // List also deliberately open - the mobile Cancellation screen needs it for every field
  // technician, not just Master Data admins.
  @Post('cancellation-reasons')
  @RequiresCapability('MASTER_DATA_CANCELLATION_REASON_MANAGE')
  @UseInterceptors(AuditInterceptor)
  @Audit({ action: AuditAction.CREATE, entityType: 'CancellationReason', getEntityId: (args) => args.body?.label })
  @ApiOperation({ summary: 'Create a cancellation reason' })
  @ApiBody({ type: CreateCancellationReasonDto })
  @ApiResponse({ status: 201, type: CancellationReason })
  createCancellationReason(@Body() data: CreateCancellationReasonDto) {
    return this.masterDataService.createCancellationReason(data);
  }

  @Get('cancellation-reasons')
  @ApiOperation({ summary: 'Get all active cancellation reasons' })
  @ApiResponse({ status: 200, type: [CancellationReason] })
  findAllCancellationReasons() {
    return this.masterDataService.findAllCancellationReasons();
  }

  @Put('cancellation-reasons/:id')
  @RequiresCapability('MASTER_DATA_CANCELLATION_REASON_MANAGE')
  @UseInterceptors(AuditInterceptor)
  @Audit({ action: AuditAction.UPDATE, entityType: 'CancellationReason', getEntityId: (args) => args.params?.id })
  @ApiOperation({ summary: 'Update a cancellation reason (also used to reactivate one)' })
  @ApiBody({ type: UpdateCancellationReasonDto })
  @ApiResponse({ status: 200, type: CancellationReason })
  updateCancellationReason(@Param('id') id: string, @Body() data: UpdateCancellationReasonDto) {
    return this.masterDataService.updateCancellationReason(id, data);
  }

  @Delete('cancellation-reasons/:id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete a cancellation reason (soft)' })
  deleteCancellationReason(@Param('id') id: string) {
    return this.masterDataService.deleteCancellationReason(id);
  }

  // === Appliance Model === (req. 1e - New Appointment popup's Brand + Model dropdowns)
  // List also deliberately open, same reasoning as City/Cancellation Reason above.
  @Post('appliance-models')
  @RequiresCapability('MASTER_DATA_APPLIANCE_MODEL_MANAGE')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CREATE,
    entityType: 'ApplianceModel',
    getEntityId: (args) => `${args.body?.brand} ${args.body?.model}`,
  })
  @ApiOperation({ summary: 'Create an appliance model (brand/model SKU)' })
  @ApiBody({ type: CreateApplianceModelDto })
  @ApiResponse({ status: 201, type: ApplianceModel })
  createApplianceModel(@Body() data: CreateApplianceModelDto) {
    return this.masterDataService.createApplianceModel(data);
  }

  @Get('appliance-models')
  @ApiQuery({ name: 'brand', required: false })
  @ApiOperation({ summary: 'Get all active appliance models, optionally filtered by brand' })
  @ApiResponse({ status: 200, type: [ApplianceModel] })
  findAllApplianceModels(@Query('brand') brand?: string) {
    return this.masterDataService.findAllApplianceModels(brand);
  }

  @Put('appliance-models/:id')
  @RequiresCapability('MASTER_DATA_APPLIANCE_MODEL_MANAGE')
  @UseInterceptors(AuditInterceptor)
  @Audit({ action: AuditAction.UPDATE, entityType: 'ApplianceModel', getEntityId: (args) => args.params?.id })
  @ApiOperation({ summary: 'Update an appliance model (also used to reactivate one)' })
  @ApiBody({ type: UpdateApplianceModelDto })
  @ApiResponse({ status: 200, type: ApplianceModel })
  updateApplianceModel(@Param('id') id: string, @Body() data: UpdateApplianceModelDto) {
    return this.masterDataService.updateApplianceModel(id, data);
  }

  @Delete('appliance-models/:id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete an appliance model (soft)' })
  deleteApplianceModel(@Param('id') id: string) {
    return this.masterDataService.deleteApplianceModel(id);
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