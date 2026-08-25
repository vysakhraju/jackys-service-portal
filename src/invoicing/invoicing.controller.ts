import { Controller, Post, Get, Body, Param, UseGuards, UseInterceptors, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { InvoicingService } from './invoicing.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction } from '../auth/entities/audit-log.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

// Recording a payment is a Finance action, deliberately a different (and separate) role
// set from Delivery's LOGISTICS_DISPATCHER/DRIVER - the person who hands over the unit is
// never the person who gets to record that it was paid for.
const INVOICING_ROLES = ['ACCOUNTANT', 'FINANCE_MANAGER', 'SUPER_ADMIN', 'SERVICE_HEAD'];

@ApiTags('finance')
@Controller('invoicing')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class InvoicingController {
  constructor(private invoicingService: InvoicingService) {}

  @Get('job-card/:jobCardId')
  @Roles(...INVOICING_ROLES, 'LOGISTICS_DISPATCHER', 'DRIVER')
  @ApiOperation({ summary: 'Get (lazily creating a DRAFT if none exists yet) the invoice for an out-of-warranty, QC_PASSED Job Card' })
  @ApiResponse({ status: 200, description: 'The invoice (existing or newly drafted)' })
  @ApiResponse({ status: 400, description: 'Job Card is not QC_PASSED, is in-warranty, or has no approved Estimate' })
  async getForJobCard(@Param('jobCardId', ParseUUIDPipe) jobCardId: string) {
    return this.invoicingService.getOrCreateForJobCard(jobCardId);
  }

  @Get(':id')
  @Roles(...INVOICING_ROLES)
  @ApiOperation({ summary: 'Get one invoice by id' })
  @ApiResponse({ status: 200, description: 'The invoice' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicingService.findById(id);
  }

  @Post(':id/record-payment')
  @Roles(...INVOICING_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.PAYMENT_RECORD,
    entityType: 'Invoice',
    getEntityId: (req) => req.params.id,
    getNewValues: (result) => ({ id: result?.id, status: result?.status, paymentMethod: result?.paymentMethod, amountReceived: result?.amountReceived }),
  })
  @ApiOperation({ summary: 'FR-14: record a Cash/Card/Bank Transfer/B2B Credit payment against an invoice (no online gateway)' })
  @ApiResponse({ status: 200, description: 'Payment recorded, invoice is now PAID' })
  @ApiResponse({ status: 400, description: 'Already paid/cancelled, or amountReceived does not match the invoice amount' })
  @ApiResponse({ status: 403, description: 'B2B_CREDIT used on a non-B2B customer' })
  async recordPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordPaymentDto, @CurrentUser() user: User) {
    return this.invoicingService.recordPayment(id, dto.method, dto.amountReceived, user.id, dto.reference);
  }
}
