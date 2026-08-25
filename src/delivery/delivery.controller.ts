import { Controller, Post, Get, Body, Param, Query, UseGuards, UseInterceptors, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { DeliveryService } from './delivery.service';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { DispatchDeliveryDto } from './dto/dispatch-delivery.dto';
import { CapturePodDto } from './dto/capture-pod.dto';
import { CancelDeliveryDto } from './dto/cancel-delivery.dto';
import { DeliveryStatus } from './entities/delivery.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction } from '../auth/entities/audit-log.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

// Plain @Roles() gating, deliberately NOT the admin-assignable PermissionsService grant
// mechanism Phase 6 introduced for QC/rework - that stays scoped to QC/rework only, per
// the earlier explicit decision to keep dynamic grants from spreading to every module.
const DELIVERY_ROLES = ['LOGISTICS_DISPATCHER', 'DRIVER', 'SUPER_ADMIN', 'SERVICE_HEAD'];

@ApiTags('delivery')
@Controller('delivery')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class DeliveryController {
  constructor(private deliveryService: DeliveryService) {}

  @Get('ready')
  @Roles(...DELIVERY_ROLES)
  @ApiQuery({ name: 'warrantyStatus', required: false, enum: WarrantyStatus, description: 'Filter the IW/OOW tabs' })
  @ApiOperation({ summary: 'List QC_PASSED Job Cards not yet attached to a delivery (the ready-for-delivery pool), with proactive OOW payment-status visibility' })
  @ApiResponse({ status: 200, description: 'Ready Job Cards, each with invoiceStatus/payable for OOW jobs' })
  async findReady(@Query('warrantyStatus') warrantyStatus?: WarrantyStatus) {
    return this.deliveryService.findReady(warrantyStatus);
  }

  @Get('job-card/:jobCardId')
  @Roles(...DELIVERY_ROLES)
  @ApiOperation({ summary: 'Get the delivery a Job Card is attached to, if any' })
  @ApiResponse({ status: 200, description: 'The delivery, or null if this Job Card is not yet attached to one' })
  async findByJobCardId(@Param('jobCardId', ParseUUIDPipe) jobCardId: string) {
    return this.deliveryService.findByJobCardId(jobCardId);
  }

  @Post()
  @Roles(...DELIVERY_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CREATE,
    entityType: 'Delivery',
    getNewValues: (result) => ({ id: result?.delivery?.id, deliveryNumber: result?.delivery?.deliveryNumber, jobCardCount: result?.jobCards?.length }),
  })
  @ApiOperation({ summary: 'FR-11/AC-10: create a batch (or normal, N=1) delivery covering the given Job Cards, generating one DLV#' })
  @ApiResponse({ status: 201, description: 'Delivery created with every listed Job Card attached' })
  @ApiResponse({ status: 400, description: 'A listed Job Card is not QC_PASSED' })
  @ApiResponse({ status: 404, description: 'A listed Job Card does not exist' })
  @ApiResponse({ status: 409, description: 'A listed Job Card is already attached to another delivery, or FR-12/AC-11: one or more OOW Job Cards are unpaid (see `blockers`)' })
  async create(@Body() dto: CreateDeliveryDto, @CurrentUser() user: User) {
    return this.deliveryService.create(dto, user.id);
  }

  @Get()
  @Roles(...DELIVERY_ROLES)
  @ApiQuery({ name: 'status', required: false, enum: DeliveryStatus })
  @ApiOperation({ summary: 'List deliveries, optionally filtered by status (POD blob columns excluded - see GET /delivery/:id for those)' })
  @ApiResponse({ status: 200, description: 'Deliveries' })
  async findAll(@Query('status') status?: DeliveryStatus) {
    return this.deliveryService.findAll(status);
  }

  @Get(':id')
  @Roles(...DELIVERY_ROLES)
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Get one delivery by id, including POD signature/photo if captured' })
  @ApiResponse({ status: 200, description: 'The delivery' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.deliveryService.findById(id);
  }

  @Post(':id/dispatch')
  @Roles(...DELIVERY_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.DELIVERY_DISPATCH,
    entityType: 'Delivery',
    getEntityId: (args) => args.params?.id,
    getNewValues: (result) => ({ status: result?.status, driverUserId: result?.driverUserId, dispatchedAt: result?.dispatchedAt }),
  })
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Mark a PENDING delivery as DISPATCHED, optionally recording the driver' })
  @ApiResponse({ status: 201, description: 'Delivery is now DISPATCHED' })
  @ApiResponse({ status: 400, description: 'Delivery is not PENDING' })
  async dispatch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DispatchDeliveryDto) {
    return this.deliveryService.dispatch(id, dto.driverUserId);
  }

  @Post(':id/pod')
  @Roles(...DELIVERY_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.DELIVERY_POD,
    entityType: 'Delivery',
    getEntityId: (args) => args.params?.id,
    getNewValues: (result) => ({ status: result?.status, podRecipientName: result?.podRecipientName, deliveredAt: result?.deliveredAt }),
  })
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'AC-12: capture proof of delivery (signature OR photo, at least one required) and mark the delivery + every member Job Card DELIVERED' })
  @ApiResponse({ status: 201, description: 'POD captured, delivery and all member Job Cards are now DELIVERED' })
  @ApiResponse({ status: 400, description: 'Neither signature nor photo provided, or delivery is not DISPATCHED' })
  @ApiResponse({ status: 409, description: 'An OOW member Job Card is no longer paid (re-checked defensively)' })
  async capturePod(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CapturePodDto) {
    return this.deliveryService.capturePod(id, dto);
  }

  @Post(':id/cancel')
  @Roles(...DELIVERY_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CANCEL,
    entityType: 'Delivery',
    getEntityId: (args) => args.params?.id,
    getNewValues: (result) => ({ status: result?.status, cancellationReason: result?.cancellationReason }),
  })
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Cancel a PENDING (not yet dispatched) delivery - releases every member Job Card back to the ready-for-delivery pool' })
  @ApiResponse({ status: 201, description: 'Delivery is now CANCELLED' })
  @ApiResponse({ status: 400, description: 'Delivery is not PENDING (already dispatched/delivered/cancelled)' })
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDeliveryDto) {
    return this.deliveryService.cancel(id, dto.reason);
  }
}
