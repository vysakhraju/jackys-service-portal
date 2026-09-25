import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, UseInterceptors, ParseUUIDPipe, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JobCardsService } from './job-cards.service';
import { CreateJobCardDto } from './dto/create-job-card.dto';
import { CreateActivityJobCardDto } from './dto/create-activity-job-card.dto';
import { ValidateSnDto } from './dto/validate-sn.dto';
import { AssignSectionDto } from './dto/assign-section.dto';
import { WarrantyOverrideDto } from './dto/warranty-override.dto';
import { ApproveCustomerDto } from './dto/approve-customer.dto';
import { CancelJobCardDto } from './dto/cancel-job-card.dto';
import { QcRejectDto } from './dto/qc-reject.dto';
import { PauseTaskDto } from './dto/pause-task.dto';
import { AddActivitySpareLineDto } from './dto/add-activity-spare-line.dto';
import { JobCard } from './entities/job-card.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiresCapability } from '../auth/decorators/requires-capability.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction } from '../auth/entities/audit-log.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';
import { InventoryService } from '../inventory/inventory.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PermissionType } from '../permissions/entities/user-permission-grant.entity';
import { RequiresPermissionGrant } from '../permissions/decorators/requires-permission-grant.decorator';

// Creation/validation/section-assignment/approval/cancel, warranty override, and task-timer
// pause/resume all migrated onto the designation permission matrix (2026-09-10) - see
// capability-catalog.ts's "Job Cards" section for the JOB_CARD_MANAGE/
// JOB_CARD_WARRANTY_OVERRIDE/JOB_CARD_TASK_PAUSE entries, which are each the exact same
// membership the old hardcoded @Roles() arrays here used to have.
//
// Phase 6 QC gate: deliberately NOT a fixed @Roles() list (the QC_GATE_ACCESS capability -
// see capability-catalog.ts, same membership: TECHNICAL_TEAM_LEADER, CCE, QC_OFFICER, plus
// SUPER_ADMIN/SERVICE_HEAD via RolesGuard's hardcoded bypass). Anyone can be admin-assigned
// the QC_APPROVAL grant (QC_OFFICER, a Team Leader, a Supervisor, a CCE - whoever the
// business actually wants) via PermissionsController. This capability is only the "can even
// be considered for this action at all" floor (excludes pure field/workshop technicians by
// default) - the REAL check is the requireActiveGrant() call inside each handler below,
// which is what makes this "each and every activity ... assigned to role based if needed"
// per the user's own requirement.
//
// Task-timer pause/resume ownership: JOB_CARD_TASK_PAUSE's floor (office roles plus
// whichever technician is actually doing the work, field or workshop) is a different,
// wider question from WHO gets to bypass per-technician ownership once inside the handler -
// that's TASK_PAUSE_PRIVILEGED_ROLES below, a plain business-logic array (not a @Roles()/
// @RequiresCapability() gate, so it stays outside the matrix, same "checked in code, not
// admin-editable" reasoning as WorkshopController's own PRIVILEGED_ROLES).
const TASK_PAUSE_PRIVILEGED_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER', 'CCE'];

