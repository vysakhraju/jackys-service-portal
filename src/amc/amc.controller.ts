import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AmcService } from './amc.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction } from '../auth/entities/audit-log.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';
import { AmcContractStatus } from './entities/amc-contract.entity';
import { CreateAmcContractDto } from './dto/create-amc-contract.dto';
import { RenewAmcContractDto } from './dto/renew-amc-contract.dto';
import { CompleteAmcVisitDto } from './dto/complete-amc-visit.dto';
import { CancelAmcContractDto } from './dto/cancel-amc-contract.dto';
import { GenerateAmcBillingInvoiceDto } from './dto/generate-amc-billing-invoice.dto';
import { RecordAmcBillingPaymentDto } from './dto/record-amc-billing-payment.dto';

const AMC_MANAGEMENT_ROLES = ['SERVICE_HEAD', 'SUPER_ADMIN', 'CCE'];
const AMC_VIEW_ROLES = ['SERVICE_HEAD', 'SUPER_ADMIN', 'CCE', 'TECHNICIAN_FIELD', 'TECHNICIAN_WORKSHOP', 'ACCOUNTANT', 'FINANCE_MANAGER'];
const AMC_TECHNICIAN_ROLES = ['TECHNICIAN_FIELD', 'TECHNICIAN_WORKSHOP', 'SERVICE_HEAD', 'SUPER_ADMIN'];
const FINANCE_ROLES = ['ACCOUNTANT', 'FINANCE_MANAGER', 'SUPER_ADMIN', 'SERVICE_HEAD'];

