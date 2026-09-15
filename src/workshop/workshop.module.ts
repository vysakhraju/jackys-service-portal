import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkshopService } from './workshop.service';
import { WorkshopController } from './workshop.controller';
import { JobCardsModule } from '../job-cards/job-cards.module';
import { InventoryModule } from '../inventory/inventory.module';
import { AuthModule } from '../auth/auth.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { User } from '../auth/entities/user.entity';

@Module({
  imports: [
    JobCardsModule,
    InventoryModule,
    // Needed because WorkshopController's @UseInterceptors(AuditInterceptor) resolves
    // AuditInterceptor -> AuthService, which AuthModule provides/exports. Also exports
    // RolePermissionsService, used by WorkshopController.resolveIsPrivileged() for the
    // WORKSHOP_ACTION_ANY_JOB capability check.
    AuthModule,
    // Phase 6: WorkshopService.requestSpare() calls
    // PermissionsService.requireActiveGrant() for the rework-approval gate.
    PermissionsModule,
    // Modification Request 2026-09-16: WorkshopService.getWorkshopState() looks up the
    // assigned technician's name for the "not your job" banner. A second, independent
    // registration of User in this module - JobCardsService.findById() (used broadly
    // elsewhere) deliberately does not eager-load this relation, so scoped the extra
    // fetch here instead of widening that shared method.
    TypeOrmModule.forFeature([User]),
  ],
  controllers: [WorkshopController],
  providers: [WorkshopService],
  exports: [WorkshopService],
})
export class WorkshopModule {}
