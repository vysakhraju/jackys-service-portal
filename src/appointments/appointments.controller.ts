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
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction } from '../auth/entities/audit-log.entity';
import { Appointment } from './entities/appointment.entity';
import { AppointmentStatus, AppointmentType, CustomerType } from './entities/appointment.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

@ApiTags('appointments')
@Controller('appointments')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class AppointmentsController {
  constructor(private appointmentsService: AppointmentsService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'SERVICE_HEAD', 'CCE')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CREATE,
    entityType: 'Appointment',
    getEntityId: (args) => args[0]?.appointmentNumber,
  })
  @ApiOperation({ summary: 'Create new appointment' })
  @ApiResponse({ status: 201, type: Appointment })
  @ApiResponse({ status: 409, description: 'Service centre at capacity' })
  async create(
    @Body() createAppointmentDto: CreateAppointmentDto,
    @CurrentUser() user: User,
    @Query() req: any,
  ) {
    return this.appointmentsService.create(createAppointmentDto, user.id, req);
  }

  @Get()
  @ApiOperation({ summary: 'Get all appointments with filters' })
  @ApiQuery({ name: 'serviceCentreId', required: false, type: String })
  @ApiQuery({ name: 'technicianId', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: AppointmentStatus })
  @ApiQuery({ name: 'type', required: false, enum: AppointmentType })
  @ApiQuery({ name: 'dateFrom', required: false, type: String, description: 'ISO date string' })
  @ApiQuery({ name: 'dateTo', required: false, type: String, description: 'ISO date string' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200 })
  async findAll(
    @Query('serviceCentreId') serviceCentreId?: string,
    @Query('technicianId') technicianId?: string,
    @Query('status') status?: AppointmentStatus,
    @Query('type') type?: AppointmentType,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.appointmentsService.findAll({
      serviceCentreId,
      technicianId,
      status,
      type,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      page,
      limit,
    });
  }

  @Get('dashboard/stats')
  @Roles('SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER', 'CCE')
  @ApiOperation({ summary: 'Get dashboard statistics' })
  @ApiQuery({ name: 'serviceCentreId', required: false, type: String })
  @ApiResponse({ status: 200 })
  async getDashboardStats(@Query('serviceCentreId') serviceCentreId?: string) {
    return this.appointmentsService.getDashboardStats(serviceCentreId);
  }

  @Get('service-centre/:serviceCentreId/schedule')
  @ApiOperation({ summary: 'Get service centre schedule for a date' })
  @ApiParam({ name: 'serviceCentreId', type: String })
  @ApiQuery({ name: 'date', required: true, type: String, description: 'ISO date string' })
  @ApiResponse({ status: 200, type: [Appointment] })
  async getServiceCentreSchedule(
    @Param('serviceCentreId') serviceCentreId: string,
    @Query('date') date: string,
  ) {
    return this.appointmentsService.getServiceCentreSchedule(serviceCentreId, new Date(date));
  }

  @Get('technician/:technicianId/schedule')
  @ApiOperation({ summary: 'Get technician schedule for a date' })
  @ApiParam({ name: 'technicianId', type: String })
  @ApiQuery({ name: 'date', required: true, type: String, description: 'ISO date string' })
  @ApiResponse({ status: 200, type: [Appointment] })
  async getTechnicianSchedule(
    @Param('technicianId') technicianId: string,
    @Query('date') date: string,
  ) {
    return this.appointmentsService.getTechnicianSchedule(technicianId, new Date(date));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get appointment by ID' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: Appointment })
  @ApiResponse({ status: 404, description: 'Appointment not found' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.appointmentsService.findById(id);
  }

  @Get('number/:appointmentNumber')
  @ApiOperation({ summary: 'Get appointment by appointment number' })
  @ApiParam({ name: 'appointmentNumber', type: String })
  @ApiResponse({ status: 200, type: Appointment })
  @ApiResponse({ status: 404, description: 'Appointment not found' })
  async findByAppointmentNumber(@Param('appointmentNumber') appointmentNumber: string) {
    return this.appointmentsService.findByAppointmentNumber(appointmentNumber);
  }

  @Put(':id')
  @Roles('SUPER_ADMIN', 'SERVICE_HEAD', 'CCE', 'TECHNICAL_TEAM_LEADER')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'Appointment',
    getEntityId: (args) => args[0],
  })
  @ApiOperation({ summary: 'Update appointment' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: Appointment })
  @ApiResponse({ status: 404, description: 'Appointment not found' })
  @ApiResponse({ status: 409, description: 'Capacity conflict' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateAppointmentDto: UpdateAppointmentDto,
    @CurrentUser() user: User,
    @Query() req: any,
  ) {
    return this.appointmentsService.update(id, updateAppointmentDto, user.id, req);
  }

  @Put(':id/cancel')
  @Roles('SUPER_ADMIN', 'SERVICE_HEAD', 'CCE')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CANCEL,
    entityType: 'Appointment',
    getEntityId: (args) => args[0],
  })
  @ApiOperation({ summary: 'Cancel appointment' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: Appointment })
  @ApiResponse({ status: 400, description: 'Cannot cancel completed/cancelled appointment' })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason: string },
    @CurrentUser() user: User,
    @Query() req: any,
  ) {
    return this.appointmentsService.cancel(id, body.reason, user.id, req);
  }

  @Put(':id/assign-technician')
  @Roles('SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'Appointment',
    getEntityId: (args) => args[0],
  })
  @ApiOperation({ summary: 'Assign technician to appointment' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: Appointment })
  @ApiResponse({ status: 400, description: 'Invalid status for assignment' })
  @ApiResponse({ status: 409, description: 'Technician not available' })
  async assignTechnician(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { technicianId: string },
    @CurrentUser() user: User,
    @Query() req: any,
  ) {
    return this.appointmentsService.assignTechnician(id, body.technicianId, user.id, req);
  }

  @Put(':id/confirm')
  @Roles('SUPER_ADMIN', 'SERVICE_HEAD', 'CCE')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'Appointment',
    getEntityId: (args) => args[0],
  })
  @ApiOperation({ summary: 'Confirm appointment' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: Appointment })
  @ApiResponse({ status: 400, description: 'Can only confirm scheduled appointments' })
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Query() req: any,
  ) {
    return this.appointmentsService.confirmAppointment(id, user.id, req);
  }

  @Put(':id/on-site')
  @Roles('SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER', 'TECHNICIAN_FIELD')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'Appointment',
    getEntityId: (args) => args[0],
  })
  @ApiOperation({ summary: 'Mark appointment as on-site (technician arrived)' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: Appointment })
  @ApiResponse({ status: 400, description: 'Can only mark on-site for confirmed/assigned appointments' })
  async markOnSite(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Query() req: any,
  ) {
    return this.appointmentsService.markOnSite(id, user.id, req);
  }

  @Put(':id/complete')
  @Roles('SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER', 'TECHNICIAN_FIELD')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'Appointment',
    getEntityId: (args) => args[0],
  })
  @ApiOperation({ summary: 'Complete appointment (on-site work done)' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: Appointment })
  @ApiResponse({ status: 400, description: 'Can only complete on-site appointments' })
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Query() req: any,
  ) {
    return this.appointmentsService.completeAppointment(id, user.id, req);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete appointment (hard delete - admin only)' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Appointment not found' })
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    // Hard delete for admin only - use with caution
    await this.appointmentsService['appointmentRepository'].delete(id);
    return { success: true };
  }
}