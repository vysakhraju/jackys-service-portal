import { Controller, Get, Post, Body, Param, Query, Request, UseGuards, UseInterceptors, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { TechnicianService } from './technician.service';
import { StartVisitDto } from './dto/start-visit.dto';
import { CaptureSerialNumberDto } from './dto/capture-serial-number.dto';
import { CaptureFaultSymptomDto } from './dto/capture-fault-symptom.dto';
import { NeedSpareDto } from './dto/need-spare.dto';
import { CompleteVisitDto } from './dto/complete-visit.dto';
import { TechnicianVisit } from './entities/technician-visit.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiresCapability } from '../auth/decorators/requires-capability.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction } from '../auth/entities/audit-log.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

// Field technicians self-serve on their own appointments; supervisory roles can act on
// their behalf - the same role set already used on AppointmentsController's on-site/complete
// endpoints, with per-appointment ownership enforced in TechnicianService for TECHNICIAN_FIELD.
// Migrated onto the designation permission matrix (2026-09-10) as TECHNICIAN_VISIT - see
// capability-catalog.ts's "Technician" section, same membership.

@ApiTags('technician')
@Controller('technician')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class TechnicianController {
  constructor(private technicianService: TechnicianService) {}

  @Post('visits/:appointmentId/start')
  @RequiresCapability('TECHNICIAN_VISIT')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'TechnicianVisit',
    getEntityId: (args) => args.params?.appointmentId,
  })
  @ApiOperation({ summary: 'Start an on-site visit: captures GPS + timestamp (FR-02)' })
  @ApiParam({ name: 'appointmentId', type: String })
  @ApiResponse({ status: 201, type: TechnicianVisit })
  @ApiResponse({ status: 400, description: 'Appointment is not CONFIRMED/TECHNICIAN_ASSIGNED' })
  @ApiResponse({ status: 403, description: 'Not the assigned technician' })
  async startVisit(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: StartVisitDto,
    @CurrentUser() user: User,
    @Request() req: any,
  ) {
    return this.technicianService.startVisit(appointmentId, dto, user, req);
  }

  @Post('visits/:appointmentId/serial-number')
  @RequiresCapability('TECHNICIAN_VISIT')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'TechnicianVisit',
    getEntityId: (args) => args.params?.appointmentId,
  })
  @ApiOperation({ summary: 'Capture Serial Number and check warranty: returns IW/OOW badge (FR-03)' })
  @ApiParam({ name: 'appointmentId', type: String })
  @ApiResponse({ status: 201, type: TechnicianVisit })
  @ApiResponse({ status: 400, description: 'Visit not on-site' })
  @ApiResponse({ status: 404, description: 'Visit not started for this appointment' })
  async captureSerialNumber(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: CaptureSerialNumberDto,
    @CurrentUser() user: User,
  ) {
    return this.technicianService.captureSerialNumber(appointmentId, dto, user);
  }

  @Post('visits/:appointmentId/fault-symptom')
  @RequiresCapability('TECHNICIAN_VISIT')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'TechnicianVisit',
    getEntityId: (args) => args.params?.appointmentId,
  })
  @ApiOperation({ summary: 'Record Fault Code + Symptom Code, gated on a captured S/N (FR-04)' })
  @ApiParam({ name: 'appointmentId', type: String })
  @ApiResponse({ status: 201, type: TechnicianVisit })
  @ApiResponse({ status: 400, description: 'Serial number not yet captured' })
  @ApiResponse({ status: 404, description: 'Unknown fault/symptom code, or visit not started' })
  async captureFaultSymptom(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: CaptureFaultSymptomDto,
    @CurrentUser() user: User,
  ) {
    return this.technicianService.captureFaultSymptom(appointmentId, dto, user);
  }

  @Get('visits/:appointmentId/job-card')
  @RequiresCapability('TECHNICIAN_VISIT')
  @ApiOperation({ summary: "Mobile Phase 5: has staff created (and assigned) a Job Card for this visit yet? 200 with null when not yet - not an error, the mobile app polls this to decide whether to show Need Spare/Complete." })
  @ApiParam({ name: 'appointmentId', type: String })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403, description: 'Not the assigned technician' })
  async getOwnJobCard(@Param('appointmentId', ParseUUIDPipe) appointmentId: string, @CurrentUser() user: User) {
    return this.technicianService.getOwnJobCard(appointmentId, user);
  }

  @Post('visits/:appointmentId/need-spare')
  @RequiresCapability('TECHNICIAN_VISIT')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.INVENTORY_RESERVE,
    entityType: 'InventoryReservation',
    getEntityId: (args) => args.params?.appointmentId,
    getNewValues: (result) => ({ status: result?.status, sparePartId: result?.sparePartId }),
  })
  @ApiOperation({ summary: 'Mobile Phase 5: request a spare part while on-site - creates a PENDING_REVIEW request for a TL to approve, no stock moves yet' })
  @ApiParam({ name: 'appointmentId', type: String })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400, description: 'Job Card not on-site-repair/section-assigned' })
  @ApiResponse({ status: 403, description: 'Not the assigned technician' })
  @ApiResponse({ status: 404, description: 'No Job Card exists yet for this appointment, or unknown spare part' })
  async requestNeedSpare(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: NeedSpareDto,
    @CurrentUser() user: User,
  ) {
    return this.technicianService.requestNeedSpare(appointmentId, dto, user);
  }

  @Post('visits/:appointmentId/complete')
  @RequiresCapability('TECHNICIAN_VISIT')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.STATUS_CHANGE,
    entityType: 'JobCard',
    getEntityId: (args) => args.params?.appointmentId,
    getNewValues: (result) => ({ status: result?.status }),
  })
  @ApiOperation({ summary: 'Mobile Phase 5: complete an on-site repair - hands the Job Card to QC and completes the appointment' })
  @ApiParam({ name: 'appointmentId', type: String })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400, description: 'Job Card not on-site-repair/section-assigned' })
  @ApiResponse({ status: 403, description: 'Not the assigned technician' })
  @ApiResponse({ status: 404, description: 'No Job Card exists yet for this appointment' })
  async completeVisit(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: CompleteVisitDto,
    @CurrentUser() user: User,
    @Request() req: any,
  ) {
    return this.technicianService.completeOnSiteRepair(appointmentId, dto, user, req);
  }

  @Get('visits/:appointmentId')
  @ApiOperation({ summary: 'Get the visit record for an appointment' })
  @ApiParam({ name: 'appointmentId', type: String })
  @ApiResponse({ status: 200, type: TechnicianVisit })
  @ApiResponse({ status: 404, description: 'Visit not started for this appointment' })
  async getVisit(@Param('appointmentId', ParseUUIDPipe) appointmentId: string) {
    return this.technicianService.getVisit(appointmentId);
  }

  @Get('schedule')
  @ApiOperation({ summary: "Get the calling technician's own schedule for a date (defaults to today)" })
  @ApiQuery({ name: 'date', required: false, type: String, description: 'ISO date string' })
  @ApiResponse({ status: 200 })
  async getMySchedule(@CurrentUser() user: User, @Query('date') date?: string) {
    return this.technicianService.getMySchedule(user.id, date ? new Date(date) : undefined);
  }
}
