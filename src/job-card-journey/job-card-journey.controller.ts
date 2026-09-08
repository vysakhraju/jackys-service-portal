import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { JobCardJourneyService } from './job-card-journey.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/**
 * Deliberately guarded with JwtAuthGuard ONLY - no @Roles(). This is a read-only,
 * cross-module traceability view: anyone already logged in (CCE, technician, Team
 * Leader, QC, delivery/invoicing staff) legitimately needs to be able to look up "where
 * is this job right now", and RolesGuard fails OPEN when no @Roles() decorator is
 * present (see roles.guard.ts) - so leaving it off is a deliberate choice, not an
 * oversight. Nothing here writes anything; every actual gate/guard for state changes
 * stays exactly where it already lives, in each feature module's own controller.
 */
@ApiTags('job-card-journey')
@ApiBearerAuth()
@Controller('job-card-journey')
@UseGuards(JwtAuthGuard)
export class JobCardJourneyController {
  constructor(private readonly journeyService: JobCardJourneyService) {}

  @Get('search')
  @ApiOperation({
    summary: 'Search for a Job Card by JC number, Appointment number, Delivery number, customer name or phone',
  })
  @ApiQuery({ name: 'q', required: true })
  search(@Query('q') q: string) {
    return this.journeyService.search(q ?? '');
  }

  @Get(':id')
  @ApiOperation({ summary: "Get a Job Card's full lifecycle journey - appointment through delivery, in one view" })
  @ApiParam({ name: 'id', description: 'Job Card id (uuid)' })
  getJourney(@Param('id', ParseUUIDPipe) id: string) {
    return this.journeyService.getJourney(id);
  }
}
