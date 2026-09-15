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
import { RolePermissionsService } from '../auth/role-permissions.service';
import { bypassesWorkshopOwnership } from './workshop-ownership.util';

// ASSIGN_ROLES/ACTION_ROLES/the ACTION_ROLES+CCE view combo all migrated onto the
// designation permission matrix (2026-09-10) as WORKSHOP_ASSIGN/WORKSHOP_ACTION/
// WORKSHOP_VIEW respectively - see capability-catalog.ts's "Workshop" section, each the
// exact same membership these arrays used to have.
//
// Ownership-bypass decision (who skips per-technician ownership once already inside a
// WORKSHOP_ACTION-gated handler) now lives in workshop-ownership.util.ts's
// bypassesWorkshopOwnership() - TL+ roles always bypass, plus (Modification Request
// 2026-09-16) anyone holding the admin-grantable WORKSHOP_ACTION_ANY_JOB capability, e.g.
// a CCE handed end-to-end job access via Designation Access.
const WORKSHOP_ACTION_ANY_JOB_CAPABILITY = 'WORKSHOP_ACTION_ANY_JOB';

@ApiTags('workshop')
@Controller('workshop')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class WorkshopController {
  constructor(
    private workshopService: WorkshopService,
    private rolePermissionsService: RolePermissionsService,
  ) {}

  private async resolveIsPrivileged(user: User): Promise<boolean> {
    const hasAnyJobCapability = await this.rolePermissionsService.userHasCapability(
      user as any,
      WORKSHOP_ACTION_ANY_JOB_CAPABILITY,
    );
    return bypassesWorkshopOwnership(user.role?.name, hasAnyJobCapability);
  }

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
  async startWip(@Param('jobCardId', ParseUUIDPipe) jobCardId: string, @CurrentUser() user: User) {
    const isPrivileged = await this.resolveIsPrivileged(user);
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
  async requestSpare(@Param('jobCardId', ParseUUIDPipe) jobCardId: string, @Body() dto: RequestSpareDto, @CurrentUser() user: User) {
    const isPrivileged = await this.resolveIsPrivileged(user);
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
  async complete(@Param('jobCardId', ParseUUIDPipe) jobCardId: string, @CurrentUser() user: User) {
    const isPrivileged = await this.resolveIsPrivileged(user);
    return this.workshopService.complete(jobCardId, user.id, isPrivileged);
  }

  // #218: static route, must be registered before the ':jobCardId' route below so
  // "rework-approvers" isn't swallowed by that param (and rejected by its ParseUUIDPipe).
  @Get('rework-approvers')
  @RequiresCapability('WORKSHOP_ACTION')
  @ApiOperation({ summary: '#218: list users holding an active REWORK_APPROVAL grant, for the Request Spare rework-approver name-based picker (GET /permissions is admin-only, unusable here)' })
  @ApiResponse({ status: 200, description: 'Active REWORK_APPROVAL holders as {id, name}' })
  async listReworkApprovers() {
    return this.workshopService.listReworkApprovers();
  }

  @Get(':jobCardId')
  @RequiresCapability('WORKSHOP_VIEW')
  @ApiOperation({ summary: 'Full workshop state for a Job Card - the job card itself, any stale (24h+ idle) reservations against it, and every currently-active (non-terminal) reservation against it regardless of age' })
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
