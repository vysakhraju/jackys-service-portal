import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RefreshStrategy } from './strategies/refresh.strategy';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { AuditLog } from './entities/audit-log.entity';
import { RolesGuard } from './guards/roles.guard';
import { RoleAccessService } from './role-access.service';
import { RoleAccessGrant } from './entities/role-access-grant.entity';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Appointment } from '../appointments/entities/appointment.entity';
import { JobCard } from '../job-cards/entities/job-card.entity';
import { InventoryReservation } from '../inventory/entities/inventory-reservation.entity';

@Module({
  imports: [
    // Appointment/JobCard/InventoryReservation are registered here (not by importing
    // their owning modules) purely for the deactivateUser() custody-clearance check
    // below - avoids a circular module dependency, since AppointmentsModule/JobCardsModule
    // both already import AuthModule for AuditInterceptor.
    // RoleAccessGrant lives here (not in permissions/, where UserPermissionGrant lives)
    // specifically so RolesGuard - a provider of THIS module, used via @UseGuards(RolesGuard)
    // by nearly every controller in the app - can inject RoleAccessService without every
    // one of those controllers' modules needing to import a separate module for it. Every
    // module that already imports AuthModule (virtually all of them, for AuditInterceptor)
    // gets this for free.
    TypeOrmModule.forFeature([User, Role, AuditLog, Appointment, JobCard, InventoryReservation, RoleAccessGrant]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET') || 'your-super-secret-jwt-key-change-in-production',
        signOptions: {
          expiresIn: configService.get('JWT_ACCESS_EXPIRES_IN') || '15m',
          // HS256 matches the plain-string secrets in .env (JWT_SECRET/JWT_REFRESH_SECRET).
          // Upgrading to RS256 requires generating and configuring an RSA key pair — tracked
          // as a production-hardening follow-up, not needed for MVP correctness.
          algorithm: 'HS256',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    RefreshStrategy,
    RolesGuard,
    RoleAccessService,
    AuditInterceptor,
  ],
  exports: [AuthService, JwtModule, RolesGuard, RoleAccessService, AuditInterceptor],
})
export class AuthModule {}