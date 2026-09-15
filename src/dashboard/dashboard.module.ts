import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { AuthModule } from '../auth/auth.module';
import { ReportsModule } from '../reports/reports.module';
import { TechnicianScheduleModule } from '../technician-schedule/technician-schedule.module';

// Brand-new top-level module (2026-09-15), imported by nothing else - same "avoid a
// circular import" reasoning as JobCardJourneyModule's own doc comment. No new tables, no
// new TypeOrmModule.forFeature() - every widget is a reshaped call into ReportsModule's
// (ReportsService/OperationalReportsService) or TechnicianScheduleModule's already-tested
// aggregation methods, and AuthModule supplies RolePermissionsService for the per-widget
// capability checks done inside DashboardService itself.
@Module({
  imports: [AuthModule, ReportsModule, TechnicianScheduleModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
