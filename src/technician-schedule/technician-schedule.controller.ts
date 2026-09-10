import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { TechnicianScheduleService } from './technician-schedule.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiresCapability } from '../auth/decorators/requires-capability.decorator';

// Same set as who can assign a technician in the first place (AppointmentsController's
// assign-technician / WorkshopController's ASSIGN_ROLES) - viewing/using the board is a
// planning action, gated to whoever actually does the assigning.
// Migrated onto the designation permission matrix (2026-09-10) as TECHNICIAN_SCHEDULE_GANTT -
// see capability-catalog.ts's "Technician" section, same membership.

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
}
