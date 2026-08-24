import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { User } from './entities/user.entity';
import { UserStatus } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { AuditLog } from './entities/audit-log.entity';
import { AuditAction } from './entities/audit-log.entity';
import { LoginDto } from './dto/login.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  user: Partial<User>;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async validateUser(email: string, password: string): Promise<User | null> {
    // passwordHash has `select: false` on the entity, so it must be explicitly
    // re-selected here - plain findOne() silently omits it, which previously made
    // every login attempt crash with "Illegal arguments: string, undefined" in bcrypt.
    const user = await this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();

    if (!user) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return null;
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }

    return user;
  }

  async login(loginDto: LoginDto, req: any): Promise<TokenPair> {
    const user = await this.validateUser(loginDto.email, loginDto.password);
    if (!user) {
      await this.logAudit(
        null,
        AuditAction.LOGIN,
        'User',
        null,
        null,
        { email: loginDto.email, reason: 'invalid_credentials' },
        req,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(user);
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    await this.logAudit(
      user,
      AuditAction.LOGIN,
      'User',
      user.id,
      null,
      { loginMethod: 'password' },
      req,
    );

    return {
      ...tokens,
      user: this.sanitizeUser(user),
    };
  }

  /**
   * `user` here is the User already resolved and validated by RefreshAuthGuard/RefreshStrategy,
   * which compares the presented refresh token against the stored bcrypt hash. We do not
   * re-look-up by hash here since refreshTokenHash is a salted bcrypt digest, not a lookup key.
   */
  async refreshTokens(user: User, req: any): Promise<TokenPair> {
    const tokens = await this.generateTokens(user);
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    return {
      ...tokens,
      user: this.sanitizeUser(user),
    };
  }

  async logout(userId: string, req: any): Promise<void> {
    await this.userRepository.update(userId, { refreshTokenHash: '' });

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (user) {
      await this.logAudit(
        user,
        AuditAction.LOGOUT,
        'User',
        userId,
        null,
        null,
        req,
      );
    }
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string, req: any): Promise<void> {
    // Same select:false issue as validateUser() - re-select passwordHash explicitly.
    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id: userId })
      .getOne();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isPasswordValid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.userRepository.update(userId, { passwordHash });

    await this.logAudit(
      user,
      AuditAction.PASSWORD_CHANGE,
      'User',
      userId,
      null,
      { changedBy: 'user' },
      req,
    );
  }

  async createUser(userData: Partial<User>, roleName: string, req: any): Promise<User> {
    const existingUser = await this.userRepository.findOne({
      where: [{ email: userData.email }, { employeeId: userData.employeeId }],
    });

    if (existingUser) {
      throw new ConflictException('User with this email or employee ID already exists');
    }

    const role = await this.roleRepository.findOne({ where: { name: roleName as any } });
    if (!role) {
      throw new NotFoundException(`Role ${roleName} not found`);
    }

    const passwordHash = await bcrypt.hash(userData.passwordHash || 'TempPass123!', 12);

    const user = this.userRepository.create({
      ...userData,
      passwordHash,
      roleId: role.id,
      role,
    });

    await this.userRepository.save(user);

    await this.logAudit(
      user,
      AuditAction.CREATE,
      'User',
      user.id,
      null,
      { createdBy: req.user?.id },
      req,
    );

    return user;
  }

  async seedRoles(): Promise<void> {
    const roles: Array<Partial<Role>> = [
      { name: 'SUPER_ADMIN' as any, displayName: 'Super Admin', description: 'Full system access', permissions: ['*'], isSystem: true },
      { name: 'SERVICE_HEAD' as any, displayName: 'Service Head', description: 'Service department head', permissions: ['manage:all', 'view:reports', 'manage:amc', 'manage:dismantling'], isSystem: true },
      { name: 'TECHNICAL_TEAM_LEADER' as any, displayName: 'Technical Team Leader', description: 'Team leader for technicians', permissions: ['manage:spare-validation', 'warranty:override', 'assign:jobs', 'manage:qc', 'view:team'], isSystem: true },
      { name: 'CCE' as any, displayName: 'Customer Care Executive', description: 'Customer care executive', permissions: ['manage:appointments', 'manage:job-cards', 'manage:estimates', 'manage:invoices', 'manage:customers', 'view:reports'], isSystem: true },
      { name: 'TECHNICIAN_FIELD' as any, displayName: 'Field Technician', description: 'Field service technician', permissions: ['view:assigned-jobs', 'update:job-status', 'request:spares', 'complete:repair', 'capture:pod'], isSystem: true },
      { name: 'TECHNICIAN_WORKSHOP' as any, displayName: 'Workshop Technician', description: 'Workshop technician', permissions: ['view:assigned-jobs', 'update:job-status', 'log:spares', 'complete:repair', 'mark:qc'], isSystem: true },
      { name: 'QC_OFFICER' as any, displayName: 'QC Officer', description: 'Quality control officer', permissions: ['manage:qc', 'view:workshop-jobs'], isSystem: true },
      { name: 'ACCOUNTANT' as any, displayName: 'Accountant', description: 'Finance accountant', permissions: ['manage:invoices', 'manage:payments', 'manage:gl', 'view:reports'], isSystem: true },
      { name: 'FINANCE_MANAGER' as any, displayName: 'Finance Manager', description: 'Finance department manager', permissions: ['manage:all-finance', 'manage:interdept', 'view:reports', 'manage:vendor-claims'], isSystem: true },
      { name: 'LOGISTICS_DISPATCHER' as any, displayName: 'Logistics Dispatcher', description: 'Logistics dispatcher', permissions: ['manage:delivery', 'manage:batch', 'view:ready-jobs'], isSystem: true },
      { name: 'DRIVER' as any, displayName: 'Delivery Driver', description: 'Delivery driver', permissions: ['view:deliveries', 'capture:pod', 'update:delivery-status'], isSystem: true },
      { name: 'WAREHOUSE_CLERK' as any, displayName: 'Warehouse Clerk', description: 'Warehouse inventory clerk', permissions: ['manage:grn', 'manage:van-stock', 'view:inventory'], isSystem: true },
      { name: 'WARRANTY_CLERK' as any, displayName: 'Warranty Clerk', description: 'Warranty claims clerk', permissions: ['manage:warranty-claims', 'view:vendor-claims'], isSystem: true },
      { name: 'CUSTOMER' as any, displayName: 'Customer', description: 'End customer portal access', permissions: ['view:own-jobs', 'approve:estimates', 'pay:invoices', 'download:documents'], isSystem: true },
    ];

    for (const roleData of roles) {
      const existing = await this.roleRepository.findOne({ where: { name: roleData.name as any } });
      if (!existing) {
        const role = this.roleRepository.create(roleData as any);
        await this.roleRepository.save(role);
      }
    }
  }

  private async generateTokens(user: User): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = {
      sub: user.id,
      email: user.email,
      roleId: user.roleId,
      roleName: user.role.name,
      permissions: user.role.permissions,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get('JWT_ACCESS_EXPIRES_IN') || '15m',
      algorithm: 'HS256',
    });

    const refreshToken = this.jwtService.sign(
      { ...payload, type: 'refresh' },
      {
        secret: this.configService.get('JWT_REFRESH_SECRET') || 'your-super-secret-refresh-key-change-in-production',
        expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN') || '7d',
        algorithm: 'HS256',
      },
    );

    return { accessToken, refreshToken };
  }

  private async updateRefreshToken(userId: string, refreshToken: string): Promise<void> {
    const refreshTokenHash = await bcrypt.hash(refreshToken, 12);
    await this.userRepository.update(userId, { refreshTokenHash, lastLoginAt: new Date() });
  }

  private sanitizeUser(user: User): Partial<User> {
    const { passwordHash, refreshTokenHash, ...sanitized } = user;
    return sanitized;
  }

  async logAudit(
    user: User | null,
    action: AuditAction,
    entityType: string,
    entityId: string | null,
    oldValues: Record<string, any> | null,
    newValues: Record<string, any> | null,
    req: any,
  ): Promise<void> {
    try {
      const auditLog = this.auditLogRepository.create({
        action: action as any,
        entityType,
        entityId,
        oldValues,
        newValues,
        userId: user?.id,
        ipAddress: req?.ip || req?.connection?.remoteAddress,
        userAgent: req?.headers?.['user-agent'],
        metadata: {
          method: req?.method,
          url: req?.url,
        },
      });

      await this.auditLogRepository.save(auditLog);
    } catch (error) {
      console.error('Audit log failed:', error);
    }
  }
}