import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { CustomerPortalService } from './customer-portal.service';

/**
 * Public, unauthenticated endpoints for the Customer Portal (EPIC-005) - no
 * JwtAuthGuard/RolesGuard at class level, exactly mirroring EstimatesPublicController
 * (Phase 4). All three routes are token-gated via JobCard.publicToken; see
 * CustomerPortalService's class doc comment for what each one returns and why "pay
 * invoice" is view-only.
 */
@ApiTags('customer-portal')
@Controller('customer-portal/public')
export class CustomerPortalController {
  constructor(private customerPortalService: CustomerPortalService) {}

  @Get('track/:token')
  @ApiOperation({ summary: 'Track a job by its public tracking link (no login required)' })
  @ApiParam({ name: 'token', type: String })
  @ApiResponse({ status: 200, description: 'Customer-safe job status' })
  @ApiResponse({ status: 404, description: 'Unknown or expired token' })
  async track(@Param('token') token: string) {
    return this.customerPortalService.trackByToken(token);
  }

  @Get('invoice/:token')
  @ApiOperation({ summary: 'View the amount owed (if any) for a job, by its public tracking link (no login required, view-only - no online payment)' })
  @ApiParam({ name: 'token', type: String })
  @ApiResponse({ status: 200, description: 'Invoice/amount-due summary' })
  @ApiResponse({ status: 404, description: 'Unknown or expired token' })
  async invoice(@Param('token') token: string) {
    return this.customerPortalService.getInvoiceByToken(token);
  }

  @Get('job-card/:token/summary')
  @ApiOperation({ summary: 'Consolidated "download job card" view (job card + estimate + invoice + delivery), by its public tracking link (no login required)' })
  @ApiParam({ name: 'token', type: String })
  @ApiResponse({ status: 200, description: 'Consolidated summary' })
  @ApiResponse({ status: 404, description: 'Unknown or expired token' })
  async summary(@Param('token') token: string) {
    return this.customerPortalService.getSummaryByToken(token);
  }
}
