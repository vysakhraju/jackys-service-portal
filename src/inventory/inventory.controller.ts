import { Controller, Get, Post, Body, Param, Query, UseGuards, UseInterceptors, ParseUUIDPipe, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { GrnDto } from './dto/grn.dto';
import { ReviewReservationDto } from './dto/review-reservation.dto';
import { ConfirmReturnDto } from './dto/confirm-return.dto';
import { InventoryLocation } from './entities/inventory-stock.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction } from '../auth/entities/audit-log.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

// GRN and confirming a physical return are Warehouse Clerk duties (the role already
// seeded with manage:grn/view:inventory permissions) - Service Head/Super Admin can
// always cover for them. Reviewing a stale reservation is a supervisory call.
const INVENTORY_STAFF_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'WAREHOUSE_CLERK'];
const REVIEW_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER'];
const READ_ROLES = [...INVENTORY_STAFF_ROLES, 'TECHNICAL_TEAM_LEADER', 'CCE'];

@ApiTags('inventory')
@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class InventoryController {
  constructor(private inventoryService: InventoryService) {}

  @Post('grn')
  @Roles(...INVENTORY_STAFF_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CREATE,
    entityType: 'InventoryStock',
    getNewValues: (result) => ({ sparePartId: result?.sparePartId, quantityOnHand: result?.quantityOnHand }),
  })
  @ApiOperation({ summary: 'Goods Received Note - receive new spare part stock into Main Store (AC-17: blocked if not linked to a model)' })
  @ApiResponse({ status: 201, description: 'Stock updated' })
  @ApiResponse({ status: 400, description: 'Spare part not linked to any model yet' })
  async grn(@Body() dto: GrnDto, @CurrentUser() user: User) {
    return this.inventoryService.grn(dto.sparePartId, dto.quantity, dto.notes, user.id);
  }

  @Get('stock/:sparePartId')
  @Roles(...READ_ROLES)
  @ApiQuery({ name: 'location', enum: InventoryLocation, required: false, description: 'Defaults to MAIN_STORE. Phase 6: pass DAMAGE_LOCATION to see stock consumed by QC-approved jobs.' })
  @ApiOperation({ summary: 'Current on-hand / reserved stock for a spare part (Main Store by default; pass ?location=DAMAGE_LOCATION for Phase 6 consumption totals)' })
  @ApiResponse({ status: 200 })
  async getStock(@Param('sparePartId', ParseUUIDPipe) sparePartId: string, @Query('location') location?: InventoryLocation) {
    const stock = await this.inventoryService.getStock(sparePartId, location || InventoryLocation.MAIN_STORE);
    return stock ?? { sparePartId, location: location || InventoryLocation.MAIN_STORE, quantityOnHand: 0, quantityReserved: 0 };
  }

  @Get('reservations/stale')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Reservations idle >24h since last request/review, oldest first (inactive-custodian ones surfaced first regardless of age)' })
  @ApiResponse({ status: 200 })
  async getStale() {
    return this.inventoryService.getStaleReservations();
  }

  @Post('reservations/:id/review')
  @Roles(...REVIEW_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.INVENTORY_RESERVE,
    entityType: 'InventoryReservation',
    getEntityId: (args) => args.params.id,
    getNewValues: (result) => ({ status: result?.status, reviewDecision: result?.reviewDecision }),
  })
  @ApiOperation({ summary: 'TL+ review of an idle reservation: approve reallocation back to Main Store, or reject (snoozes, resurfaces again after 24h)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Reservation already resolved' })
  async review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewReservationDto, @CurrentUser() user: User) {
    return this.inventoryService.review(id, dto.decision, user.id, dto.notes);
  }

  @Post('reservations/:id/request-return')
  @Roles('SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER', 'TECHNICIAN_WORKSHOP', 'TECHNICIAN_FIELD')
  @ApiOperation({ summary: "The custodian technician voluntarily returning an unused reservation (or a TL doing it on their behalf)" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403, description: 'Not this reservation\'s custodian' })
  async requestReturn(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User, @Request() req: any) {
    const isPrivileged = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER'].includes(req.user.role?.name);
    return this.inventoryService.requestReturn(id, user.id, isPrivileged);
  }

  @Post('reservations/:id/confirm-return')
  @Roles(...INVENTORY_STAFF_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.INVENTORY_RESERVE,
    entityType: 'InventoryReservation',
    getEntityId: (args) => args.params.id,
    getNewValues: (result) => ({ status: result?.status, quantityReturned: result?.quantityReturned }),
  })
  @ApiOperation({ summary: 'Inventory Clerk physically confirms a returned part - the ONLY action that ever increments on-hand stock for a return' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Not RETURN_PENDING, or returning more than was reserved' })
  async confirmReturn(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmReturnDto, @CurrentUser() user: User) {
    return this.inventoryService.confirmReturn(id, dto.quantityReturned, user.id);
  }
}
