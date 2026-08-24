import { UnauthorizedException, NotFoundException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { User, UserStatus } from './entities/user.entity';
import { AuditAction } from './entities/audit-log.entity';

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let userRepository: any;
  let roleRepository: any;
  let auditLogRepository: any;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;

  const buildQueryBuilder = (result: any) => ({
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result),
  });

  const baseUser = (): User =>
    ({
      id: 'user-1',
      email: 'admin@jackys.com',
      passwordHash: 'hashed-password',
      status: UserStatus.ACTIVE,
      roleId: 'role-1',
      role: { id: 'role-1', name: 'SUPER_ADMIN', permissions: ['*'] },
      refreshTokenHash: 'old-refresh-hash',
    } as unknown as User);

  beforeEach(() => {
    userRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve({ ...data, id: data.id || 'new-user-id' })),
    };
    roleRepository = {
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve(data)),
    };
    auditLogRepository = {
      create: jest.fn((data) => data),
      save: jest.fn().mockResolvedValue(undefined),
    };
    jwtService = { sign: jest.fn() } as any;
    configService = { get: jest.fn() } as any;

    service = new AuthService(
      userRepository,
      roleRepository,
      auditLogRepository,
      jwtService,
      configService,
    );

    jest.clearAllMocks();
    (bcrypt.compare as jest.Mock).mockReset();
    (bcrypt.hash as jest.Mock).mockReset();
  });

  describe('validateUser', () => {
    it('returns the user when email and password are valid', async () => {
      const user = baseUser();
      const qb = buildQueryBuilder(user);
      userRepository.createQueryBuilder.mockReturnValue(qb);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('admin@jackys.com', 'Admin123!');

      expect(result).toEqual(user);
      expect(qb.addSelect).toHaveBeenCalledWith('user.passwordHash');
      expect(bcrypt.compare).toHaveBeenCalledWith('Admin123!', 'hashed-password');
    });

    it('returns null when no user matches the email', async () => {
      const qb = buildQueryBuilder(null);
      userRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.validateUser('nobody@jackys.com', 'whatever');

      expect(result).toBeNull();
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('returns null when the password does not match', async () => {
      const qb = buildQueryBuilder(baseUser());
      userRepository.createQueryBuilder.mockReturnValue(qb);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser('admin@jackys.com', 'WrongPass!');

      expect(result).toBeNull();
    });

    it('throws UnauthorizedException when the account is not active', async () => {
      const user = { ...baseUser(), status: UserStatus.SUSPENDED };
      const qb = buildQueryBuilder(user);
      userRepository.createQueryBuilder.mockReturnValue(qb);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.validateUser('admin@jackys.com', 'Admin123!')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('login', () => {
    it('returns tokens and a sanitized user on success', async () => {
      const user = baseUser();
      const qb = buildQueryBuilder(user);
      userRepository.createQueryBuilder.mockReturnValue(qb);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-refresh-hash');
      jwtService.sign.mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');

      const result = await service.login(
        { email: 'admin@jackys.com', password: 'Admin123!' } as any,
        { ip: '127.0.0.1', headers: {} },
      );

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user).not.toHaveProperty('refreshTokenHash');
      expect(userRepository.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ refreshTokenHash: 'new-refresh-hash' }),
      );
      expect(auditLogRepository.save).toHaveBeenCalled();
    });

    it('throws UnauthorizedException and logs a failed attempt for invalid credentials', async () => {
      const qb = buildQueryBuilder(null);
      userRepository.createQueryBuilder.mockReturnValue(qb);

      await expect(
        service.login({ email: 'nobody@jackys.com', password: 'x' } as any, { headers: {} }),
      ).rejects.toThrow(UnauthorizedException);

      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.LOGIN }),
      );
      expect(auditLogRepository.save).toHaveBeenCalled();
    });

    it('signs the access token as HS256 with the configured expiry', async () => {
      const user = baseUser();
      const qb = buildQueryBuilder(user);
      userRepository.createQueryBuilder.mockReturnValue(qb);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hash');
      configService.get.mockImplementation((key: string) =>
        key === 'JWT_ACCESS_EXPIRES_IN' ? '15m' : undefined,
      );

      await service.login({ email: 'admin@jackys.com', password: 'Admin123!' } as any, { headers: {} });

      expect(jwtService.sign).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ sub: 'user-1' }),
        expect.objectContaining({ algorithm: 'HS256', expiresIn: '15m' }),
      );
    });

    it('signs the refresh token with the refresh secret, not the access secret', async () => {
      const user = baseUser();
      const qb = buildQueryBuilder(user);
      userRepository.createQueryBuilder.mockReturnValue(qb);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hash');
      configService.get.mockImplementation((key: string) =>
        key === 'JWT_REFRESH_SECRET' ? 'refresh-secret' : undefined,
      );

      await service.login({ email: 'admin@jackys.com', password: 'Admin123!' } as any, { headers: {} });

      expect(jwtService.sign).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ type: 'refresh' }),
        expect.objectContaining({ algorithm: 'HS256', secret: 'refresh-secret' }),
      );
    });
  });

  describe('refreshTokens', () => {
    it('issues a new token pair for an already-validated user', async () => {
      const user = baseUser();
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-refresh-hash');
      jwtService.sign.mockReturnValueOnce('new-access').mockReturnValueOnce('new-refresh');

      const result = await service.refreshTokens(user, { headers: {} });

      expect(result.accessToken).toBe('new-access');
      expect(result.refreshToken).toBe('new-refresh');
      expect(userRepository.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ refreshTokenHash: 'new-refresh-hash' }),
      );
    });
  });

  describe('logout', () => {
    it('clears the stored refresh token hash and logs the action', async () => {
      userRepository.findOne.mockResolvedValue(baseUser());

      await service.logout('user-1', { headers: {} });

      expect(userRepository.update).toHaveBeenCalledWith('user-1', { refreshTokenHash: '' });
      expect(auditLogRepository.save).toHaveBeenCalled();
    });

    it('does not throw when the user no longer exists', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.logout('missing-user', { headers: {} })).resolves.toBeUndefined();
      expect(auditLogRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('updates the password when the old password is correct', async () => {
      const qb = buildQueryBuilder(baseUser());
      userRepository.createQueryBuilder.mockReturnValue(qb);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');

      await service.changePassword('user-1', 'OldPass1!', 'NewPass1!', { headers: {} });

      expect(bcrypt.hash).toHaveBeenCalledWith('NewPass1!', 12);
      expect(userRepository.update).toHaveBeenCalledWith('user-1', { passwordHash: 'new-hash' });
      expect(auditLogRepository.save).toHaveBeenCalled();
    });

    it('throws NotFoundException when the user does not exist', async () => {
      const qb = buildQueryBuilder(null);
      userRepository.createQueryBuilder.mockReturnValue(qb);

      await expect(
        service.changePassword('missing', 'a', 'b', { headers: {} }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws UnauthorizedException when the old password is wrong', async () => {
      const qb = buildQueryBuilder(baseUser());
      userRepository.createQueryBuilder.mockReturnValue(qb);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword('user-1', 'WrongOld!', 'NewPass1!', { headers: {} }),
      ).rejects.toThrow(UnauthorizedException);
      expect(userRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('createUser', () => {
    it('creates a user for a valid, unused email/employeeId and role', async () => {
      userRepository.findOne.mockResolvedValue(null);
      roleRepository.findOne.mockResolvedValue({ id: 'role-2', name: 'CCE' });
      (bcrypt.hash as jest.Mock).mockResolvedValue('temp-hash');

      const result = await service.createUser(
        { email: 'new@jackys.com', employeeId: 'E-1' } as any,
        'CCE',
        { user: { id: 'admin-1' } },
      );

      expect(result).toEqual(
        expect.objectContaining({ email: 'new@jackys.com', roleId: 'role-2', passwordHash: 'temp-hash' }),
      );
      expect(auditLogRepository.save).toHaveBeenCalled();
    });

    it('throws ConflictException when the email or employee ID is already taken', async () => {
      userRepository.findOne.mockResolvedValue(baseUser());

      await expect(
        service.createUser({ email: 'admin@jackys.com' } as any, 'CCE', { user: {} }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when the requested role does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);
      roleRepository.findOne.mockResolvedValue(null);

      await expect(
        service.createUser({ email: 'new@jackys.com' } as any, 'NOT_A_ROLE', { user: {} }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('seedRoles', () => {
    it('creates only the roles that do not already exist', async () => {
      roleRepository.findOne.mockImplementation(({ where }: any) =>
        Promise.resolve(where.name === 'SUPER_ADMIN' ? { id: 'existing' } : null),
      );

      await service.seedRoles();

      // 14 roles are defined; SUPER_ADMIN already exists so 13 get created.
      expect(roleRepository.save).toHaveBeenCalledTimes(13);
    });
  });

  describe('logAudit', () => {
    it('swallows errors so audit failures never break the calling flow', async () => {
      auditLogRepository.save.mockRejectedValue(new Error('db down'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        service.logAudit(null, AuditAction.LOGIN, 'User', null, null, null, { headers: {} }),
      ).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
