import { Controller, Get, Post, Body, Param, Query, Request, UseGuards, UseInterceptors, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { TechnicianService } from './technician.service';
import { StartVisitDto } from './dto/start-visit.dto';
import { CaptureSerialNumberDto } from './dto/capture-serial-number.dto';
import { CaptureFaultSymptomDto } from './dto/capture-fault-symptom.dto';
import { TechnicianVisit } from './entities/technician-visit.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction } from '../auth/entities/audit-log.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

// Field technicians self-serve on their own appointments; supervisory roles can act on
// their behalf - the same role set already used on AppointmentsController's on-site/complete
// endpoints, with per-appointment ownership enforced in TechnicianService for TECHNICIAN_FIELD.
const TECHNICIAN_VISIT_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER', 'TECHNICIAN_FIELD'];

@ApiTags('technician')
@Controller('technician')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class TechnicianController {
  constructor(private technicianService: TechnicianService) {}

  @Post('visits/:appointmentId/start')
  @Roles(...TECHNICIAN_VISIT_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'TechnicianVisit',
    getEntityId: (args) => args[0],
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
  @Roles(...TECHNICIAN_VISIT_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'TechnicianVisit',
    getEntityId: (args) => args[0],
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
  @Roles(...TECHNICIAN_VISIT_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'TechnicianVisit',
    getEntityId: (args) => args[0],
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
