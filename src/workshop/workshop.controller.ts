import { Controller, Get, Post, Body, Param, UseGuards, UseInterceptors, ParseUUIDPipe, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { WorkshopService } from './workshop.service';
import { AssignWorkshopDto } from './dto/assign-workshop.dto';
import { RequestSpareDto } from './dto/request-spare.dto';
import { AddCrewHelperDto } from './dto/add-crew-helper.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiresCapability } from '../auth/decorators/requires-capability.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction } from '../auth/entities/audit-log.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

// ASSIGN_ROLES/ACTION_ROLES/the ACTION_ROLES+CCE view combo all migrated onto the
// designation permission matrix (2026-09-10) as WORKSHOP_ASSIGN/WORKSHOP_ACTION/
// WORKSHOP_VIEW respectively - see capability-catalog.ts's "Workshop" section, each the
// exact same membership these arrays used to have.
//
// PRIVILEGED_ROLES stays a plain business-logic array (not a @Roles()/@RequiresCapability()
// gate) - it decides who bypasses per-technician ownership once already inside a WORKSHOP_
// ACTION-gated handler, same "checked in code, not admin-editable" reasoning as Job Cards'
// TASK_PAUSE_PRIVILEGED_ROLES.
const PRIVILEGED_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER'];

@ApiTags('workshop')
@Controller('workshop')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class WorkshopController {
  constructor(private workshopService: WorkshopService) {}

  @Post(':jobCardId/assign')
  @RequiresCapability('WORKSHOP_ASSIGN')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'JobCard',
    getEntityId: (args) => args.params.jobCardId,
    getNewValues: (result) => ({ status: result?.status, assignedWorkshopTechnicianId: result?.assignedWorkshopTechnicianId }),
  })
  @ApiOperation({ summary: 'Assign a workshop technician to a SECTION_ASSIGNED (section=WORKSHOP) Job Card' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Not SECTION_ASSIGNED / not routed to WORKSHOP' })
  async assign(@Param('jobCardId', ParseUUIDPipe) jobCardId: string, @Body() dto: AssignWorkshopDto) {
    return this.workshopService.assign(jobCardId, dto.technicianId);
  }

  // Technician Assignment Board's reassign action (2026-09-09) - same ASSIGN_ROLES as
  // assign() above; reuses AssignWorkshopDto since the body shape is identical.
  @Post(':jobCardId/reassign')
  @RequiresCapability('WORKSHOP_ASSIGN')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'JobCard',
    getEntityId: (args) => args.params.jobCardId,
    getNewValues: (result) => ({ status: result?.status, assignedWorkshopTechnicianId: result?.assignedWorkshopTechnicianId }),
  })
  @ApiOperation({ summary: 'Reassign a WORKSHOP Job Card to a different workshop technician (past its initial assignment)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Not yet assigned, or in a status reassignment does not apply to' })
  @ApiResponse({ status: 403, description: 'Job Card is late-stage and caller does not hold an override role' })
  @ApiResponse({ status: 409, description: 'Current technician still holds an open spare-parts reservation' })
  async reassign(
    @Param('jobCardId', ParseUUIDPipe) jobCardId: string,
    @Body() dto: AssignWorkshopDto,
    @CurrentUser() user: User,
    @Request() req: any,
  ) {
    return this.workshopService.reassign(jobCardId, dto.technicianId, user.id, req.user.role?.name);
  }

  @Post(':jobCardId/start-wip')
  @RequiresCapability('WORKSHOP_ACTION')
  @ApiOperation({ summary: 'Start work-in-progress on a WORKSHOP_ASSIGNED Job Card' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403, description: 'Not the assigned workshop technician' })
  async startWip(@Param('jobCardId', ParseUUIDPipe) jobCardId: string, @CurrentUser() user: User, @Request() req: any) {
    const isPrivileged = PRIVILEGED_ROLES.includes(req.user.role?.name);
    return this.workshopService.startWip(jobCardId, user.id, isPrivileged);
  }

  @Post(':jobCardId/request-spare')
  @RequiresCapability('WORKSHOP_ACTION')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.INVENTORY_RESERVE,
    entityType: 'InventoryReservation',
    getNewValues: (result) => ({ id: result?.id, status: result?.status, quantityReserved: result?.quantityReserved }),
  })
  @ApiOperation({ summary: 'FR-09: reserve (not deduct) a spare part from Main Store for this job. If this exact part was already requested once before on this job AND the job has a prior QC rejection, this is a rework re-request and requires approverId (REWORK_APPROVAL grant, must differ from requester) or a verbal override (verbalOverrideBy + verbalOverrideNotes).' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400, description: 'Wrong status, a stale reservation on this job needs TL review first, or a rework re-request is missing approval/verbal-override' })
  @ApiResponse({ status: 403, description: 'The named rework approver does not hold an active REWORK_APPROVAL grant' })
  async requestSpare(@Param('jobCardId', ParseUUIDPipe) jobCardId: string, @Body() dto: RequestSpareDto, @CurrentUser() user: User, @Request() req: any) {
    const isPrivileged = PRIVILEGED_ROLES.includes(req.user.role?.name);
    return this.workshopService.requestSpare(
      jobCardId,
      dto.sparePartId,
      dto.quantity,
      user.id,
      user.id,
      isPrivileged,
      dto.approverId,
      dto.verbalOverrideBy,
      dto.verbalOverrideNotes,
    );
  }

  @Post(':jobCardId/complete')
  @RequiresCapability('WORKSHOP_ACTION')
  @ApiOperation({ summary: "Mark workshop work done - moves to READY_FOR_QC (Phase 6). Blocked while SPARE_PENDING." })
  @ApiResponse({ status: 200 })
  async complete(@Param('jobCardId', ParseUUIDPipe) jobCardId: string, @CurrentUser() user: User, @Request() req: any) {
    const isPrivileged = PRIVILEGED_ROLES.includes(req.user.role?.name);
    return this.workshopService.complete(jobCardId, user.id, isPrivileged);
  }

  @Get(':jobCardId')
  @RequiresCapability('WORKSHOP_VIEW')
  @ApiOperation({ summary: 'Full workshop state for a Job Card, including any stale reservations against it' })
  @ApiResponse({ status: 200 })
  async getState(@Param('jobCardId', ParseUUIDPipe) jobCardId: string) {
    return this.workshopService.getWorkshopState(jobCardId);
  }

  // Gantt board's "add crew helper" action (2026-09-09) - same ASSIGN_ROLES as assign()
  // above, since adding an extra technician to a job is the same kind of planning
  // decision as assigning the primary one.
  @Post(':jobCardId/crew-helpers')
  @RequiresCapability('WORKSHOP_ASSIGN')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'JobCardCrewHelper',
    getEntityId: (args) => args.params.jobCardId,
    getNewValues: (result) => ({ id: result?.id, technicianId: result?.technicianId }),
  })
  @ApiOperation({ summary: 'Add a crew helper (extra technician) to a WORKSHOP_ASSIGNED/IN_PROGRESS/SPARE_PENDING Job Card, without displacing the primary assignee' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400, description: 'Wrong section/status, not a TECHNICIAN_WORKSHOP, or already the primary assignee' })
  @ApiResponse({ status: 409, description: 'Already an active crew helper on this Job Card' })
  async addCrewHelper(
    @Param('jobCardId', ParseUUIDPipe) jobCardId: string,
    @Body() dto: AddCrewHelperDto,
    @CurrentUser() user: User,
  ) {
    return this.workshopService.addCrewHelper(jobCardId, dto.technicianId, user.id);
  }

  @Get(':jobCardId/crew-helpers')
  @RequiresCapability('WORKSHOP_VIEW')
  @ApiOperation({ summary: 'List active (not-yet-removed) crew helpers on a Job Card' })
  @ApiResponse({ status: 200 })
  async listCrewHelpers(@Param('jobCardId', ParseUUIDPipe) jobCardId: string) {
    return this.workshopService.listCrewHelpers(jobCardId);
  }

  @Post(':jobCardId/crew-helpers/:helperId/remove')
  @RequiresCapability('WORKSHOP_ASSIGN')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'JobCardCrewHelper',
    getEntityId: (args) => args.params.helperId,
  })
  @ApiOperation({ summary: 'Take a crew helper off a Job Card (soft-removal - kept for the audit trail)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Already removed' })
  @ApiResponse({ status: 404 })
  async removeCrewHelper(
    @Param('jobCardId', ParseUUIDPipe) jobCardId: string,
    @Param('helperId', ParseUUIDPipe) helperId: string,
    @CurrentUser() user: User,
  ) {
    return this.workshopService.removeCrewHelper(jobCardId, helperId, user.id);
  }
}
