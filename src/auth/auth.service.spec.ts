import { UnauthorizedException, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
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
  let appointmentRepository: any;
  let jobCardRepository: any;
  let inventoryReservationRepository: any;
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
      find: jest.fn(),
      update: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve({ ...data, id: data.id || 'new-user-id' })),
    };
    roleRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve(data)),
    };
    auditLogRepository = {
      create: jest.fn((data) => data),
      save: jest.fn().mockResolvedValue(undefined),
    };
    appointmentRepository = { find: jest.fn().mockResolvedValue([]) };
    jobCardRepository = { find: jest.fn().mockResolvedValue([]) };
    inventoryReservationRepository = { find: jest.fn().mockResolvedValue([]) };
    jwtService = { sign: jest.fn() } as any;
    configService = { get: jest.fn() } as any;

    service = new AuthService(
      userRepository,
      roleRepository,
      auditLogRepository,
      appointmentRepository,
      jobCardRepository,
      inventoryReservationRepository,
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

  describe('deactivateUser', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.deactivateUser('missing-user')).rejects.toThrow(NotFoundException);
      expect(appointmentRepository.find).not.toHaveBeenCalled();
    });

    it('deactivates a user with no open appointments, jobs, or reservations', async () => {
      const user = { id: 'tech-1', email: 'tech@jackys.com', status: UserStatus.ACTIVE } as User;
      userRepository.findOne.mockResolvedValue(user);
      appointmentRepository.find.mockResolvedValue([]);
      jobCardRepository.find.mockResolvedValue([]);
      inventoryReservationRepository.find.mockResolvedValue([]);

      const result = await service.deactivateUser('tech-1');

      expect(result.status).toBe(UserStatus.INACTIVE);
      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tech-1', status: UserStatus.INACTIVE }),
      );
    });

    it('blocks deactivation when the technician has an open field appointment', async () => {
      const user = { id: 'tech-1', email: 'tech@jackys.com', status: UserStatus.ACTIVE } as User;
      userRepository.findOne.mockResolvedValue(user);
      appointmentRepository.find.mockResolvedValue([{ id: 'appt-1', status: 'SCHEDULED' }]);
      jobCardRepository.find.mockResolvedValue([]);
      inventoryReservationRepository.find.mockResolvedValue([]);

      await expect(service.deactivateUser('tech-1')).rejects.toThrow(ConflictException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('blocks deactivation when the technician has an open workshop job card', async () => {
      const user = { id: 'tech-2', email: 'wtech@jackys.com', status: UserStatus.ACTIVE } as User;
      userRepository.findOne.mockResolvedValue(user);
      appointmentRepository.find.mockResolvedValue([]);
      jobCardRepository.find.mockResolvedValue([{ id: 'jc-1', jobCardNumber: 'JC-1001', status: 'IN_PROGRESS' }]);
      inventoryReservationRepository.find.mockResolvedValue([]);

      await expect(service.deactivateUser('tech-2')).rejects.toThrow(ConflictException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('blocks deactivation when the technician still has spares in custody', async () => {
      const user = { id: 'tech-3', email: 'wtech3@jackys.com', status: UserStatus.ACTIVE } as User;
      userRepository.findOne.mockResolvedValue(user);
      appointmentRepository.find.mockResolvedValue([]);
      jobCardRepository.find.mockResolvedValue([]);
      inventoryReservationRepository.find.mockResolvedValue([
        { id: 'res-1', quantityReserved: 2, status: 'HELD' },
      ]);

      await expect(service.deactivateUser('tech-3')).rejects.toThrow(ConflictException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('collects every blocker at once rather than stopping at the first', async () => {
      const user = { id: 'tech-4', email: 'busy@jackys.com', status: UserStatus.ACTIVE } as User;
      userRepository.findOne.mockResolvedValue(user);
      appointmentRepository.find.mockResolvedValue([{ id: 'appt-1', status: 'ON_SITE' }]);
      jobCardRepository.find.mockResolvedValue([{ id: 'jc-1', jobCardNumber: 'JC-1002', status: 'SPARE_PENDING' }]);
      inventoryReservationRepository.find.mockResolvedValue([
        { id: 'res-1', quantityReserved: 1, status: 'PARTIALLY_RESERVED' },
      ]);

      try {
        await service.deactivateUser('tech-4');
        fail('expected deactivateUser to throw');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ConflictException);
        const response = err.getResponse();
        expect(response.blockers).toHaveLength(3);
        expect(response.blockers.join(' ')).toContain('appt-1');
        expect(response.blockers.join(' ')).toContain('JC-1002');
        expect(response.blockers.join(' ')).toContain('res-1');
      }
      expect(userRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('reactivateUser', () => {
    it('flips an INACTIVE user back to ACTIVE and logs the status change', async () => {
      const user = { id: 'tech-1', email: 'tech@jackys.com', status: UserStatus.INACTIVE } as User;
      userRepository.findOne.mockResolvedValue(user);

      const result = await service.reactivateUser('tech-1', { user: { id: 'admin-1' }, headers: {} });

      expect(result.status).toBe(UserStatus.ACTIVE);
      expect(userRepository.save).toHaveBeenCalledWith(expect.objectContaining({ status: UserStatus.ACTIVE }));
      expect(auditLogRepository.save).toHaveBeenCalled();
    });

    it('throws NotFoundException when the user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.reactivateUser('missing', { user: {}, headers: {} })).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException (not a silent no-op) when the user is already ACTIVE', async () => {
      const user = { id: 'tech-1', email: 'tech@jackys.com', status: UserStatus.ACTIVE } as User;
      userRepository.findOne.mockResolvedValue(user);

      await expect(service.reactivateUser('tech-1', { user: {}, headers: {} })).rejects.toThrow(ConflictException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('listUsers', () => {
    it('returns every user ordered newest-first', async () => {
      const users = [baseUser()];
      userRepository.find.mockResolvedValue(users);

      const result = await service.listUsers();

      expect(result).toBe(users);
      expect(userRepository.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' } });
    });
  });

  describe('listCreatableRoles', () => {
    it('excludes CUSTOMER from the returned roles (the-fool finding #3)', async () => {
      const roles = [{ id: 'r1', name: 'CCE' }];
      roleRepository.find.mockResolvedValue(roles);

      const result = await service.listCreatableRoles();

      expect(result).toBe(roles);
      const callArg = roleRepository.find.mock.calls[0][0];
      // Not() wraps the excluded value - assert the query targets CUSTOMER specifically
      // rather than asserting on typeorm's internal Not() object shape.
      expect(JSON.stringify(callArg)).toContain('CUSTOMER');
    });
  });

  describe('updateUser', () => {
    const activeUser = () =>
      ({
        id: 'user-2',
        email: 'tl@jackys.com',
        firstName: 'Tara',
        lastName: 'Lee',
        employeeId: 'E-2',
        phone: null,
        status: UserStatus.ACTIVE,
        roleId: 'role-tl',
        role: { id: 'role-tl', name: 'TECHNICAL_TEAM_LEADER' },
      } as unknown as User);

    it('throws ForbiddenException when an admin tries to modify their own account (the-fool finding #1)', async () => {
      await expect(
        service.updateUser('admin-1', 'admin-1', { firstName: 'New' }, { user: { id: 'admin-1' }, headers: {} }),
      ).rejects.toThrow(ForbiddenException);
      expect(userRepository.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the target user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateUser('missing', 'admin-1', { firstName: 'New' }, { user: { id: 'admin-1' }, headers: {} }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the new employee ID is already taken by someone else', async () => {
      userRepository.findOne
        .mockResolvedValueOnce(activeUser()) // the target user lookup
        .mockResolvedValueOnce({ id: 'someone-else' } as User); // the employeeId collision check

      await expect(
        service.updateUser('user-2', 'admin-1', { employeeId: 'E-99' }, { user: { id: 'admin-1' }, headers: {} }),
      ).rejects.toThrow(ConflictException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('re-runs the open-assignment blocker check on an actual role change (the-fool finding #4)', async () => {
      userRepository.findOne.mockResolvedValueOnce(activeUser());
      roleRepository.findOne.mockResolvedValue({ id: 'role-cce', name: 'CCE' });
      appointmentRepository.find.mockResolvedValue([{ id: 'appt-1', status: 'ON_SITE' }]);
      jobCardRepository.find.mockResolvedValue([]);
      inventoryReservationRepository.find.mockResolvedValue([]);

      await expect(
        service.updateUser('user-2', 'admin-1', { roleName: 'CCE' }, { user: { id: 'admin-1' }, headers: {} }),
      ).rejects.toThrow(ConflictException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('changes the role and logs a ROLE_CHANGE audit entry when there are no open blockers', async () => {
      userRepository.findOne.mockResolvedValueOnce(activeUser());
      roleRepository.findOne.mockResolvedValue({ id: 'role-cce', name: 'CCE' });
      appointmentRepository.find.mockResolvedValue([]);
      jobCardRepository.find.mockResolvedValue([]);
      inventoryReservationRepository.find.mockResolvedValue([]);

      const result = await service.updateUser(
        'user-2',
        'admin-1',
        { roleName: 'CCE' },
        { user: { id: 'admin-1' }, headers: {} },
      );

      expect(result.role).toEqual({ id: 'role-cce', name: 'CCE' });
      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.ROLE_CHANGE }),
      );
    });

    it('does not run the blocker check or touch the role when roleName matches the current role', async () => {
      userRepository.findOne.mockResolvedValueOnce(activeUser());

      await service.updateUser(
        'user-2',
        'admin-1',
        { roleName: 'TECHNICAL_TEAM_LEADER', firstName: 'Tara-Updated' },
        { user: { id: 'admin-1' }, headers: {} },
      );

      expect(appointmentRepository.find).not.toHaveBeenCalled();
      expect(roleRepository.findOne).not.toHaveBeenCalled();
    });

    it('updates profile fields and logs a single UPDATE audit entry', async () => {
      userRepository.findOne.mockResolvedValueOnce(activeUser());

      const result = await service.updateUser(
        'user-2',
        'admin-1',
        { firstName: 'Tara-Updated', phone: '+971500000000' },
        { user: { id: 'admin-1' }, headers: {} },
      );

      expect(result.firstName).toBe('Tara-Updated');
      expect(result.phone).toBe('+971500000000');
      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.UPDATE,
          newValues: { firstName: 'Tara-Updated', phone: '+971500000000' },
        }),
      );
    });

    it('is a no-op (no save, no audit log) when the dto matches the existing values exactly', async () => {
      userRepository.findOne.mockResolvedValueOnce(activeUser());

      await service.updateUser(
        'user-2',
        'admin-1',
        { firstName: 'Tara', lastName: 'Lee', employeeId: 'E-2' },
        { user: { id: 'admin-1' }, headers: {} },
      );

      expect(userRepository.save).not.toHaveBeenCalled();
      expect(auditLogRepository.save).not.toHaveBeenCalled();
    });
  });
});
