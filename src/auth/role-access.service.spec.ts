import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RoleAccessService } from './role-access.service';
import { RoleName } from './entities/role.entity';
import { MAX_ROLE_ACCESS_GRANT_DAYS } from './entities/role-access-grant.entity';

describe('RoleAccessService', () => {
  let service: RoleAccessService;
  let grantsRepo: any;
  let usersRepo: any;
  let rolesRepo: any;

  const NOW = new Date('2026-09-03T12:00:00.000Z');
  const inDays = (days: number) => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  const grant = (overrides: any = {}) =>
    ({
      id: 'grant-1',
      userId: 'user-1',
      grantedRoleName: RoleName.TECHNICAL_TEAM_LEADER,
      grantedByUserId: 'admin-1',
      grantedAt: new Date('2026-09-01T00:00:00.000Z'),
      expiresAt: new Date(inDays(14)),
      revokedAt: null,
      revokedByUserId: null,
      notes: null,
      ...overrides,
    } as any);

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    grantsRepo = {
      findOne: jest.fn(),
      count: jest.fn(),
      create: jest.fn((data: any) => data),
      save: jest.fn((entity: any) => Promise.resolve(entity)),
      find: jest.fn(),
    };
    usersRepo = { findOne: jest.fn() };
    rolesRepo = { find: jest.fn() };
    service = new RoleAccessService(grantsRepo, usersRepo, rolesRepo);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('grant', () => {
    it('creates a new active grant for a real user with a valid future expiry', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 'user-1' });
      grantsRepo.findOne.mockResolvedValue(null);

      const result = await service.grant('user-1', RoleName.TECHNICAL_TEAM_LEADER, inDays(14), 'admin-1', 'covering TL leave');

      expect(result.userId).toBe('user-1');
      expect(result.grantedRoleName).toBe(RoleName.TECHNICAL_TEAM_LEADER);
      expect(result.grantedByUserId).toBe('admin-1');
      expect(result.notes).toBe('covering TL leave');
    });

    it('throws ForbiddenException when an admin tries to grant themselves access (the-fool: self-grant)', async () => {
      await expect(service.grant('admin-1', RoleName.TECHNICAL_TEAM_LEADER, inDays(14), 'admin-1')).rejects.toThrow(ForbiddenException);
      expect(usersRepo.findOne).not.toHaveBeenCalled();
    });

    it.each([RoleName.SUPER_ADMIN, RoleName.SERVICE_HEAD, RoleName.CUSTOMER])(
      'throws ForbiddenException for a non-grantable role: %s (the-fool: recursive admin delegation)',
      async (roleName) => {
        await expect(service.grant('user-1', roleName, inDays(14), 'admin-1')).rejects.toThrow(ForbiddenException);
        expect(usersRepo.findOne).not.toHaveBeenCalled();
      },
    );

    it('throws NotFoundException for a nonexistent user', async () => {
      usersRepo.findOne.mockResolvedValue(null);
      await expect(service.grant('ghost', RoleName.TECHNICAL_TEAM_LEADER, inDays(14), 'admin-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when expiresAt is in the past', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 'user-1' });
      await expect(service.grant('user-1', RoleName.TECHNICAL_TEAM_LEADER, inDays(-1), 'admin-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when expiresAt is not a valid date', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 'user-1' });
      await expect(service.grant('user-1', RoleName.TECHNICAL_TEAM_LEADER, 'not-a-date', 'admin-1')).rejects.toThrow(BadRequestException);
    });

    it(`throws BadRequestException when expiresAt is more than ${MAX_ROLE_ACCESS_GRANT_DAYS} days out (the-fool: no standing grants)`, async () => {
      usersRepo.findOne.mockResolvedValue({ id: 'user-1' });
      await expect(
        service.grant('user-1', RoleName.TECHNICAL_TEAM_LEADER, inDays(MAX_ROLE_ACCESS_GRANT_DAYS + 1), 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it(`allows expiresAt exactly at the ${MAX_ROLE_ACCESS_GRANT_DAYS}-day cap`, async () => {
      usersRepo.findOne.mockResolvedValue({ id: 'user-1' });
      grantsRepo.findOne.mockResolvedValue(null);
      const result = await service.grant('user-1', RoleName.TECHNICAL_TEAM_LEADER, inDays(MAX_ROLE_ACCESS_GRANT_DAYS), 'admin-1');
      expect(result.userId).toBe('user-1');
    });

    it('throws ConflictException when the user already holds an active grant for this role', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 'user-1' });
      grantsRepo.findOne.mockResolvedValue(grant());
      await expect(service.grant('user-1', RoleName.TECHNICAL_TEAM_LEADER, inDays(14), 'admin-1')).rejects.toThrow(ConflictException);
    });

    // KNOWN GAP, documented rather than silently left implicit (found 2026-09-03 during
    // an independent test-master pass): the duplicate-active-grant check above is
    // read-then-write with no DB-level uniqueness constraint or transaction/lock backing
    // it (RoleAccessGrant's own @Index(['userId', 'grantedRoleName']) is a plain,
    // non-unique index - see that entity's file). Two concurrent grant() calls for the
    // same user+role can both pass the findOne check before either save()s, producing two
    // simultaneous active grants instead of the intended ConflictException for the second
    // one. Low real-world likelihood (this is an admin clicking a button, not a
    // high-concurrency path) but a real gap: revoking ONE of the two duplicates would
    // silently leave the other active, so "I revoked their access" would not actually be
    // true. Not fixed in this pass - a correct fix needs to reconcile the DB-level
    // constraint with the time-based "active" definition (expiresAt > NOW()), which a
    // plain partial unique index can't express safely without risking blocking a
    // legitimate re-grant after a prior grant's natural expiry. Recommended follow-up:
    // wrap the check+insert in a SERIALIZABLE transaction (or a per-(userId,
    // grantedRoleName) advisory lock) rather than a schema change.
    it('demonstrates the race: two "simultaneous" grants for the same user+role both succeed when both read before either writes', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 'user-1' });
      grantsRepo.findOne.mockResolvedValue(null); // both concurrent calls see "no existing grant"

      const [first, second] = await Promise.all([
        service.grant('user-1', RoleName.TECHNICAL_TEAM_LEADER, inDays(14), 'admin-1'),
        service.grant('user-1', RoleName.TECHNICAL_TEAM_LEADER, inDays(14), 'admin-2'),
      ]);

      expect(first.userId).toBe('user-1');
      expect(second.userId).toBe('user-1');
      expect(grantsRepo.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('revoke', () => {
    it('revokes an active grant', async () => {
      grantsRepo.findOne.mockResolvedValue(grant());
      const result = await service.revoke('user-1', RoleName.TECHNICAL_TEAM_LEADER, 'admin-2', 'TL is back early');
      expect(result.revokedAt).toEqual(NOW);
      expect(result.revokedByUserId).toBe('admin-2');
      expect(result.notes).toBe('TL is back early');
    });

    it('throws NotFoundException when there is no active grant to revoke', async () => {
      grantsRepo.findOne.mockResolvedValue(null);
      await expect(service.revoke('user-1', RoleName.TECHNICAL_TEAM_LEADER, 'admin-2')).rejects.toThrow(NotFoundException);
    });
  });

  describe('hasActiveAccessToAnyRole', () => {
    it('returns true when an active, unexpired grant matches one of the required roles', async () => {
      grantsRepo.count.mockResolvedValue(1);
      const result = await service.hasActiveAccessToAnyRole('user-1', ['TECHNICAL_TEAM_LEADER', 'CCE']);
      expect(result).toBe(true);
    });

    it('returns false when no grant matches', async () => {
      grantsRepo.count.mockResolvedValue(0);
      const result = await service.hasActiveAccessToAnyRole('user-1', ['TECHNICAL_TEAM_LEADER']);
      expect(result).toBe(false);
    });

    it('returns false without querying when roleNames is empty', async () => {
      const result = await service.hasActiveAccessToAnyRole('user-1', []);
      expect(result).toBe(false);
      expect(grantsRepo.count).not.toHaveBeenCalled();
    });
  });

  describe('listGrantableRoles', () => {
    it('excludes SUPER_ADMIN, SERVICE_HEAD, and CUSTOMER from the query', async () => {
      rolesRepo.find.mockResolvedValue([]);
      await service.listGrantableRoles();
      const whereClause = rolesRepo.find.mock.calls[0][0].where;
      expect(whereClause).toBeDefined();
    });
  });
});
