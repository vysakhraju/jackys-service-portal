import { Controller, Get, Patch, Post, Body, Param, Query, UseGuards, UseInterceptors, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { TechnicianScheduleService } from './technician-schedule.service';
import { SetWorkshopCapacityDto } from './dto/set-workshop-capacity.dto';
import { ReorderFieldScheduleDto } from './dto/reorder-field-schedule.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiresCapability } from '../auth/decorators/requires-capability.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction } from '../auth/entities/audit-log.entity';

// Same set as who can assign a technician in the first place (AppointmentsController's
// assign-technician / WorkshopController's ASSIGN_ROLES) - viewing/using the board is a
// planning action, gated to whoever actually does the assigning.
// Migrated onto the designation permission matrix (2026-09-10) as TECHNICIAN_SCHEDULE_GANTT -
// see capability-catalog.ts's "Technician" section, same membership.
//
// Field/workshop scheduling split (2026-09-10, revised 2026-09-14): getGanttBoard() below is
// UNCHANGED and stays live (nothing was removed), still gated TECHNICIAN_SCHEDULE_GANTT.
// getWorkshopQueue() originally reused that same capability, on the theory that Workshop
// Queue and the Assignment Board were "the same planning audience" - live-tested finding
// (2026-09-14): that bundling meant there was no way to grant a CCE or Workshop Technician
// visibility into the workshop backlog (which they'd have every reason to want) without ALSO
// handing them the Assignment Board's drag-and-drop control over every technician's whole
// day. getWorkshopQueue() now has its own capability, WORKSHOP_QUEUE_VIEW, so an admin can
// grant it independently via Designation access. getFieldSchedule() deliberately does NOT
// reuse TECHNICIAN_SCHEDULE_GANTT (TL-only) either - it's gated by FIELD_SCHEDULE_REORDER
// instead (CCE + TL), so a CCE who's allowed to drag-reorder the board can also actually see
// it. Note: the business's own framing says "CCE assigns workshop jobs" too, but the
// EXISTING WorkshopController assign/reassign actions (reused unchanged by the Workshop
// Queue's assign action) are gated WORKSHOP_ASSIGN = Team Leader only, not CCE - flagged
// rather than silently widened, same as before.

@ApiTags('technician-schedule')
@ApiBearerAuth()
@Controller('technician-schedule')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TechnicianScheduleController {
  constructor(private readonly scheduleService: TechnicianScheduleService) {}

  @Get('gantt')
  @RequiresCapability('TECHNICIAN_SCHEDULE_GANTT')
  @ApiOperation({ summary: 'Per-technician Gantt board for one day - field appointments + workshop assignments + crew helpers, with double-booking conflicts flagged, plus the unassigned-appointment/unassigned-job-card pools for the click-to-assign panel' })
  @ApiQuery({ name: 'date', required: true, example: '2026-09-09', description: 'YYYY-MM-DD' })
  async getGanttBoard(@Query('date') date: string) {
    return this.scheduleService.getGanttBoard(date);
  }

  @Get('workshop-queue')
  @RequiresCapability('WORKSHOP_QUEUE_VIEW')
  @ApiOperation({ summary: 'Workshop Queue board (2026-09-10): per-technician FIFO backlog of actively-assigned WORKSHOP Job Cards, no time axis, plus each technician\'s (display-only) capacity gauge and the unassigned-workshop-job pool' })
  async getWorkshopQueue() {
    return this.scheduleService.getWorkshopQueue();
  }

  @Patch('workshop-queue/technicians/:id/capacity')
  @RequiresCapability('WORKSHOP_ASSIGN')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'User',
    getEntityId: (args) => args.params.id,
    getNewValues: (result) => ({ workshopDailyCapacity: result?.workshopDailyCapacity }),
  })
  @ApiOperation({ summary: 'Set a workshop technician\'s planning-visibility daily capacity for the Workshop Queue gauge - never enforced, see the gauge\'s own doc comment' })
  async setWorkshopCapacity(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetWorkshopCapacityDto) {
    return this.scheduleService.setWorkshopCapacity(id, dto.capacity);
  }

  @Get('field-schedule')
  @RequiresCapability('FIELD_SCHEDULE_REORDER')
  @ApiOperation({ summary: 'Field Technician Schedule board (2026-09-10): per-technician appointment list for one day, ordered by priority (drag-reordered) then time, plus the unassigned-appointment pool' })
  @ApiQuery({ name: 'date', required: true, example: '2026-09-09', description: 'YYYY-MM-DD' })
  async getFieldSchedule(@Query('date') date: string) {
    return this.scheduleService.getFieldSchedule(date);
  }

  // Deliberately its own capability (FIELD_SCHEDULE_REORDER), not TECHNICIAN_SCHEDULE_GANTT
  // or SCHEDULE_ASSIGN_TECHNICIAN - see this file's header comment on why CCE is included
  // here specifically, unlike the workshop-side actions above.
  @Post('field/reorder')
  @RequiresCapability('FIELD_SCHEDULE_REORDER')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.FIELD_SCHEDULE_REORDER,
    entityType: 'Appointment',
    getEntityId: (args) => args.body?.technicianId,
    getNewValues: (result) => ({ orderedAppointmentIds: Array.isArray(result) ? result.map((a: any) => a.id) : undefined }),
  })
  @ApiOperation({ summary: 'Reorder a field technician\'s day (what shows in their mobile app) - sets priority order only, never the customer\'s actual scheduledAt. Every reorder is logged (BRD requirement).' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'orderedAppointmentIds does not exactly match this technician\'s current active appointments' })
  async reorderFieldSchedule(@Body() dto: ReorderFieldScheduleDto) {
    return this.scheduleService.reorderFieldSchedule(dto.technicianId, dto.orderedAppointmentIds);
  }
}
