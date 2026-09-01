import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { FinanceReportsService } from './finance-reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

// BRD 18.2 Finance Dashboard audience. Narrower group than 18.1's Service Manager board -
// Finance-specific data should not be reachable by SERVICE_HEAD/TECHNICAL_TEAM_LEADER
// alone without also being Finance staff, but SERVICE_HEAD/SUPER_ADMIN are included per
// this app's "a manager can also see what their team sees" precedent (matches
// WarrantyClaimsController's VIEW_ROLES for the credit-note-adjacent Warranty section).
const VIEW_ROLES = ['ACCOUNTANT', 'FINANCE_MANAGER', 'SERVICE_HEAD', 'SUPER_ADMIN'];

@ApiTags('reports-finance')
@Controller('reports/finance')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
@Roles(...VIEW_ROLES)
export class FinanceReportsController {
  constructor(private financeReportsService: FinanceReportsService) {}

  @Get('summary')
  @ApiQuery({ name: 'periodStart', required: false, example: '2026-08-01' })
  @ApiQuery({ name: 'periodEnd', required: false, example: '2026-08-31' })
  @ApiOperation({
    summary:
      'BRD 18.2 Revenue/Cost/Profit/OOW/Warranty(IW)/AMC summary. No blended "Total Company Revenue" figure - OOW/IW-recharge/AMC are always reported as separate streams (see FinanceReportsService class doc for why). Fields with no computable data return null, never a fabricated number.',
  })
  getSummary(@Query('periodStart') periodStart?: string, @Query('periodEnd') periodEnd?: string) {
    return this.financeReportsService.getSummary(periodStart, periodEnd);
  }

  @Get('gp-by-service-centre')
  @ApiQuery({ name: 'periodStart', required: false })
  @ApiQuery({ name: 'periodEnd', required: false })
  @ApiOperation({ summary: 'BRD 18.2 GP per Service Centre - revenue per stream, per centre. Overhead/Gross Profit/GP Margin % are omitted/null (no overhead-allocation or OOW-cost concept exists).' })
  getGpByServiceCentre(@Query('periodStart') periodStart?: string, @Query('periodEnd') periodEnd?: string) {
    return this.financeReportsService.getGpByServiceCentre(periodStart, periodEnd);
  }

  @Get('interdepartment-recharge')
  @ApiQuery({ name: 'periodStart', required: false })
  @ApiQuery({ name: 'periodEnd', required: false })
  @ApiOperation({ summary: 'BRD 18.2 / AC-16 Interdepartment Recharge Summary, grouped by sales channel name. Settlement Status labelled Pending/Posted to GL (never "Settled" - a POSTED recharge is a recognised posting, not confirmed cash settlement).' })
  getInterdepartmentRecharge(@Query('periodStart') periodStart?: string, @Query('periodEnd') periodEnd?: string) {
    return this.financeReportsService.getInterdepartmentRecharge(periodStart, periodEnd);
  }

  @Get('unpaid-invoices')
  @ApiOperation({ summary: 'BRD 18.2 Unpaid Invoices (OOW), 0-2/3-7/8+ day aging buckets since invoice date, B2B and B2C reported separately.' })
  getUnpaidInvoices() {
    return this.financeReportsService.getUnpaidInvoices();
  }

  @Get('profit-trend')
  @ApiQuery({ name: 'groupBy', enum: ['week', 'month', 'quarter'], required: false })
  @ApiQuery({ name: 'periodStart', required: false })
  @ApiQuery({ name: 'periodEnd', required: false })
  @ApiOperation({ summary: 'BRD 18.2 Profit Trend, revenue per stream per period. Total COGS/Gross Profit/GP Margin % are null (OOW and AMC cost are unknown).' })
  getProfitTrend(
    @Query('groupBy') groupBy: 'week' | 'month' | 'quarter' = 'month',
    @Query('periodStart') periodStart?: string,
    @Query('periodEnd') periodEnd?: string,
  ) {
    return this.financeReportsService.getProfitTrend(groupBy, periodStart, periodEnd);
  }
}
