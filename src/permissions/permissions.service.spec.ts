import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { PermissionType } from './entities/user-permission-grant.entity';

describe('PermissionsService', () => {
  let service: PermissionsService;
  let grantsRepo: any;
  let usersRepo: any;

  const grant = (overrides: any = {}) =>
    ({
      id: 'grant-1',
      userId: 'user-1',
      permissionType: PermissionType.QC_APPROVAL,
      grantedByUserId: 'admin-1',
      grantedAt: new Date('2026-08-01T00:00:00.000Z'),
      revokedAt: null,
      revokedByUserId: null,
      notes: null,
      ...overrides,
    } as any);

  beforeEach(() => {
    grantsRepo = {
      findOne: jest.fn(),
      count: jest.fn(),
      create: jest.fn((data: any) => data),
      save: jest.fn((entity: any) => Promise.resolve(entity)),
      find: jest.fn(),
    };
    usersRepo = {
      findOne: jest.fn(),
    };
    service = new PermissionsService(grantsRepo, usersRepo);
  });

  describe('grant', () => {
    it('creates a new active grant for a real user with no existing active grant', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 'user-1' });
      grantsRepo.findOne.mockResolvedValue(null);

      const result = await service.grant('user-1', PermissionType.QC_APPROVAL, 'admin-1', 'per the new QC policy');

      expect(result.userId).toBe('user-1');
      expect(result.permissionType).toBe(PermissionType.QC_APPROVAL);
      expect(result.grantedByUserId).toBe('admin-1');
      expect(result.notes).toBe('per the new QC policy');
    });

    it('this is what makes the grant admin-assignable to ANY user regardless of role - no role check here at all, just that the user exists', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 'field-tech-1', role: { name: 'TECHNICIAN_FIELD' } });
      grantsRepo.findOne.mockResolvedValue(null);

      const result = await service.grant('field-tech-1', PermissionType.QC_APPROVAL, 'admin-1');

      expect(result.userId).toBe('field-tech-1');
    });

    it('throws NotFoundException for a nonexistent user', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.grant('missing-user', PermissionType.QC_APPROVAL, 'admin-1')).rejects.toThrow(NotFoundException);
    });

    it('rejects granting when an active grant of this type already exists (409)', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 'user-1' });
      grantsRepo.findOne.mockResolvedValue(grant());

      await expect(service.grant('user-1', PermissionType.QC_APPROVAL, 'admin-1')).rejects.toThrow(ConflictException);
    });

    it('allows granting a DIFFERENT permission type even if one is already active', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 'user-1' });
      // active QC_APPROVAL grant exists, but we're granting REWORK_APPROVAL - findOne is
      // scoped to (userId, permissionType, revokedAt IS NULL) so this should return null
      grantsRepo.findOne.mockResolvedValue(null);

      const result = await service.grant('user-1', PermissionType.REWORK_APPROVAL, 'admin-1');

      expect(result.permissionType).toBe(PermissionType.REWORK_APPROVAL);
    });
  });

  describe('revoke', () => {
    it('sets revokedAt/revokedByUserId on an active grant', async () => {
      grantsRepo.findOne.mockResolvedValue(grant());

      const result = await service.revoke('user-1', PermissionType.QC_APPROVAL, 'admin-2', 'role change');

      expect(result.revokedAt).toBeInstanceOf(Date);
      expect(result.revokedByUserId).toBe('admin-2');
      expect(result.notes).toBe('role change');
    });

    it('throws NotFoundException when there is no active grant to revoke', async () => {
      grantsRepo.findOne.mockResolvedValue(null);

      await expect(service.revoke('user-1', PermissionType.QC_APPROVAL, 'admin-2')).rejects.toThrow(NotFoundException);
    });
  });

  describe('hasActiveGrant / requireActiveGrant', () => {
    it('hasActiveGrant returns true when an active grant exists', async () => {
      grantsRepo.count.mockResolvedValue(1);

      const result = await service.hasActiveGrant('user-1', PermissionType.QC_APPROVAL);

      expect(result).toBe(true);
    });

    it('hasActiveGrant returns false when none exists', async () => {
      grantsRepo.count.mockResolvedValue(0);

      const result = await service.hasActiveGrant('user-1', PermissionType.QC_APPROVAL);

      expect(result).toBe(false);
    });

    it('requireActiveGrant resolves silently when the grant is active', async () => {
      grantsRepo.count.mockResolvedValue(1);

      await expect(service.requireActiveGrant('user-1', PermissionType.QC_APPROVAL)).resolves.toBeUndefined();
    });

    it('requireActiveGrant throws ForbiddenException when the grant is missing or revoked', async () => {
      grantsRepo.count.mockResolvedValue(0);

      await expect(service.requireActiveGrant('user-1', PermissionType.QC_APPROVAL)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listGrantsForUser / listGrantsByType', () => {
    it('lists a user\'s full grant history, most recent first', async () => {
      grantsRepo.find.mockResolvedValue([grant({ id: 'g2' }), grant({ id: 'g1' })]);

      const result = await service.listGrantsForUser('user-1');

      expect(grantsRepo.find).toHaveBeenCalledWith({ where: { userId: 'user-1' }, order: { grantedAt: 'DESC' } });
      expect(result).toHaveLength(2);
    });

    it('lists only active grants of a type by default', async () => {
      grantsRepo.find.mockResolvedValue([grant()]);

      await service.listGrantsByType(PermissionType.QC_APPROVAL);

      expect(grantsRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ permissionType: PermissionType.QC_APPROVAL }) }),
      );
    });
  });
});
