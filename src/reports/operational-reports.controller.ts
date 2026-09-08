import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { OperationalReportsService } from './operational-reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

// Same audience as 18.3 - no dedicated Operations role exists in RoleName either.
const VIEW_ROLES = ['SERVICE_HEAD', 'SUPER_ADMIN', 'TECHNICAL_TEAM_LEADER'];

@ApiTags('reports-operational')
@Controller('reports/operational')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
@Roles(...VIEW_ROLES)
export class OperationalReportsController {
  constructor(private operationalReportsService: OperationalReportsService) {}

  @Get('technician-productivity')
  @ApiQuery({ name: 'periodStart', required: false })
  @ApiQuery({ name: 'periodEnd', required: false })
  @ApiOperation({ summary: 'BRD 18.4 Technician Productivity - jobs completed, avg hours Login->QC, on-time arrival % (zero grace period). Customer rating omitted - not captured anywhere.' })
  getTechnicianProductivity(@Query('periodStart') periodStart?: string, @Query('periodEnd') periodEnd?: string) {
    return this.operationalReportsService.getTechnicianProductivity(periodStart, periodEnd);
  }

  @Get('sla-breach')
  @ApiQuery({ name: 'thresholdHours', required: false, example: 48 })
  @ApiOperation({ summary: 'BRD 18.4 SLA Breach Report - JobCard.createdAt -> qcApprovedAt vs a threshold (default 48h, the BRD\'s own example), excluding MATERIAL_SHORTAGE task-pause time (materialShortageHoursExcluded per item).' })
  getSlaBreach(@Query('thresholdHours') thresholdHours?: string) {
    return this.operationalReportsService.getSlaBreach(thresholdHours ? Number(thresholdHours) : undefined);
  }

  @Get('time-waiting-on-parts')
  @ApiQuery({ name: 'periodStart', required: false })
  @ApiQuery({ name: 'periodEnd', required: false })
  @ApiOperation({ summary: 'How long each Job Card has spent in a MATERIAL_SHORTAGE task pause - both auto-opened (Need Spare shortfall) and manually logged.' })
  getTimeWaitingOnParts(@Query('periodStart') periodStart?: string, @Query('periodEnd') periodEnd?: string) {
    return this.operationalReportsService.getTimeWaitingOnParts(periodStart, periodEnd);
  }

  @Get('technician-efficiency')
  @ApiQuery({ name: 'periodStart', required: false })
  @ApiQuery({ name: 'periodEnd', required: false })
  @ApiOperation({ summary: 'Technician Efficiency - Standard Repair Time (per fault code) vs actual elapsed time (TechnicianVisit.startedAt -> JobCard.qcApprovedAt), by technician and by job. Jobs whose fault code has no SRT set are omitted.' })
  getTechnicianEfficiency(@Query('periodStart') periodStart?: string, @Query('periodEnd') periodEnd?: string) {
    return this.operationalReportsService.getTechnicianEfficiency(periodStart, periodEnd);
  }

  @Get('spare-parts-consumption')
  @ApiQuery({ name: 'periodStart', required: false })
  @ApiQuery({ name: 'periodEnd', required: false })
  @ApiOperation({ summary: 'BRD 18.4 Spare Parts Consumption - top 10 by quantity, top 10 by value (cost basis), plus by-model and by-warranty/OOW breakdowns.' })
  getSpareConsumption(@Query('periodStart') periodStart?: string, @Query('periodEnd') periodEnd?: string) {
    return this.operationalReportsService.getSpareConsumption(periodStart, periodEnd);
  }
}
