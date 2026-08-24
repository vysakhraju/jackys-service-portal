import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EstimatesService } from './estimates.service';
import { EstimatesController, EstimatesPublicController } from './estimates.controller';
import { Estimate } from './entities/estimate.entity';
import { JobCardsModule } from '../job-cards/job-cards.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Estimate]),
    JobCardsModule,
    NotificationsModule,
    // Needed because EstimatesController/EstimatesPublicController's
    // @UseInterceptors(AuditInterceptor) resolves AuditInterceptor -> AuthService, which
    // AuthModule provides/exports.
    AuthModule,
  ],
  controllers: [EstimatesController, EstimatesPublicController],
  providers: [EstimatesService],
  exports: [EstimatesService],
})
export class EstimatesModule {}
