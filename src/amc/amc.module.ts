import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AmcService } from './amc.service';
import { AmcController } from './amc.controller';
import { AmcContract } from './entities/amc-contract.entity';
import { AmcVisitCompletion } from './entities/amc-visit-completion.entity';
import { AmcBillingInvoice } from './entities/amc-billing-invoice.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { ServiceCentre } from '../master-data/entities/service-centre.entity';
import { Estimate } from '../estimates/entities/estimate.entity';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AmcContract, AmcVisitCompletion, AmcBillingInvoice, Appointment, ServiceCentre, Estimate]),
    AuthModule,
    NotificationsModule,
  ],
  controllers: [AmcController],
  providers: [AmcService],
  exports: [AmcService],
})
export class AmcModule {}
