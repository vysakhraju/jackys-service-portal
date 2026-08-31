import { Controller, Post, Get, Body, Param, Query, UseGuards, UseInterceptors, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { InvoicingService } from './invoicing.service';
import { InvoiceStatus } from './entities/invoice.entity';
import { CustomerType } from '../appointments/entities/appointment.entity';
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

  @Get()
  @Roles(...INVOICING_ROLES)
  @ApiQuery({ name: 'status', required: false, enum: InvoiceStatus })
  @ApiQuery({ name: 'customerType', required: false, enum: CustomerType })
  @ApiOperation({ summary: 'List invoices, optionally filtered by status and/or the Job Card appointment\'s customerType (frontend Finance browse screen - the only other primitives are by-id, by-job-card, and the B2B-unpaid-only aging report, none of which cover a general browse/audit view)' })
  @ApiResponse({ status: 200, description: 'Invoices, newest first' })
  async findAll(@Query('status') status?: InvoiceStatus, @Query('customerType') customerType?: CustomerType) {
    return this.invoicingService.findAll(status, customerType);
  }

  @Get('job-card/:jobCardId')
  @Roles(...INVOICING_ROLES, 'LOGISTICS_DISPATCHER', 'DRIVER')
  @ApiOperation({ summary: 'Get (lazily creating a DRAFT if none exists yet) the invoice for an out-of-warranty, QC_PASSED Job Card' })
  @ApiResponse({ status: 200, description: 'The invoice (existing or newly drafted)' })
  @ApiResponse({ status: 400, description: 'Job Card is not QC_PASSED, is in-warranty, or has no approved Estimate' })
  async getForJobCard(@Param('jobCardId', ParseUUIDPipe) jobCardId: string) {
    return this.invoicingService.getOrCreateForJobCard(jobCardId);
  }

  @Get('b2b-aging')
  @Roles(...INVOICING_ROLES)
  @ApiOperation({ summary: 'AC-16: B2B Credit aging/recharge report, bucketed 0-30/31-60/61-90/90+ days past due' })
  @ApiResponse({ status: 200, description: 'Aging buckets and total outstanding' })
  async getB2bAging() {
    return this.invoicingService.getB2bAgingReport();
  }

  @Get(':id')
  @Roles(...INVOICING_ROLES)
  @ApiOperation({ summary: 'Get one invoice by id' })
  @ApiResponse({ status: 200, description: 'The invoice' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicingService.findById(id);
  }

  @Get(':id/payments')
  @Roles(...INVOICING_ROLES)
  @ApiOperation({ summary: 'List every payment recorded against this invoice, oldest first' })
  @ApiResponse({ status: 200, description: 'Payment history' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async findPayments(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicingService.findPayments(id);
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
  @ApiOperation({ summary: 'FR-14: record a Cash/Card/Bank Transfer/B2B Credit payment against an invoice (no online gateway). Supports partial payments.' })
  @ApiResponse({ status: 200, description: 'Payment recorded - invoice is now PARTIALLY_PAID or PAID' })
  @ApiResponse({ status: 400, description: 'Already fully paid/cancelled, or amount exceeds the remaining balance' })
  @ApiResponse({ status: 403, description: 'B2B_CREDIT used on a non-B2B customer' })
  async recordPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordPaymentDto, @CurrentUser() user: User) {
    return this.invoicingService.recordPayment(id, dto.method, dto.amountReceived, user.id, dto.reference);
  }
}
