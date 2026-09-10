import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { WarrantyClaimsService } from './warranty-claims.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiresCapability } from '../auth/decorators/requires-capability.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction } from '../auth/entities/audit-log.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';
import { WarrantyClaimStatus } from './entities/warranty-claim.entity';
import { AggregateWarrantyClaimDto } from './dto/aggregate-warranty-claim.dto';
import { SubmitWarrantyClaimDto } from './dto/submit-warranty-claim.dto';
import { RecordCreditNoteDto } from './dto/record-credit-note.dto';
import { CancelWarrantyClaimDto } from './dto/cancel-warranty-claim.dto';

// BRD Workflow 12 actors: "Warranty Clerk" generates/submits claims (12.1-12.3),
// "Accountant" records the vendor's credit note (12.4). SERVICE_HEAD/SUPER_ADMIN are
// given the clerk-level actions too, matching every other module's "a manager can also do
// what their team does" precedent (e.g. DismantlingController's HARVEST_ROLES including
// SERVICE_HEAD). FINANCE_MANAGER already carries 'manage:vendor-claims' per
// auth.service.ts's seedRoles(), so it's included alongside ACCOUNTANT for the
// credit-note step.
//
// CLERK_ROLES/VIEW_ROLES migrated onto the designation permission matrix (2026-09-10) as
// WARRANTY_CLAIMS_CLERK/WARRANTY_CLAIMS_VIEW - see capability-catalog.ts's "Warranty
// Claims" section, same membership.
//
// CREDIT_NOTE_ROLES was originally left un-migrated (2026-09-10): it was the only role-set
// in the app found missing SERVICE_HEAD while keeping SUPER_ADMIN, which the matrix's
// unconditional SUPER_ADMIN+SERVICE_HEAD bypass couldn't safely absorb without silently
// widening access. Business decision (2026-09-10, same day): SERVICE_HEAD should get this
// access too - recording a vendor credit note/posting the GL entry is now open to
// SERVICE_HEAD the same as every other action in this file. With that decision made the
// array is symmetric, so it's migrated onto the matrix as CREDIT_NOTE_POST below, same
// pattern as CLERK_ROLES/VIEW_ROLES.
const CLERK_ROLES = ['WARRANTY_CLERK', 'SERVICE_HEAD', 'SUPER_ADMIN'];
const VIEW_ROLES = ['WARRANTY_CLERK', 'ACCOUNTANT', 'FINANCE_MANAGER', 'SERVICE_HEAD', 'SUPER_ADMIN'];

@ApiTags('warranty-claims')
@Controller('warranty-claims')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class WarrantyClaimsController {
  constructor(private warrantyClaimsService: WarrantyClaimsService) {}

  @Post('aggregate')
  @RequiresCapability('WARRANTY_CLAIMS_CLERK')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CREATE,
    entityType: 'WarrantyClaim',
    getNewValues: (result: any) => ({ id: result?.id, claimNumber: result?.claimNumber, supplier: result?.supplier, totalClaimedAmount: result?.totalClaimedAmount }),
  })
  @ApiOperation({ summary: 'Group all unclaimed consumed warranty spares for a vendor/period into a new DRAFT claim (BRD 12.1)' })
  @ApiResponse({ status: 201, description: 'Claim created, DRAFT' })
  @ApiResponse({ status: 400, description: 'periodStart is after periodEnd, or nothing unclaimed was found for that vendor/period' })
  async aggregate(@Body() dto: AggregateWarrantyClaimDto, @CurrentUser() user: User) {
    return this.warrantyClaimsService.aggregate(dto, user.id);
  }

  @Get()
  @RequiresCapability('WARRANTY_CLAIMS_VIEW')
  @ApiQuery({ name: 'supplier', required: false })
  @ApiQuery({ name: 'status', enum: WarrantyClaimStatus, required: false })
  @ApiOperation({ summary: 'List warranty claims, optionally filtered by supplier and/or status' })
  async findAll(@Query('supplier') supplier?: string, @Query('status') status?: WarrantyClaimStatus) {
    return this.warrantyClaimsService.findAll({ supplier, status });
  }

  @Get('recovery-rate')
  @RequiresCapability('WARRANTY_CLAIMS_VIEW')
  @ApiQuery({ name: 'supplier', required: false })
  @ApiOperation({ summary: 'Recovery Rate = Amount Recovered / Total Warranty Spares Cost * 100 (BRD 12.5), optionally scoped to one vendor' })
  async recoveryRate(@Query('supplier') supplier?: string) {
    return this.warrantyClaimsService.recoveryRate({ supplier });
  }

  @Get(':id')
  @RequiresCapability('WARRANTY_CLAIMS_VIEW')
  @ApiOperation({ summary: 'Get one warranty claim with its line items' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.warrantyClaimsService.findById(id);
  }

  @Post(':id/submit')
  @RequiresCapability('WARRANTY_CLAIMS_CLERK')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'WarrantyClaim',
    getEntityId: (req: any) => req.params.id,
    getNewValues: (result: any) => ({ status: result?.status, claimReferenceNumber: result?.claimReferenceNumber }),
  })
  @ApiOperation({ summary: 'Record that the claim was uploaded to the vendor portal (BRD 12.3) - no real portal integration exists, this just flips status to SUBMITTED' })
  @ApiResponse({ status: 400, description: 'Claim is not DRAFT' })
  async submit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitWarrantyClaimDto, @CurrentUser() user: User) {
    return this.warrantyClaimsService.submit(id, dto, user.id);
  }

  @Post(':id/cancel')
  @RequiresCapability('WARRANTY_CLAIMS_CLERK')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CANCEL,
    entityType: 'WarrantyClaim',
    getEntityId: (req: any) => req.params.id,
    getNewValues: (result: any) => ({ status: result?.status, cancellationReason: result?.cancellationReason }),
  })
  @ApiOperation({ summary: 'Cancel a mistaken DRAFT claim - its lines are deleted so the reservations become claimable again' })
  @ApiResponse({ status: 400, description: 'Claim is not DRAFT' })
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelWarrantyClaimDto) {
    return this.warrantyClaimsService.cancel(id, dto);
  }

  @Post(':id/credit-note')
  @RequiresCapability('CREDIT_NOTE_POST')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'WarrantyClaim',
    getEntityId: (req: any) => req.params.id,
    getNewValues: (result: any) => ({ status: result?.status, creditNoteNumber: result?.creditNoteNumber, creditNoteAmount: result?.creditNoteAmount }),
  })
  @ApiOperation({ summary: "Record the vendor's credit note and post the GL entry: Debit Vendor Payable, Credit Warranty Recovery Account (BRD 12.4)" })
  @ApiResponse({ status: 400, description: 'Claim is not SUBMITTED' })
  async recordCreditNote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordCreditNoteDto, @CurrentUser() user: User) {
    return this.warrantyClaimsService.recordCreditNote(id, dto, user.id);
  }
}
