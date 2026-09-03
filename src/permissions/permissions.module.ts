import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DiscoveryModule } from '@nestjs/core';
import { PermissionsService } from './permissions.service';
import { PermissionsController } from './permissions.controller';
import { RoleCapabilitiesService } from './role-capabilities.service';
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
    // AuditInterceptor -> AuthService, and now also RoleAccessService (extra role-access
    // grants), both of which AuthModule provides/exports.
    AuthModule,
    // Backs RoleCapabilitiesService's live route introspection for the role-access grant
    // preview - lets it enumerate every registered controller/route via the app's own
    // real metadata instead of a hand-maintained list.
    DiscoveryModule,
  ],
  controllers: [PermissionsController],
  providers: [PermissionsService, RoleCapabilitiesService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
