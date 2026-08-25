import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobCardsService } from './job-cards.service';
import { JobCardsController } from './job-cards.controller';
import { JobCard } from './entities/job-card.entity';
import { AppointmentsModule } from '../appointments/appointments.module';
import { TechnicianModule } from '../technician/technician.module';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([JobCard]),
    AppointmentsModule,
    TechnicianModule,
    // Needed because JobCardsController's @UseInterceptors(AuditInterceptor) resolves
    // AuditInterceptor -> AuthService, which AuthModule provides/exports.
    AuthModule,
    // Needed for JobCardsController.cancel() to orchestrate reservation cleanup after a
    // Job Card is cancelled. JobCardsService itself stays Inventory-unaware (pure entity
    // transitions) - the cross-module call lives at the controller layer.
    InventoryModule,
  ],
  controllers: [JobCardsController],
  providers: [JobCardsService],
  exports: [JobCardsService],
})
export class JobCardsModule {}
