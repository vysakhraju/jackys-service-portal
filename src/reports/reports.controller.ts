import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

// BRD 18.1 "Service Manager Dashboard" audience. The BRD's other three dashboards -
// 18.2 Finance, 18.3 Quality/Product, 18.4 Operational Reports - are explicitly out of
// scope for this phase (see STATUS_TRACKER's Phase 11 write-up); ACCOUNTANT/
// FINANCE_MANAGER therefore have no reason to see this particular board.
const VIEW_ROLES = ['SERVICE_HEAD', 'SUPER_ADMIN', 'TECHNICAL_TEAM_LEADER'];

@ApiTags('reports')
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
@Roles(...VIEW_ROLES)
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Get('dashboard/kanban')
  @ApiOperation({ summary: 'BRD 18.1 Job Status Board - full Kanban board with job cards per column' })
  @ApiResponse({ status: 200, description: 'Kanban board snapshot' })
  getKanban() {
    return this.reportsService.getKanbanBoard();
  }

  @Get('dashboard/kanban/summary')
  @ApiOperation({ summary: 'Job Status Board - counts only, for lightweight polling clients' })
  @ApiResponse({ status: 200, description: 'Kanban column counts' })
  getKanbanSummary() {
    return this.reportsService.getKanbanSummary();
  }

  @Get('dashboard/approval-aging')
  @ApiOperation({ summary: 'BRD 18.1 Pending Approval Aging - OOW estimates awaiting customer response, red alert past 4hrs' })
  @ApiResponse({ status: 200, description: 'Approval aging report' })
  getApprovalAging() {
    return this.reportsService.getApprovalAging();
  }

  @Get('dashboard/service-efficiency')
  @ApiOperation({ summary: 'BRD 18.1 Service Efficiency - avg time Login to QC Completed, by technician and appliance category' })
  @ApiResponse({ status: 200, description: 'Service efficiency report' })
  getServiceEfficiency() {
    return this.reportsService.getServiceEfficiency();
  }

  @Get('dashboard/first-time-fix-rate')
  @ApiOperation({ summary: 'BRD 18.1 First-Time Fix Rate - on-site-only completions over total completed jobs' })
  @ApiResponse({ status: 200, description: 'First-time fix rate report' })
  getFirstTimeFixRate() {
    return this.reportsService.getFirstTimeFixRate();
  }

  @Get('dashboard/overview')
  @ApiOperation({ summary: 'Combined single-call payload for the dashboard\'s initial page load' })
  @ApiResponse({ status: 200, description: 'Dashboard overview' })
  getOverview() {
    return this.reportsService.getOverview();
  }
}
