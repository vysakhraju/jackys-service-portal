import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsService } from './permissions.service';
import { PermissionsController } from './permissions.controller';
import { UserPermissionGrant } from './entities/user-permission-grant.entity';
import { User } from '../auth/entities/user.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    // User is registered directly here (not by importing AuthModule's own forFeature)
    // purely for the grant() existence check - same pattern InventoryModule uses for
    // SparePart and AuthModule uses for JobCard/InventoryReservation: avoids a module
    // dependency for what's really just an entity relation.
    TypeOrmModule.forFeature([UserPermissionGrant, User]),
    // Needed because PermissionsController's @UseInterceptors(AuditInterceptor) resolves
    // AuditInterceptor -> AuthService, which AuthModule provides/exports.
    AuthModule,
  ],
  controllers: [PermissionsController],
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
