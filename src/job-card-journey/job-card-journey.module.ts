import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobCard } from '../job-cards/entities/job-card.entity';
import { JobCardsModule } from '../job-cards/job-cards.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { TechnicianModule } from '../technician/technician.module';
import { InventoryModule } from '../inventory/inventory.module';
import { EstimatesModule } from '../estimates/estimates.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { AuthModule } from '../auth/auth.module';
import { JobCardJourneyService } from './job-card-journey.service';
import { JobCardJourneyController } from './job-card-journey.controller';

/**
 * Sits ABOVE every module a Job Card's lifecycle touches, imports all of them, and is
 * imported by none of them - see job-card-journey.service.ts's own doc comment for why
 * that direction matters (DeliveryModule/EstimatesModule/InvoicingModule/WorkshopModule
 * already import JobCardsModule, so bolting this onto JobCardsModule instead would risk
 * a real cycle). Read-only aggregator: nothing here should ever need to export anything
 * back down to the modules it depends on.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([JobCard]),
    JobCardsModule,
    AppointmentsModule,
    TechnicianModule,
    InventoryModule,
    EstimatesModule,
    InvoicingModule,
    DeliveryModule,
    AuthModule,
  ],
  controllers: [JobCardJourneyController],
  providers: [JobCardJourneyService],
})
export class JobCardJourneyModule {}
