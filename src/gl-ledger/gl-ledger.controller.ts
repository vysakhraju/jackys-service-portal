import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { GlLedgerService } from './gl-ledger.service';
import { GlSourceType } from './entities/gl-posting.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiresCapability } from '../auth/decorators/requires-capability.decorator';

// Migrated onto the designation permission matrix (2026-09-10) as GL_LEDGER_VIEW - see
// capability-catalog.ts's "GL Ledger" section. Distinct key from debit-notes' own
// DEBIT_NOTES_MANAGE and AMC's AMC_BILLING - each finance-adjacent module gets its own
// capability, catalog keys must stay globally unique.

@ApiTags('finance')
@Controller('gl-postings')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class GlLedgerController {
  constructor(private glLedgerService: GlLedgerService) {}

  @Get()
  @RequiresCapability('GL_LEDGER_VIEW')
  @ApiOperation({ summary: 'List GL postings (system-generated only - no manual entry endpoint exists)' })
  @ApiQuery({ name: 'sourceType', enum: GlSourceType, required: false })
  @ApiResponse({ status: 200, description: 'GL postings, newest first' })
  async findAll(@Query('sourceType') sourceType?: GlSourceType) {
    return this.glLedgerService.findAll(sourceType);
  }
}
