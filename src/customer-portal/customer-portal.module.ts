import { Module } from '@nestjs/common';
import { CustomerPortalService } from './customer-portal.service';
import { CustomerPortalController } from './customer-portal.controller';
import { JobCardsModule } from '../job-cards/job-cards.module';
import { EstimatesModule } from '../estimates/estimates.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { DeliveryModule } from '../delivery/delivery.module';

@Module({
  imports: [JobCardsModule, EstimatesModule, InvoicingModule, DeliveryModule],
  controllers: [CustomerPortalController],
  providers: [CustomerPortalService],
})
export class CustomerPortalModule {}
