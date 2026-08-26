import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoicingService } from './invoicing.service';
import { InvoicingController } from './invoicing.controller';
import { Invoice } from './entities/invoice.entity';
import { Payment } from './entities/payment.entity';
import { Estimate } from '../estimates/entities/estimate.entity';
import { JobCardsModule } from '../job-cards/job-cards.module';
import { AuthModule } from '../auth/auth.module';
import { GlLedgerModule } from '../gl-ledger/gl-ledger.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, Payment, Estimate]),
    // Needed for InvoicingService.getOrCreateForJobCard()/recordPayment() to look up the
    // Job Card (status/warranty/appointment.customerType) via JobCardsService.findById().
    JobCardsModule,
    // Needed because InvoicingController's @UseInterceptors(AuditInterceptor) resolves
    // AuditInterceptor -> AuthService, which AuthModule provides/exports.
    AuthModule,
    // Phase 8: every recorded payment posts a GL journal entry.
    GlLedgerModule,
  ],
  controllers: [InvoicingController],
  providers: [InvoicingService],
  exports: [InvoicingService],
})
export class InvoicingModule {}
