import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { AuthModule } from '../auth/auth.module';
import { ReportsModule } from '../reports/reports.module';
import { TechnicianScheduleModule } from '../technician-schedule/technician-schedule.module';
import { AmcModule } from '../amc/amc.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { InvoicingModule } from '../invoicing/invoicing.module';

// Brand-new top-level module (2026-09-15), imported by nothing else - same "avoid a
// circular import" reasoning as JobCardJourneyModule's own doc comment. No new tables, no
// new TypeOrmModule.forFeature() - every widget is a reshaped call into ReportsModule's
// (ReportsService/OperationalReportsService/FinanceReportsService), TechnicianScheduleModule's,
// AmcModule's, DeliveryModule's, or InvoicingModule's already-tested aggregation methods, and
// AuthModule supplies RolePermissionsService for the per-widget capability checks done inside
// DashboardService itself. AmcModule/DeliveryModule/InvoicingModule added 2026-09-16 for the
// second-round widgets - none of them import DashboardModule back, so no circularity risk.
@Module({
  imports: [AuthModule, ReportsModule, TechnicianScheduleModule, AmcModule, DeliveryModule, InvoicingModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
