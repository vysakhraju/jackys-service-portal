import { Controller, Get, Post, Body, Param, UseGuards, UseInterceptors, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JobCardsService } from './job-cards.service';
import { CreateJobCardDto } from './dto/create-job-card.dto';
import { ValidateSnDto } from './dto/validate-sn.dto';
import { AssignSectionDto } from './dto/assign-section.dto';
import { WarrantyOverrideDto } from './dto/warranty-override.dto';
import { ApproveCustomerDto } from './dto/approve-customer.dto';
import { JobCard } from './entities/job-card.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction } from '../auth/entities/audit-log.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

// Creation/validation/section-assignment/approval: same office-side role set used
// elsewhere (Appointments' CCE-facing endpoints). Warranty override is deliberately
// narrower - see WARRANTY_OVERRIDE_ROLES below.
const JOB_CARD_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER', 'CCE'];
// FR-17: only a Technical Team Leader (or above) may perform a warranty override.
const WARRANTY_OVERRIDE_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER'];

@ApiTags('job-cards')
@Controller('job-cards')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class JobCardsController {
  constructor(private jobCardsService: JobCardsService) {}

  @Post()
  @Roles(...JOB_CARD_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CREATE,
    entityType: 'JobCard',
    getNewValues: (result) => ({ id: result?.id, jobCardNumber: result?.jobCardNumber, appointmentId: result?.appointmentId }),
  })
  @ApiOperation({ summary: 'Create a Job Card from a completed field visit (FR-05: blocked without invoice + visit data)' })
  @ApiResponse({ status: 201, type: JobCard })
  @ApiResponse({ status: 400, description: 'Missing invoice number or incomplete field visit' })
  @ApiResponse({ status: 404, description: 'Appointment or visit not found' })
  @ApiResponse({ status: 409, description: 'A Job Card already exists for this appointment' })
  async create(@Body() dto: CreateJobCardDto, @CurrentUser() user: User) {
    return this.jobCardsService.create(dto, user.id);
  }

  @Post(':id/validate-sn')
  @Roles(...JOB_CARD_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'JobCard',
    getEntityId: (args) => args.params?.id,
  })
  @ApiOperation({ summary: 'Confirm (or flag a mismatch of) the captured S/N against the physical invoice' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 201, type: JobCard })
  @ApiResponse({ status: 400, description: 'Job Card is not OPEN' })
  async validateSn(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ValidateSnDto) {
    return this.jobCardsService.validateSn(id, dto);
  }

  @Post(':id/assign-section')
  @Roles(...JOB_CARD_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.STATUS_CHANGE,
    entityType: 'JobCard',
    getEntityId: (args) => args.params?.id,
  })
  @ApiOperation({ summary: 'Assign On-Site Repair or Workshop - the point work actually starts' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 201, type: JobCard })
  @ApiResponse({ status: 400, description: 'S/N not validated, or OOW without customer approval' })
  async assignSection(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignSectionDto) {
    return this.jobCardsService.assignSection(id, dto);
  }

  @Post(':id/approve-customer')
  @Roles(...JOB_CARD_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'JobCard',
    getEntityId: (args) => args.params?.id,
  })
  @ApiOperation({ summary: 'FR-06 stopgap: manually record customer approval for an OOW job (until the Estimate/link flow exists)' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 201, type: JobCard })
  async approveCustomer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveCustomerDto) {
    return this.jobCardsService.approveCustomer(id, dto);
  }

  @Post(':id/warranty-override')
  @Roles(...WARRANTY_OVERRIDE_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.WARRANTY_OVERRIDE,
    entityType: 'JobCard',
    getEntityId: (args) => args.params?.id,
    // result is the JobCard entity itself - warrantyOverride() below unwraps the
    // service's {jobCard, previousStatus} before returning to the client, so
    // previousStatus isn't available here. newStatus/reason/overrideCount fully capture
    // the override for the audit trail regardless.
    getNewValues: (result) => ({
      newStatus: result?.warrantyStatus,
      reason: result?.warrantyOverrideReason,
      overrideCount: result?.overrideCount,
    }),
  })
  @ApiOperation({ summary: 'Warranty Override (FR-17/AC-18) - TL approval only, full audit trail' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 201, type: JobCard })
  @ApiResponse({ status: 400, description: 'New status matches the current status' })
  @ApiResponse({ status: 403, description: 'Caller is not a Technical Team Leader or above' })
  async warrantyOverride(@Param('id', ParseUUIDPipe) id: string, @Body() dto: WarrantyOverrideDto, @CurrentUser() user: User) {
    const { jobCard } = await this.jobCardsService.warrantyOverride(id, dto, user.id);
    return jobCard;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a Job Card by id' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: JobCard })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobCardsService.findById(id);
  }

  @Get('by-appointment/:appointmentId')
  @ApiOperation({ summary: 'Get the Job Card for an appointment' })
  @ApiParam({ name: 'appointmentId', type: String })
  @ApiResponse({ status: 200, type: JobCard })
  @ApiResponse({ status: 404, description: 'No Job Card exists for this appointment' })
  async findByAppointmentId(@Param('appointmentId', ParseUUIDPipe) appointmentId: string) {
    return this.jobCardsService.findByAppointmentId(appointmentId);
  }
}
