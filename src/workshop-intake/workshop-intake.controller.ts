import { Controller, Get, Post, Body, Param, UseGuards, UseInterceptors, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { WorkshopIntakeService } from './workshop-intake.service';
import { CaptureSerialNumberDto } from '../technician/dto/capture-serial-number.dto';
import { CaptureFaultSymptomDto } from '../technician/dto/capture-fault-symptom.dto';
import { WorkshopIntake } from './entities/workshop-intake.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiresCapability } from '../auth/decorators/requires-capability.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction } from '../auth/entities/audit-log.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

// Appointment/Mobile/Job Card overhaul Phase 4 (2026-09-16) - see
// claude/APPOINTMENT_MOBILE_JOBCARD_SPEC.md section 3.4. All 3 mutating endpoints below
// share one capability, WORKSHOP_INTAKE_SN_VALIDATE (defaulted to TECHNICIAN_WORKSHOP/
// WAREHOUSE_CLERK/CCE via Designation Access, per the spec's own decision) - whoever can
// receive a unit can also capture its S/N and fault/symptom, same "one capability covers
// the whole self-contained screen" pattern as SCHEDULE_FIELD_VISIT on the mobile side.
@ApiTags('workshop-intake')
@Controller('workshop-intake')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class WorkshopIntakeController {
  constructor(private workshopIntakeService: WorkshopIntakeService) {}

  @Get(':appointmentId')
  @RequiresCapability('WORKSHOP_INTAKE_SN_VALIDATE')
  @ApiOperation({ summary: 'Get the workshop intake record for a COLLECTED_TO_WS appointment (null if not marked received yet)' })
  @ApiParam({ name: 'appointmentId', type: String })
  @ApiResponse({ status: 200 })
  async getIntake(@Param('appointmentId', ParseUUIDPipe) appointmentId: string) {
    return this.workshopIntakeService.getIntake(appointmentId);
  }

  @Post(':appointmentId/mark-received')
  @RequiresCapability('WORKSHOP_INTAKE_SN_VALIDATE')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CREATE,
    entityType: 'WorkshopIntake',
    getEntityId: (args) => args.params?.appointmentId,
  })
  @ApiOperation({ summary: 'Mark a collected-to-workshop appointment as physically received (idempotent)' })
  @ApiParam({ name: 'appointmentId', type: String })
  @ApiResponse({ status: 201, type: WorkshopIntake })
  @ApiResponse({ status: 400, description: 'Appointment is not COLLECTED_TO_WS' })
  async markReceived(@Param('appointmentId', ParseUUIDPipe) appointmentId: string, @CurrentUser() user: User) {
    return this.workshopIntakeService.markReceived(appointmentId, user.id);
  }

  @Post(':appointmentId/serial-number')
  @RequiresCapability('WORKSHOP_INTAKE_SN_VALIDATE')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'WorkshopIntake',
    getEntityId: (args) => args.params?.appointmentId,
  })
  @ApiOperation({ summary: 'Capture Serial Number and check warranty for a workshop intake' })
  @ApiParam({ name: 'appointmentId', type: String })
  @ApiResponse({ status: 201, type: WorkshopIntake })
  @ApiResponse({ status: 400, description: 'Appointment is not COLLECTED_TO_WS' })
  @ApiResponse({ status: 404, description: 'Not marked received yet' })
  async captureSerialNumber(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: CaptureSerialNumberDto,
  ) {
    return this.workshopIntakeService.captureSerialNumber(appointmentId, dto);
  }

  @Post(':appointmentId/fault-symptom')
  @RequiresCapability('WORKSHOP_INTAKE_SN_VALIDATE')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'WorkshopIntake',
    getEntityId: (args) => args.params?.appointmentId,
  })
  @ApiOperation({ summary: 'Record Fault Code + Symptom Code for a workshop intake, gated on a captured S/N' })
  @ApiParam({ name: 'appointmentId', type: String })
  @ApiResponse({ status: 201, type: WorkshopIntake })
  @ApiResponse({ status: 400, description: 'Serial number not yet captured, or appointment is not COLLECTED_TO_WS' })
  @ApiResponse({ status: 404, description: 'Not marked received yet, or unknown fault/symptom code' })
  async captureFaultSymptom(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: CaptureFaultSymptomDto,
  ) {
    return this.workshopIntakeService.captureFaultSymptom(appointmentId, dto);
  }
}
