import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoicingService } from './invoicing.service';
import { InvoicingController } from './invoicing.controller';
import { Invoice } from './entities/invoice.entity';
import { Estimate } from '../estimates/entities/estimate.entity';
import { JobCardsModule } from '../job-cards/job-cards.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, Estimate]),
    // Needed for InvoicingService.getOrCreateForJobCard()/recordPayment() to look up the
    // Job Card (status/warranty/appointment.customerType) via JobCardsService.findById().
    JobCardsModule,
    // Needed because InvoicingController's @UseInterceptors(AuditInterceptor) resolves
    // AuditInterceptor -> AuthService, which AuthModule provides/exports.
    AuthModule,
  ],
  controllers: [InvoicingController],
  providers: [InvoicingService],
  exports: [InvoicingService],
})
export class InvoicingModule {}
