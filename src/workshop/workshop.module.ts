import { Module } from '@nestjs/common';
import { WorkshopService } from './workshop.service';
import { WorkshopController } from './workshop.controller';
import { JobCardsModule } from '../job-cards/job-cards.module';
import { InventoryModule } from '../inventory/inventory.module';
import { AuthModule } from '../auth/auth.module';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [
    JobCardsModule,
    InventoryModule,
    // Needed because WorkshopController's @UseInterceptors(AuditInterceptor) resolves
    // AuditInterceptor -> AuthService, which AuthModule provides/exports.
    AuthModule,
    // Phase 6: WorkshopService.requestSpare() calls
    // PermissionsService.requireActiveGrant() for the rework-approval gate.
    PermissionsModule,
  ],
  controllers: [WorkshopController],
  providers: [WorkshopService],
  exports: [WorkshopService],
})
export class WorkshopModule {}
