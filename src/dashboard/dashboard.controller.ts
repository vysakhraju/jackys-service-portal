import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

// Deliberately JwtAuthGuard ONLY, no RolesGuard/@RequiresCapability class-level gate - every
// logged-in user lands on "/" (DashboardPage) and this is its one data call, so nobody can be
// locked out of their own landing page. Per-widget visibility is enforced server-side inside
// DashboardService.getOverview() instead - see that file's own doc comment.
@ApiTags('dashboard')
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('overview')
  @ApiOperation({
    summary:
      'Combined dashboard payload - each widget key present only if the caller holds that widget\'s DASHBOARD_WIDGET_* capability',
  })
  @ApiResponse({ status: 200, description: 'Dashboard overview' })
  getOverview(@CurrentUser() user: User) {
    return this.dashboardService.getOverview(user);
  }
}
