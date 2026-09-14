import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeliveryService } from './delivery.service';
import { DeliveryController } from './delivery.controller';
import { Delivery } from './entities/delivery.entity';
import { User } from '../auth/entities/user.entity';
import { JobCardsModule } from '../job-cards/job-cards.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    // User added #218 (2026-09-10) for listActiveDrivers()/dispatch()'s role check.
    TypeOrmModule.forFeature([Delivery, User]),
    // Needed for the ready-pool/lookup reads (JobCardsService.findReadyForDelivery,
    // findByDeliveryId, findById) - the actual atomic claim/release mutations in
    // create()/capturePod()/cancel() reach past this into the JobCard entity directly via
    // a transactional EntityManager instead (see delivery.service.ts's doc comments).
    JobCardsModule,
    // Needed for the FR-12/AC-11 OOW-paid gate (InvoicingService.isPayableForDelivery).
    InvoicingModule,
    // Needed because DeliveryController's @UseInterceptors(AuditInterceptor) resolves
    // AuditInterceptor -> AuthService, which AuthModule provides/exports.
    AuthModule,
  ],
  controllers: [DeliveryController],
  providers: [DeliveryService],
  exports: [DeliveryService],
})
export class DeliveryModule {}