@ApiTags('amc')
@Controller('amc')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class AmcController {
  constructor(private amcService: AmcService) {}

  @Post('contracts')
  @Roles(...AMC_MANAGEMENT_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CREATE,
    entityType: 'AmcContract',
    getNewValues: (result: any) => ({ id: result?.id, contractNumber: result?.contractNumber }),
  })
  @ApiOperation({ summary: 'Create an AMC contract - auto-generates its full PM visit schedule as Appointment rows (type=AMC), capped at 60 visits' })
  @ApiResponse({ status: 201, description: 'Contract created with its PM schedule generated' })
  @ApiResponse({ status: 400, description: 'Invalid date range, or the schedule would exceed the 60-visit safety cap' })
  async create(@Body() dto: CreateAmcContractDto, @CurrentUser() user: User) {
    return this.amcService.createContract(dto, user.id);
  }

  @Get('contracts')
  @Roles(...AMC_VIEW_ROLES)
  @ApiQuery({ name: 'status', enum: AmcContractStatus, required: false })
  @ApiOperation({ summary: 'List all AMC contracts, optionally filtered by status' })
  async findAll(@Query('status') status?: AmcContractStatus) {
    return this.amcService.findAll(status);
  }

  @Get('contracts/expiring')
  @Roles(...AMC_VIEW_ROLES)
  @ApiQuery({ name: 'withinDays', required: false, example: 30 })
  @ApiOperation({ summary: 'ACTIVE contracts expiring within N days (default 30) - the manual companion to the renewal-reminder trigger, since no scheduler exists to auto-fire it' })
  async getExpiring(@Query('withinDays') withinDays?: string) {
    return this.amcService.getExpiringContracts(withinDays ? parseInt(withinDays, 10) : 30);
  }

  @Get('upsell-candidates')
  @Roles(...AMC_VIEW_ROLES)
  @ApiOperation({ summary: 'Post-MVP bonus: out-of-warranty customers with a paid repair (approved Estimate) who are not already on an ACTIVE AMC contract - heuristic phone-number match, not a precise CRM lookup' })
  async getUpsellCandidates() {
    return this.amcService.getRwrUpsellCandidates();
  }

  @Get('contracts/number/:contractNumber')
  @Roles(...AMC_VIEW_ROLES)
  @ApiOperation({ summary: 'Get an AMC contract by its contractNumber (AMC-####)' })
  async findByContractNumber(@Param('contractNumber') contractNumber: string) {
    return this.amcService.findByContractNumber(contractNumber);
  }

  @Get('contracts/:id')
  @Roles(...AMC_VIEW_ROLES)
  @ApiOperation({ summary: 'Get one AMC contract by id' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.amcService.findById(id);
  }

  @Get('contracts/:id/schedule')
  @Roles(...AMC_VIEW_ROLES)
  @ApiOperation({ summary: 'List the PM visit schedule (Appointment rows, type=AMC) generated for a contract' })
  async getSchedule(@Param('id', ParseUUIDPipe) id: string) {
    return this.amcService.getSchedule(id);
  }

  @Post('contracts/:id/renew')
  @Roles(...AMC_MANAGEMENT_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CREATE,
    entityType: 'AmcContract',
    getNewValues: (result: any) => ({ id: result?.id, contractNumber: result?.contractNumber, previousContractId: result?.previousContractId }),
  })
  @ApiOperation({ summary: 'Renew a contract - creates a new contract (previousContractId set) with its own PM schedule, marks the original RENEWED' })
  @ApiResponse({ status: 400, description: 'Original contract is CANCELLED or already RENEWED, or the new schedule would exceed the visit cap' })
  async renew(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RenewAmcContractDto, @CurrentUser() user: User) {
    return this.amcService.renewContract(id, dto, user.id);
  }

  @Post('contracts/:id/cancel')
  @Roles(...AMC_MANAGEMENT_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CANCEL,
    entityType: 'AmcContract',
    getEntityId: (req: any) => req.params.id,
    getNewValues: (result: any) => ({ status: result?.status, cancellationReason: result?.cancellationReason }),
  })
  @ApiOperation({ summary: 'Cancel an ACTIVE contract - also cancels any still-future SCHEDULED PM visits tied to it' })
  @ApiResponse({ status: 400, description: 'Contract is not ACTIVE' })
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelAmcContractDto) {
    return this.amcService.cancelContract(id, dto.reason);
  }

  @Post('contracts/:id/send-renewal-reminder')
  @Roles(...AMC_MANAGEMENT_ROLES)
  @ApiOperation({ summary: 'Manually trigger the AMC_RENEWAL_REMINDER notification to the customer (no scheduler exists to auto-fire this 30 days before expiry)' })
  @ApiResponse({ status: 400, description: 'Contract is not ACTIVE' })
  async sendRenewalReminder(@Param('id', ParseUUIDPipe) id: string) {
    return this.amcService.sendRenewalReminder(id);
  }

  @Post('visits/:appointmentId/complete')
  @Roles(...AMC_TECHNICIAN_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'AmcVisitCompletion',
    getNewValues: (result: any) => ({ id: result?.id, appointmentId: result?.appointmentId, extraChargeAmount: result?.extraChargeAmount }),
  })
  @ApiOperation({ summary: 'Complete a PM visit - checklist notes, optional signature, optional extra charge (requires explicit customer approval)' })
  @ApiResponse({ status: 400, description: 'Not an AMC visit, already completed/cancelled, or an extra charge without customer approval' })
  async completeVisit(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: CompleteAmcVisitDto,
    @CurrentUser() user: User,
  ) {
    return this.amcService.completeVisit(appointmentId, dto, user.id);
  }

  @Get('visits/:appointmentId/completion')
  @Roles(...AMC_VIEW_ROLES)
  @ApiOperation({ summary: 'Get the completion record for a PM visit' })
  @ApiResponse({ status: 404, description: 'This visit has not been completed yet' })
  async getVisitCompletion(@Param('appointmentId', ParseUUIDPipe) appointmentId: string) {
    return this.amcService.getVisitCompletion(appointmentId);
  }

  @Post('contracts/:id/billing-invoices')
  @Roles(...FINANCE_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CREATE,
    entityType: 'AmcBillingInvoice',
    getNewValues: (result: any) => ({ id: result?.id, invoiceNumber: result?.invoiceNumber, amount: result?.amount }),
  })
  @ApiOperation({ summary: 'Generate a DRAFT billing invoice for one installment of a contract (amount split per paymentTerms: full/half-yearly/quarterly)' })
  @ApiResponse({ status: 400, description: 'Contract is not ACTIVE' })
  async generateBillingInvoice(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GenerateAmcBillingInvoiceDto) {
    return this.amcService.generateBillingInvoice(id, dto.periodLabel);
  }

  @Get('contracts/:id/billing-invoices')
  @Roles(...FINANCE_ROLES)
  @ApiOperation({ summary: 'List billing invoices generated for a contract' })
  async getBillingInvoices(@Param('id', ParseUUIDPipe) id: string) {
    return this.amcService.getBillingInvoicesForContract(id);
  }

  @Get('billing-invoices/:id')
  @Roles(...FINANCE_ROLES)
  @ApiOperation({ summary: 'Get one AMC billing invoice by id' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findBillingInvoiceById(@Param('id', ParseUUIDPipe) id: string) {
    return this.amcService.findBillingInvoiceById(id);
  }

  @Post('billing-invoices/:id/record-payment')
  @Roles(...FINANCE_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'AmcBillingInvoice',
    getEntityId: (req: any) => req.params.id,
    getNewValues: (result: any) => ({ status: result?.status, paymentMethod: result?.paymentMethod }),
  })
  @ApiOperation({ summary: 'Record full payment (Cash/Card/Bank Transfer/B2B Credit) against a DRAFT AMC billing invoice - full-amount-only, no partial payments' })
  @ApiResponse({ status: 400, description: 'Already paid or cancelled' })
  @ApiResponse({ status: 403, description: 'B2B Credit used against a non-B2B contract' })
  async recordBillingPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordAmcBillingPaymentDto,
    @CurrentUser() user: User,
  ) {
    return this.amcService.recordBillingPayment(id, dto.method, dto.reference, user.id);
  }
}
