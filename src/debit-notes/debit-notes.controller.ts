import { Controller, Get, Post, Param, UseGuards, UseInterceptors, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { DebitNotesService } from './debit-notes.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiresCapability } from '../auth/decorators/requires-capability.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction } from '../auth/entities/audit-log.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

// Migrated onto the designation permission matrix (2026-09-10) as DEBIT_NOTES_MANAGE - see
// capability-catalog.ts's "Debit Notes" section. Includes the GL-posting action (post()) -
// unlike Warranty Claims' credit-note posting, this role set is symmetric on
// SUPER_ADMIN/SERVICE_HEAD, so migrating it is a zero-behavior-change move.

@ApiTags('finance')
@Controller('debit-notes')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class DebitNotesController {
  constructor(private debitNotesService: DebitNotesService) {}

  @Get('job-card/:jobCardId')
  @RequiresCapability('DEBIT_NOTES_MANAGE')
  @ApiOperation({ summary: 'FR-15/AC-15: get (lazily creating a DRAFT if none exists yet) the Debit Note for an interdepartment (B2B_SALES_CHANNEL, in-warranty), QC_PASSED Job Card' })
  @ApiResponse({ status: 200, description: 'The Debit Note (existing or newly drafted)' })
  @ApiResponse({ status: 400, description: 'Job Card is not QC_PASSED, is out-of-warranty, or is not a B2B_SALES_CHANNEL appointment' })
  async getForJobCard(@Param('jobCardId', ParseUUIDPipe) jobCardId: string) {
    return this.debitNotesService.getOrCreateForJobCard(jobCardId);
  }

  @Get('recharge-report')
  @RequiresCapability('DEBIT_NOTES_MANAGE')
  @ApiOperation({ summary: 'AC-16: interdepartment recharge report - posted vs draft counts and totals' })
  @ApiResponse({ status: 200, description: 'Recharge summary' })
  async getRechargeReport() {
    return this.debitNotesService.getRechargeReport();
  }

  @Get()
  @RequiresCapability('DEBIT_NOTES_MANAGE')
  @ApiOperation({ summary: 'List all Debit Notes, newest first' })
  @ApiResponse({ status: 200, description: 'Debit Notes' })
  async findAll() {
    return this.debitNotesService.findAll();
  }

  @Get(':id')
  @RequiresCapability('DEBIT_NOTES_MANAGE')
  @ApiOperation({ summary: 'Get one Debit Note by id' })
  @ApiResponse({ status: 200, description: 'The Debit Note' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.debitNotesService.findById(id);
  }

  @Post(':id/post')
  @RequiresCapability('DEBIT_NOTES_MANAGE')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'DebitNote',
    getEntityId: (req) => req.params.id,
    getNewValues: (result) => ({ id: result?.id, status: result?.status, totalAmount: result?.totalAmount }),
  })
  @ApiOperation({ summary: 'Post a DRAFT Debit Note - generates its GL journal entry. Terminal (cannot be un-posted).' })
  @ApiResponse({ status: 200, description: 'Debit Note is now POSTED' })
  @ApiResponse({ status: 400, description: 'Already posted' })
  async post(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.debitNotesService.post(id, user.id);
  }
}
