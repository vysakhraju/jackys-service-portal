import { Controller, Get, Post, Body, Param, UseGuards, UseInterceptors, ParseUUIDPipe, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { WorkshopService } from './workshop.service';
import { AssignWorkshopDto } from './dto/assign-workshop.dto';
import { RequestSpareDto } from './dto/request-spare.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction } from '../auth/entities/audit-log.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

const ASSIGN_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER'];
const ACTION_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER', 'TECHNICIAN_WORKSHOP'];
const PRIVILEGED_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER'];

@ApiTags('workshop')
@Controller('workshop')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class WorkshopController {
  constructor(private workshopService: WorkshopService) {}

  @Post(':jobCardId/assign')
  @Roles(...ASSIGN_ROLES)
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

  @Post(':jobCardId/start-wip')
  @Roles(...ACTION_ROLES)
  @ApiOperation({ summary: 'Start work-in-progress on a WORKSHOP_ASSIGNED Job Card' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403, description: 'Not the assigned workshop technician' })
  async startWip(@Param('jobCardId', ParseUUIDPipe) jobCardId: string, @CurrentUser() user: User, @Request() req: any) {
    const isPrivileged = PRIVILEGED_ROLES.includes(req.user.role?.name);
    return this.workshopService.startWip(jobCardId, user.id, isPrivileged);
  }

  @Post(':jobCardId/request-spare')
  @Roles(...ACTION_ROLES)
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
  @Roles(...ACTION_ROLES)
  @ApiOperation({ summary: "Mark workshop work done - moves to READY_FOR_QC (Phase 6). Blocked while SPARE_PENDING." })
  @ApiResponse({ status: 200 })
  async complete(@Param('jobCardId', ParseUUIDPipe) jobCardId: string, @CurrentUser() user: User, @Request() req: any) {
    const isPrivileged = PRIVILEGED_ROLES.includes(req.user.role?.name);
    return this.workshopService.complete(jobCardId, user.id, isPrivileged);
  }

  @Get(':jobCardId')
  @Roles(...ACTION_ROLES, 'CCE')
  @ApiOperation({ summary: 'Full workshop state for a Job Card, including any stale reservations against it' })
  @ApiResponse({ status: 200 })
  async getState(@Param('jobCardId', ParseUUIDPipe) jobCardId: string) {
    return this.workshopService.getWorkshopState(jobCardId);
  }
}
