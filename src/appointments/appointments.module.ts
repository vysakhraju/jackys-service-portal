import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { Appointment } from './entities/appointment.entity';
import { ServiceCentre } from '../master-data/entities/service-centre.entity';
import { User } from '../auth/entities/user.entity';
import { AuditLog } from '../auth/entities/audit-log.entity';
import { JobCard } from '../job-cards/entities/job-card.entity';
import { MasterDataModule } from '../master-data/master-data.module';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [
    // JobCard is registered directly here (not by importing JobCardsModule) purely for
    // Mobile Phase 5's reassignment guardrail below - JobCardsModule already imports
    // AppointmentsModule, so importing it back here would be a circular module dependency.
    // Same entity-only-repo pattern TechnicianModule uses for the same reason.
    TypeOrmModule.forFeature([Appointment, ServiceCentre, User, AuditLog, JobCard]),
    MasterDataModule,
    AuthModule,
    // Mobile Phase 5: the reassignment guardrail in update() below calls
    // InventoryService.hasActiveReservationInCustody(). Safe to import directly -
    // InventoryModule has no dependency back on AppointmentsModule.
    InventoryModule,
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}