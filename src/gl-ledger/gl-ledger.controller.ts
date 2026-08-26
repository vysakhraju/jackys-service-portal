import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { GlLedgerService } from './gl-ledger.service';
import { GlSourceType } from './entities/gl-posting.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

const FINANCE_ROLES = ['ACCOUNTANT', 'FINANCE_MANAGER', 'SUPER_ADMIN', 'SERVICE_HEAD'];

@ApiTags('finance')
@Controller('gl-postings')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class GlLedgerController {
  constructor(private glLedgerService: GlLedgerService) {}

  @Get()
  @Roles(...FINANCE_ROLES)
  @ApiOperation({ summary: 'List GL postings (system-generated only - no manual entry endpoint exists)' })
  @ApiQuery({ name: 'sourceType', enum: GlSourceType, required: false })
  @ApiResponse({ status: 200, description: 'GL postings, newest first' })
  async findAll(@Query('sourceType') sourceType?: GlSourceType) {
    return this.glLedgerService.findAll(sourceType);
  }
}
