import { Controller, Get, Post, Param, UseGuards, UseInterceptors, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { DebitNotesService } from './debit-notes.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction } from '../auth/entities/audit-log.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

const FINANCE_ROLES = ['ACCOUNTANT', 'FINANCE_MANAGER', 'SUPER_ADMIN', 'SERVICE_HEAD'];

@ApiTags('finance')
@Controller('debit-notes')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class DebitNotesController {
  constructor(private debitNotesService: DebitNotesService) {}

  @Get('job-card/:jobCardId')
  @Roles(...FINANCE_ROLES)
  @ApiOperation({ summary: 'FR-15/AC-15: get (lazily creating a DRAFT if none exists yet) the Debit Note for an interdepartment (B2B_SALES_CHANNEL, in-warranty), QC_PASSED Job Card' })
  @ApiResponse({ status: 200, description: 'The Debit Note (existing or newly drafted)' })
  @ApiResponse({ status: 400, description: 'Job Card is not QC_PASSED, is out-of-warranty, or is not a B2B_SALES_CHANNEL appointment' })
  async getForJobCard(@Param('jobCardId', ParseUUIDPipe) jobCardId: string) {
    return this.debitNotesService.getOrCreateForJobCard(jobCardId);
  }

  @Get('recharge-report')
  @Roles(...FINANCE_ROLES)
  @ApiOperation({ summary: 'AC-16: interdepartment recharge report - posted vs draft counts and totals' })
  @ApiResponse({ status: 200, description: 'Recharge summary' })
  async getRechargeReport() {
    return this.debitNotesService.getRechargeReport();
  }

  @Get()
  @Roles(...FINANCE_ROLES)
  @ApiOperation({ summary: 'List all Debit Notes, newest first' })
  @ApiResponse({ status: 200, description: 'Debit Notes' })
  async findAll() {
    return this.debitNotesService.findAll();
  }

  @Get(':id')
  @Roles(...FINANCE_ROLES)
  @ApiOperation({ summary: 'Get one Debit Note by id' })
  @ApiResponse({ status: 200, description: 'The Debit Note' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.debitNotesService.findById(id);
  }

  @Post(':id/post')
  @Roles(...FINANCE_ROLES)
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
