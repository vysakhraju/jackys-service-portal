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
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role, AuditLog]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET') || 'your-super-secret-jwt-key-change-in-production',
        signOptions: {
          expiresIn: configService.get('JWT_ACCESS_EXPIRES_IN') || '15m',
          algorithm: 'RS256',
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
    AuditInterceptor,
  ],
  exports: [AuthService, JwtModule, RolesGuard, AuditInterceptor],
})
export class AuthModule {}