@ApiTags('job-cards')
@Controller('job-cards')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class JobCardsController {
  constructor(
    private jobCardsService: JobCardsService,
    private inventoryService: InventoryService,
    private permissionsService: PermissionsService,
  ) {}

  @Post()
  @RequiresCapability('JOB_CARD_MANAGE')
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

  // Job Type split (2026-09-22 request, Phase 10) - the Installation/Delivery
  // Installation counterpart to create() above. Same JOB_CARD_MANAGE capability gate
  // (this is still "create a Job Card", just via a different precondition set) and same
  // audit shape, plus the ERP reference number/line item count for the trail.
  @Post('from-activity')
  @RequiresCapability('JOB_CARD_MANAGE')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CREATE,
    entityType: 'JobCard',
    getNewValues: (result) => ({
      id: result?.id,
      jobCardNumber: result?.jobCardNumber,
      appointmentId: result?.appointmentId,
      erpReferenceNumber: result?.erpReferenceNumber,
      lineItemCount: result?.activityLineItems?.length,
    }),
  })
  @ApiOperation({
    summary:
      'Create a Job Card for an Installation/Delivery Installation appointment from its ERP reference number + line items (Job Type split Phase 10). Skips S/N validation, fault/symptom, and the FR-05 invoice gate entirely - requires the appointment\'s mobile activity to already be Finished (or CCE-overridden) instead.',
  })
  @ApiResponse({ status: 201, type: JobCard })
  @ApiResponse({ status: 400, description: 'Not an Installation/Delivery Installation appointment, or its activity is not Finished yet' })
  @ApiResponse({ status: 404, description: 'Appointment or an ApplianceModel referenced by a line item not found' })
  @ApiResponse({ status: 409, description: 'A Job Card already exists for this appointment' })
  async createFromActivity(@Body() dto: CreateActivityJobCardDto, @CurrentUser() user: User) {
    return this.jobCardsService.createFromActivity(dto, user.id);
  }

  @Post(':id/validate-sn')
  @RequiresCapability('JOB_CARD_MANAGE')
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
  @RequiresCapability('JOB_CARD_MANAGE')
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
  @RequiresCapability('JOB_CARD_MANAGE')
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
  @RequiresCapability('JOB_CARD_WARRANTY_OVERRIDE')
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

  @Post(':id/cancel')
  @RequiresCapability('JOB_CARD_MANAGE')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CANCEL,
    entityType: 'JobCard',
    getEntityId: (args) => args.params?.id,
    getNewValues: (result) => ({ status: result?.status, cancellationReason: result?.cancellationReason }),
  })
  @ApiOperation({ summary: 'Cancel a Job Card - any active spare reservations move to RETURN_PENDING (never auto-restored to on-hand stock, see Inventory)' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 201, type: JobCard })
  @ApiResponse({ status: 400, description: 'Already CANCELLED, or already READY_FOR_QC' })
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelJobCardDto) {
    const jobCard = await this.jobCardsService.cancel(id, dto.reason);
    await this.inventoryService.cancelReservationsForJobCard(id);
    return jobCard;
  }

  // --- Phase 6: QC gate ---------------------------------------------------------------
  // Every job freezes at READY_FOR_QC until one of these two endpoints is called. Both
  // require the caller to hold an active QC_APPROVAL grant (PermissionsService) -
  // completely independent of their eligibility floor - see QC_GATE_ROLES above (now
  // migrated to the QC_GATE_ACCESS capability, same membership) for why that floor is
  // only that - a floor, not the real gate.

  @Post(':id/qc/approve')
  @RequiresCapability('QC_GATE_ACCESS')
  @RequiresPermissionGrant(PermissionType.QC_APPROVAL)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.QC_APPROVE,
    entityType: 'JobCard',
    getEntityId: (args) => args.params?.id,
    getNewValues: (result) => ({ status: result?.status, qcApprovedByUserId: result?.qcApprovedByUserId }),
  })
  @ApiOperation({ summary: 'QC approve (FR-10): atomically consumes every reserved spare on this job (Main Store -> Damage Location) and passes the job. Requires the QC_APPROVAL grant.' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 201, type: JobCard })
  @ApiResponse({ status: 400, description: 'Job Card is not READY_FOR_QC' })
  @ApiResponse({ status: 403, description: 'Caller does not hold an active QC_APPROVAL grant' })
  @ApiResponse({ status: 409, description: 'Blocked - a spare part on this job was never fully reserved (stock shortfall) or a stock data problem was detected' })
  async qcApprove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    await this.permissionsService.requireActiveGrant(user.id, PermissionType.QC_APPROVAL);
    return this.inventoryService.consumeReservationsOnQcApproval(id, user.id);
  }

  @Post(':id/qc/reject')
  @RequiresCapability('QC_GATE_ACCESS')
  @RequiresPermissionGrant(PermissionType.QC_APPROVAL)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.QC_REJECT,
    entityType: 'JobCard',
    getEntityId: (args) => args.params?.id,
    getNewValues: (result) => ({ status: result?.status, qcRejectionCount: result?.qcRejectionCount, reason: result?.lastQcRejectionReason }),
  })
  @ApiOperation({ summary: 'QC reject: sends the job back to the workshop to be fixed. Requires the QC_APPROVAL grant. Nothing in stock is touched - nothing was ever consumed before an approval.' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 201, type: JobCard })
  @ApiResponse({ status: 400, description: 'Job Card is not READY_FOR_QC' })
  @ApiResponse({ status: 403, description: 'Caller does not hold an active QC_APPROVAL grant' })
  async qcRejectJobCard(@Param('id', ParseUUIDPipe) id: string, @Body() dto: QcRejectDto, @CurrentUser() user: User) {
    await this.permissionsService.requireActiveGrant(user.id, PermissionType.QC_APPROVAL);
    return this.jobCardsService.qcReject(id, dto.reason);
  }

  // --- Task timer pause/resume (SLA-safe pausing) -------------------------------------

  @Post(':id/pause')
  @RequiresCapability('JOB_CARD_TASK_PAUSE')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'JobCard',
    getEntityId: (args) => args.params?.id,
    getNewValues: (result) => ({ reason: result?.reason, pausedAt: result?.pausedAt }),
  })
  @ApiOperation({ summary: 'Pause the task timer with a reason - MATERIAL_SHORTAGE is SLA-exempt, every other reason is tracked but still counts against SLA' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400, description: 'Job Card is not in a pausable status' })
  @ApiResponse({ status: 403, description: 'Caller is not the technician assigned to this Job Card' })
  @ApiResponse({ status: 409, description: 'A pause is already open on this Job Card' })
  async pauseTask(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PauseTaskDto, @CurrentUser() user: User, @Request() req: any) {
    const isPrivileged = TASK_PAUSE_PRIVILEGED_ROLES.includes(req.user.role?.name);
    return this.jobCardsService.pauseTask(id, dto, user.id, isPrivileged);
  }

  @Post(':id/resume')
  @RequiresCapability('JOB_CARD_TASK_PAUSE')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'JobCard',
    getEntityId: (args) => args.params?.id,
    getNewValues: (result) => ({ resumedAt: result?.resumedAt }),
  })
  @ApiOperation({ summary: 'Resume the task timer, closing whichever pause is currently open' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 403, description: 'Caller is not the technician assigned to this Job Card' })
  @ApiResponse({ status: 409, description: 'No pause is currently open on this Job Card' })
  async resumeTask(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User, @Request() req: any) {
    const isPrivileged = TASK_PAUSE_PRIVILEGED_ROLES.includes(req.user.role?.name);
    return this.jobCardsService.resumeTask(id, user.id, isPrivileged);
  }

  @Get(':id/pauses')
  @ApiOperation({ summary: 'Full pause history for a Job Card, oldest first' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200 })
  async getTaskPauses(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobCardsService.getTaskPauses(id);
  }

  // Job Type split (2026-09-22 request, Phase 10) - not strictly needed by the web UI
  // today (findById()/findByAppointmentId() already eager-load activityLineItems), but
  // kept as its own endpoint for parity with getTaskPauses() above and for any future
  // consumer that only wants the line items, not the whole Job Card.
  @Get(':id/line-items')
  @ApiOperation({ summary: 'Line items for an Installation/Delivery Installation Job Card (Job Type split Phase 10) - empty for a REPAIR-flow Job Card' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200 })
  async getActivityLineItems(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobCardsService.getActivityLineItems(id);
  }

  // Activity spares record-keeping (2026-09-25) - record-only for now (no stock
  // reservation/deduction, see JobCardActivitySpareLine's own doc comment). Gated
  // JOB_CARD_MANAGE on the two mutating routes, same capability every other Job Card
  // mutation in this controller already uses; the GET stays open like getActivityLineItems
  // above (no gate beyond class-level auth).
  @Get(':id/spare-lines')
  @ApiOperation({ summary: 'Spare parts recorded against an Activity (COMPLETED) Job Card - empty for a REPAIR-flow Job Card' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200 })
  async getActivitySpareLines(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobCardsService.getActivitySpareLines(id);
  }

  @Post(':id/spare-lines')
  @RequiresCapability('JOB_CARD_MANAGE')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'JobCard',
    getEntityId: (args) => args.params?.id,
  })
  @ApiOperation({ summary: 'Record a spare part used on an Activity (COMPLETED) Job Card - record only, no stock deduction' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400, description: 'Job Card is not COMPLETED, or the spare part is inactive' })
  @ApiResponse({ status: 404, description: 'Job Card or spare part not found' })
  async addActivitySpareLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddActivitySpareLineDto,
    @CurrentUser() user: User,
  ) {
    return this.jobCardsService.addActivitySpareLine(id, dto, user.id);
  }

  @Delete(':id/spare-lines/:lineId')
  @RequiresCapability('JOB_CARD_MANAGE')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'JobCard',
    getEntityId: (args) => args.params?.id,
  })
  @ApiOperation({ summary: 'Remove a mistakenly-recorded spare line from an Activity Job Card' })
  @ApiParam({ name: 'id', type: String })
  @ApiParam({ name: 'lineId', type: String })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Job Card or spare line not found' })
  async removeActivitySpareLine(@Param('id', ParseUUIDPipe) id: string, @Param('lineId', ParseUUIDPipe) lineId: string) {
    await this.jobCardsService.removeActivitySpareLine(id, lineId);
    return { success: true };
  }

  // Must stay ABOVE @Get(':id') below - that route's ParseUUIDPipe would otherwise 400
  // on the literal path segment "eligible-appointments" before this handler ever ran
  // (NestJS matches routes in declaration order; a bare `:id` matches any single segment).
  @Get('eligible-appointments')
  @RequiresCapability('JOB_CARD_MANAGE')
  @ApiOperation({
    summary: 'Appointments ready for Job Card creation right now (no Job Card yet, invoice + S/N/warranty/fault/symptom all captured)',
  })
  @ApiResponse({ status: 200 })
  async findEligibleAppointments(@Query('q') q?: string) {
    return this.jobCardsService.findEligibleForJobCardCreation(q);
  }

  // Must stay ABOVE @Get(':id') too, same reason as eligible-appointments above.
  @Get('eligible-activity-appointments')
  @RequiresCapability('JOB_CARD_MANAGE')
  @ApiOperation({
    summary:
      'Installation/Delivery Installation appointments ready for createFromActivity() right now (no Job Card yet, mobile activity already Finished or CCE-overridden) - Job Type split Phase 10',
  })
  @ApiResponse({ status: 200 })
  async findEligibleActivityAppointments(@Query('q') q?: string) {
    return this.jobCardsService.findEligibleForActivityJobCardCreation(q);
  }

  // Must stay ABOVE @Get(':id') too, same reason as eligible-appointments above.
  @Get('blocked-appointments')
  @RequiresCapability('JOB_CARD_MANAGE')
  @ApiOperation({
    summary: 'Appointments with S/N/warranty/fault/symptom fully captured and no Job Card yet, but blocked from creation and why (currently: missing invoice number)',
  })
  @ApiResponse({ status: 200 })
  async findBlockedAppointments(@Query('q') q?: string) {
    return this.jobCardsService.findBlockedForJobCardCreation(q);
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
