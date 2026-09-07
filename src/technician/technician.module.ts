import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TechnicianService } from './technician.service';
import { TechnicianController } from './technician.controller';
import { TechnicianVisit } from './entities/technician-visit.entity';
import { JobCard } from '../job-cards/entities/job-card.entity';
import { AppointmentsModule } from '../appointments/appointments.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [
    // JobCard is registered directly here (not by importing JobCardsModule) purely for
    // Mobile Phase 5's need-spare/complete lookups - JobCardsModule already imports
    // TechnicianModule, so importing it back here would be a circular module dependency.
    // Same entity-only-repo pattern InventoryService's top-of-file comment documents for
    // AuthService's own JobCard/InventoryReservation access.
    TypeOrmModule.forFeature([TechnicianVisit, JobCard]),
    AppointmentsModule,
    MasterDataModule,
    // Needed because TechnicianController's @UseInterceptors(AuditInterceptor) resolves
    // AuditInterceptor -> AuthService, which AuthModule provides/exports.
    AuthModule,
    // Mobile Phase 5: Need Spare requests go straight to InventoryService. Safe to import
    // directly - InventoryModule has no dependency back on TechnicianModule.
    InventoryModule,
  ],
  controllers: [TechnicianController],
  providers: [TechnicianService],
  exports: [TechnicianService],
})
export class TechnicianModule {}
