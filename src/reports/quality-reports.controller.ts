import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { QualityReportsService } from './quality-reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

// BRD 18.3 audience. No dedicated Quality/Product role exists in RoleName (same finding
// as AMC/Dismantling phases) - Service Head / Team Leader / Super Admin cover it, matching
// 18.1's own VIEW_ROLES exactly (this is the same operational-leadership audience).
const VIEW_ROLES = ['SERVICE_HEAD', 'SUPER_ADMIN', 'TECHNICAL_TEAM_LEADER'];

@ApiTags('reports-quality')
@Controller('reports/quality')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
@Roles(...VIEW_ROLES)
export class QualityReportsController {
  constructor(private qualityReportsService: QualityReportsService) {}

  @Get('product-failure-ratio')
  @ApiQuery({ name: 'brand', required: false })
  @ApiQuery({ name: 'modelNumber', required: false })
  @ApiQuery({ name: 'faultCode', required: false })
  @ApiQuery({ name: 'groupBy', enum: ['month', 'quarter', 'year'], required: false })
  @ApiQuery({ name: 'periodStart', required: false })
  @ApiQuery({ name: 'periodEnd', required: false })
  @ApiOperation({ summary: 'AC-22 Product Failure Ratio - Job Card counts by model, filterable by brand/model/fault code/time period.' })
  getProductFailureRatio(
    @Query('brand') brand?: string,
    @Query('modelNumber') modelNumber?: string,
    @Query('faultCode') faultCode?: string,
    @Query('groupBy') groupBy: 'month' | 'quarter' | 'year' = 'month',
    @Query('periodStart') periodStart?: string,
    @Query('periodEnd') periodEnd?: string,
  ) {
    return this.qualityReportsService.getProductFailureRatio({ brand, modelNumber, faultCode, groupBy, periodStart, periodEnd });
  }

  @Get('repeat-complaints')
  @ApiOperation({ summary: 'AC-23 Repeat Complaint Report - S/N with >1 Job Card within a 30-day window, flagged for engineering escalation.' })
  getRepeatComplaints() {
    return this.qualityReportsService.getRepeatComplaints();
  }

  @Get('rwr-analysis')
  @ApiQuery({ name: 'periodStart', required: false })
  @ApiQuery({ name: 'periodEnd', required: false })
  @ApiOperation({ summary: 'AC-24 RWR Analysis - rejected Estimate counts by model/reason/region. Reason is free text ("Not specified" when absent) - no structured reason-code field exists.' })
  getRwrAnalysis(@Query('periodStart') periodStart?: string, @Query('periodEnd') periodEnd?: string) {
    return this.qualityReportsService.getRwrAnalysis(periodStart, periodEnd);
  }
}
