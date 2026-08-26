import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { DismantlingService } from './dismantling.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction } from '../auth/entities/audit-log.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';
import { DismantlingStatus } from './entities/dismantling-record.entity';
import { CreateDismantlingRecordDto } from './dto/create-dismantling-record.dto';
import { HarvestComponentsDto } from './dto/harvest-components.dto';
import { VerifyDismantlingRecordDto } from './dto/verify-dismantling-record.dto';
import { PriceAndPostDismantlingDto } from './dto/price-and-post-dismantling.dto';
import { CancelDismantlingRecordDto } from './dto/cancel-dismantling-record.dto';

// BRD Workflow 15 actors: "Technician / Team Leader" for verify-location/harvest,
// "Service Manager" for the BOM-to-spare/pricing/posting step. This codebase has no
// dedicated "Service Manager" role (RoleName has 14 members, none named that) - mapped to
// SERVICE_HEAD, the same assumption AMC's contract-management endpoints already make.
const HARVEST_ROLES = ['TECHNICIAN_WORKSHOP', 'TECHNICIAN_FIELD', 'TECHNICAL_TEAM_LEADER', 'SERVICE_HEAD', 'SUPER_ADMIN'];
const VERIFY_ROLES = ['TECHNICAL_TEAM_LEADER', 'SERVICE_HEAD', 'SUPER_ADMIN'];
const MANAGER_ROLES = ['SERVICE_HEAD', 'SUPER_ADMIN'];
const VIEW_ROLES = ['SERVICE_HEAD', 'SUPER_ADMIN', 'TECHNICAL_TEAM_LEADER', 'TECHNICIAN_FIELD', 'TECHNICIAN_WORKSHOP', 'ACCOUNTANT', 'FINANCE_MANAGER'];

@ApiTags('dismantling')
@Controller('dismantling')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class DismantlingController {
  constructor(private dismantlingService: DismantlingService) {}

  @Post()
  @Roles(...HARVEST_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CREATE,
    entityType: 'DismantlingRecord',
    getNewValues: (result: any) => ({ id: result?.id, recordNumber: result?.recordNumber, applianceSerialNumber: result?.applianceSerialNumber }),
  })
  @ApiOperation({ summary: 'Open a dismantling record for a defective/DOA appliance already in Damage Location (BRD step 15.1)' })
  @ApiResponse({ status: 201, description: 'Record created, PENDING_HARVEST' })
  async create(@Body() dto: CreateDismantlingRecordDto, @CurrentUser() user: User) {
    return this.dismantlingService.create(dto, user.id);
  }

  @Get()
  @Roles(...VIEW_ROLES)
  @ApiQuery({ name: 'status', enum: DismantlingStatus, required: false })
  @ApiOperation({ summary: 'List dismantling records, optionally filtered by status' })
  async findAll(@Query('status') status?: DismantlingStatus) {
    return this.dismantlingService.findAll(status);
  }

  @Get('serial/:applianceSerialNumber')
  @Roles(...VIEW_ROLES)
  @ApiOperation({ summary: 'List dismantling records for a given appliance serial number' })
  async findByApplianceSerial(@Param('applianceSerialNumber') applianceSerialNumber: string) {
    return this.dismantlingService.findByApplianceSerial(applianceSerialNumber);
  }

  @Get(':id')
  @Roles(...VIEW_ROLES)
  @ApiOperation({ summary: 'Get one dismantling record by id' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.dismantlingService.findById(id);
  }

  @Post(':id/harvest')
  @Roles(...HARVEST_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'DismantlingRecord',
    getEntityId: (req: any) => req.params.id,
    getNewValues: (result: any) => ({ status: result?.status, harvestedComponents: result?.harvestedComponents }),
  })
  @ApiOperation({ summary: 'Log recovered components after strip-down & inspection (BRD steps 15.2-15.3) - one-shot, only while PENDING_HARVEST' })
  @ApiResponse({ status: 400, description: 'Record is not PENDING_HARVEST' })
  async harvest(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HarvestComponentsDto, @CurrentUser() user: User) {
    return this.dismantlingService.harvest(id, dto, user.id);
  }

  @Post(':id/verify')
  @Roles(...VERIFY_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'DismantlingRecord',
    getEntityId: (req: any) => req.params.id,
    getNewValues: (result: any) => ({ status: result?.status, verifiedByUserId: result?.verifiedByUserId }),
  })
  @ApiOperation({ summary: 'Supervisor verification of the harvested component log (AC-31) - must be a different person from whoever harvested' })
  @ApiResponse({ status: 400, description: 'Record is not COMPONENTS_LOGGED, or the verifier is the same person who harvested' })
  async verify(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyDismantlingRecordDto, @CurrentUser() user: User) {
    return this.dismantlingService.verify(id, dto.notes, user.id);
  }

  @Post(':id/price-and-post')
  @Roles(...MANAGER_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'DismantlingRecord',
    getEntityId: (req: any) => req.params.id,
    getNewValues: (result: any) => ({ status: result?.status, totalRecoveredValue: result?.totalRecoveredValue }),
  })
  @ApiOperation({ summary: 'BOM-to-spare conversion, manual pricing, and final posting in one step (BRD steps 15.4-15.6; AC-39/AC-30) - adjusts live inventory and posts a GL entry atomically' })
  @ApiResponse({ status: 400, description: 'Record is not VERIFIED, a component is ineligible, or the poster is the same as the harvester/verifier' })
  @ApiResponse({ status: 404, description: 'A converted spare part code has no matching SparePart master-data record' })
  async priceAndPost(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PriceAndPostDismantlingDto, @CurrentUser() user: User) {
    return this.dismantlingService.priceAndPost(id, dto, user.id);
  }

  @Post(':id/cancel')
  @Roles(...HARVEST_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CANCEL,
    entityType: 'DismantlingRecord',
    getEntityId: (req: any) => req.params.id,
    getNewValues: (result: any) => ({ status: result?.status, cancellationReason: result?.cancellationReason }),
  })
  @ApiOperation({ summary: 'Cancel a record before verification - e.g. nothing salvageable was found' })
  @ApiResponse({ status: 400, description: 'Record has already been verified or posted' })
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDismantlingRecordDto) {
    return this.dismantlingService.cancel(id, dto.reason);
  }
}
