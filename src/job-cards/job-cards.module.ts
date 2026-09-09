import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobCardsService } from './job-cards.service';
import { JobCardsController } from './job-cards.controller';
import { JobCard } from './entities/job-card.entity';
import { JobCardTaskPause } from './entities/job-card-task-pause.entity';
import { JobCardCrewHelper } from './entities/job-card-crew-helper.entity';
import { User } from '../auth/entities/user.entity';
import { AppointmentsModule } from '../appointments/appointments.module';
import { TechnicianModule } from '../technician/technician.module';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [
    // JobCardCrewHelper: 2026-09-09 Gantt board "add crew helper" action. User: needed
    // directly here (rather than only through AuthModule) because
    // JobCardsService.addCrewHelper() injects the User repository itself to validate the
    // technician (existence + TECHNICIAN_WORKSHOP role) before writing the helper row.
    TypeOrmModule.forFeature([JobCard, JobCardTaskPause, JobCardCrewHelper, User]),
    AppointmentsModule,
    TechnicianModule,
    // Needed because JobCardsController's @UseInterceptors(AuditInterceptor) resolves
    // AuditInterceptor -> AuthService, which AuthModule provides/exports.
    AuthModule,
    // Needed for JobCardsController.cancel() to orchestrate reservation cleanup after a
    // Job Card is cancelled, and for qcApprove() to call
    // InventoryService.consumeReservationsOnQcApproval().
    InventoryModule,
    // Phase 6: JobCardsController's qc/approve and qc/reject endpoints both call
    // PermissionsService.requireActiveGrant() before doing anything else.
    PermissionsModule,
  ],
  controllers: [JobCardsController],
  providers: [JobCardsService],
  exports: [JobCardsService],
})
export class JobCardsModule {}
