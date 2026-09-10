import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RolePermissionsService } from './role-permissions.service';
import { RoleName } from './entities/role.entity';

describe('RolePermissionsService', () => {
  let service: RolePermissionsService;
  let rolePermRepo: any;
  let rolesRepo: any;
  let usersRepo: any;

  const role = (overrides: any = {}) =>
    ({ id: 'role-cce', name: RoleName.CCE, displayName: 'Customer Care Executive', ...overrides } as any);

  beforeEach(() => {
    rolePermRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((data: any) => data),
      save: jest.fn((entity: any) => Promise.resolve(entity)),
      remove: jest.fn(),
    };
    rolesRepo = { findOne: jest.fn(), find: jest.fn() };
    usersRepo = { find: jest.fn() };
    service = new RolePermissionsService(rolePermRepo, rolesRepo, usersRepo);
  });

  describe('roleHasCapability', () => {
    it('returns true when a grant row exists', async () => {
      rolePermRepo.findOne.mockResolvedValue({ id: 'g1', roleId: 'role-cce', capabilityKey: 'SCHEDULE_CCE_MANAGE' });
      const result = await service.roleHasCapability('role-cce', 'SCHEDULE_CCE_MANAGE');
      expect(result).toBe(true);
    });

    it('returns false (never throws) when no grant row exists', async () => {
      rolePermRepo.findOne.mockResolvedValue(null);
      const result = await service.roleHasCapability('role-cce', 'SCHEDULE_CCE_MANAGE');
      expect(result).toBe(false);
    });
  });

  describe('getGrantedRoleNames', () => {
    it('returns the names of every distinct role currently holding the capability', async () => {
      rolePermRepo.find.mockResolvedValue([
        { roleId: 'role-cce', capabilityKey: 'SCHEDULE_CCE_MANAGE' },
        { roleId: 'role-tl', capabilityKey: 'SCHEDULE_CCE_MANAGE' },
      ]);
      rolesRepo.find.mockResolvedValue([
        role({ id: 'role-cce', name: RoleName.CCE }),
        role({ id: 'role-tl', name: RoleName.TECHNICAL_TEAM_LEADER }),
      ]);

      const result = await service.getGrantedRoleNames('SCHEDULE_CCE_MANAGE');

      expect(result.sort()).toEqual([RoleName.CCE, RoleName.TECHNICAL_TEAM_LEADER].sort());
    });

    it('returns an empty array (no role lookup at all) when nothing holds the capability', async () => {
      rolePermRepo.find.mockResolvedValue([]);

      const result = await service.getGrantedRoleNames('SCHEDULE_CCE_MANAGE');

      expect(result).toEqual([]);
      expect(rolesRepo.find).not.toHaveBeenCalled();
    });

    it('de-duplicates role ids before looking roles up (a role never appears twice)', async () => {
      rolePermRepo.find.mockResolvedValue([
        { roleId: 'role-cce', capabilityKey: 'SCHEDULE_CCE_MANAGE' },
        { roleId: 'role-cce', capabilityKey: 'SCHEDULE_CCE_MANAGE' },
      ]);
      rolesRepo.find.mockResolvedValue([role({ id: 'role-cce', name: RoleName.CCE })]);

      const result = await service.getGrantedRoleNames('SCHEDULE_CCE_MANAGE');

      expect(result).toEqual([RoleName.CCE]);
    });
  });

  describe('listEditableRoles', () => {
    it('excludes MATRIX_LOCKED_ROLES from the editable list', async () => {
      rolesRepo.find.mockResolvedValue([
        role({ id: 'role-admin', name: RoleName.SUPER_ADMIN }),
        role({ id: 'role-head', name: RoleName.SERVICE_HEAD }),
        role({ id: 'role-customer', name: RoleName.CUSTOMER }),
        role({ id: 'role-cce', name: RoleName.CCE }),
      ]);

      const result = await service.listEditableRoles();

      expect(result.map((r) => r.name)).toEqual([RoleName.CCE]);
    });
  });

  describe('listUsersForRole', () => {
    it('queries users by roleId, selecting only the reference-list fields', async () => {
      usersRepo.find.mockResolvedValue([{ id: 'u1', firstName: 'Amina', lastName: 'K', email: 'a@jackys.com', status: 'ACTIVE' }]);

      const result = await service.listUsersForRole('role-cce');

      expect(usersRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { roleId: 'role-cce' },
          select: { id: true, firstName: true, lastName: true, email: true, status: true },
        }),
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('setGrant', () => {
    beforeEach(() => {
      rolesRepo.findOne.mockResolvedValue(role());
    });

    it('inserts a row when granting a capability the role does not yet have', async () => {
      rolePermRepo.findOne.mockResolvedValue(null);

      await service.setGrant('role-cce', 'SCHEDULE_CCE_MANAGE', true, 'admin-1');

      expect(rolePermRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ roleId: 'role-cce', capabilityKey: 'SCHEDULE_CCE_MANAGE', grantedByUserId: 'admin-1' }),
      );
    });

    it('is a no-op when granting a capability the role already has (idempotent)', async () => {
      rolePermRepo.findOne.mockResolvedValue({ id: 'existing-row' });

      await service.setGrant('role-cce', 'SCHEDULE_CCE_MANAGE', true, 'admin-1');

      expect(rolePermRepo.save).not.toHaveBeenCalled();
      expect(rolePermRepo.remove).not.toHaveBeenCalled();
    });

    it('removes the row when revoking a capability the role currently has', async () => {
      const existing = { id: 'existing-row' };
      rolePermRepo.findOne.mockResolvedValue(existing);

      await service.setGrant('role-cce', 'SCHEDULE_CCE_MANAGE', false, 'admin-1');

      expect(rolePermRepo.remove).toHaveBeenCalledWith(existing);
    });

    it('is a no-op when revoking a capability the role never had', async () => {
      rolePermRepo.findOne.mockResolvedValue(null);

      await service.setGrant('role-cce', 'SCHEDULE_CCE_MANAGE', false, 'admin-1');

      expect(rolePermRepo.save).not.toHaveBeenCalled();
      expect(rolePermRepo.remove).not.toHaveBeenCalled();
    });

    it('rejects an unrecognized or not-yet-migrated capability key', async () => {
      await expect(service.setGrant('role-cce', 'NOT_A_REAL_KEY', true, 'admin-1')).rejects.toThrow(BadRequestException);
      expect(rolesRepo.findOne).not.toHaveBeenCalled();
    });

    it('rejects an unknown role id', async () => {
      rolesRepo.findOne.mockResolvedValue(null);
      await expect(service.setGrant('role-ghost', 'SCHEDULE_CCE_MANAGE', true, 'admin-1')).rejects.toThrow(BadRequestException);
    });

    it('refuses to edit a MATRIX_LOCKED_ROLES role even for a valid, migrated capability', async () => {
      rolesRepo.findOne.mockResolvedValue(role({ id: 'role-admin', name: RoleName.SUPER_ADMIN, displayName: 'Super Admin' }));

      await expect(service.setGrant('role-admin', 'SCHEDULE_CCE_MANAGE', true, 'admin-1')).rejects.toThrow(ForbiddenException);
      expect(rolePermRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('setRoleCapabilities', () => {
    beforeEach(() => {
      rolesRepo.findOne.mockResolvedValue(role());
    });

    it('grants every migrated capability passed in that the role does not already hold', async () => {
      rolePermRepo.findOne.mockResolvedValue(null); // role holds nothing today

      const result = await service.setRoleCapabilities(
        'role-cce',
        ['SCHEDULE_CCE_MANAGE', 'QC_GATE_ACCESS'],
        'admin-1',
      );

      expect(result.granted.sort()).toEqual(['QC_GATE_ACCESS', 'SCHEDULE_CCE_MANAGE'].sort());
      expect(result.revoked).toEqual([]);
      const savedKeys = rolePermRepo.save.mock.calls.map((call: any[]) => call[0].capabilityKey);
      expect(savedKeys.sort()).toEqual(['QC_GATE_ACCESS', 'SCHEDULE_CCE_MANAGE'].sort());
    });

    it('revokes every migrated capability the role holds today that is missing from the new list', async () => {
      // Role currently holds SCHEDULE_CCE_MANAGE only.
      rolePermRepo.findOne.mockImplementation(({ where }: any) =>
        Promise.resolve(where.capabilityKey === 'SCHEDULE_CCE_MANAGE' ? { id: 'row-1', roleId: 'role-cce', capabilityKey: 'SCHEDULE_CCE_MANAGE' } : null),
      );

      const result = await service.setRoleCapabilities('role-cce', [], 'admin-1');

      expect(result.revoked).toEqual(['SCHEDULE_CCE_MANAGE']);
      expect(result.granted).toEqual([]);
      expect(rolePermRepo.remove).toHaveBeenCalledWith({ id: 'row-1', roleId: 'role-cce', capabilityKey: 'SCHEDULE_CCE_MANAGE' });
    });

    it('touches nothing when the new list exactly matches what the role already holds (idempotent save)', async () => {
      rolePermRepo.findOne.mockImplementation(({ where }: any) =>
        Promise.resolve(where.capabilityKey === 'SCHEDULE_CCE_MANAGE' ? { id: 'row-1' } : null),
      );

      const result = await service.setRoleCapabilities('role-cce', ['SCHEDULE_CCE_MANAGE'], 'admin-1');

      expect(result).toEqual({ granted: [], revoked: [] });
      expect(rolePermRepo.save).not.toHaveBeenCalled();
      expect(rolePermRepo.remove).not.toHaveBeenCalled();
    });

    it('silently ignores an unrecognized/unmigrated key in the input rather than throwing', async () => {
      rolePermRepo.findOne.mockResolvedValue(null);

      const result = await service.setRoleCapabilities('role-cce', ['NOT_A_REAL_KEY'], 'admin-1');

      expect(result).toEqual({ granted: [], revoked: [] });
      expect(rolePermRepo.save).not.toHaveBeenCalled();
    });

    it('rejects an unknown role id before touching any grant row', async () => {
      rolesRepo.findOne.mockResolvedValue(null);

      await expect(service.setRoleCapabilities('role-ghost', ['SCHEDULE_CCE_MANAGE'], 'admin-1')).rejects.toThrow(BadRequestException);
      expect(rolePermRepo.findOne).not.toHaveBeenCalled();
    });

    it('refuses to edit a MATRIX_LOCKED_ROLES role, even with an empty list that would otherwise no-op', async () => {
      rolesRepo.findOne.mockResolvedValue(role({ id: 'role-admin', name: RoleName.SUPER_ADMIN, displayName: 'Super Admin' }));

      await expect(service.setRoleCapabilities('role-admin', [], 'admin-1')).rejects.toThrow(ForbiddenException);
      expect(rolePermRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('seedDefaults', () => {
    it('creates a row for every migrated capability x defaultRole combination not already present', async () => {
      rolesRepo.findOne.mockImplementation(({ where }: any) =>
        Promise.resolve(role({ id: `role-${where.name}`, name: where.name })),
      );
      rolePermRepo.findOne.mockResolvedValue(null);

      const result = await service.seedDefaults();

      expect(result.created).toBeGreaterThan(0);
      expect(rolePermRepo.save).toHaveBeenCalled();
    });

    it('skips (does not overwrite) a combination that already has a row - an admin edit survives a re-seed', async () => {
      rolesRepo.findOne.mockImplementation(({ where }: any) =>
        Promise.resolve(role({ id: `role-${where.name}`, name: where.name })),
      );
      rolePermRepo.findOne.mockResolvedValue({ id: 'already-there' });

      const result = await service.seedDefaults();

      expect(result.created).toBe(0);
      expect(result.skipped).toBeGreaterThan(0);
      expect(rolePermRepo.save).not.toHaveBeenCalled();
    });

    it('never writes a row for a MATRIX_LOCKED_ROLES role even if one somehow appeared in a catalog defaultRoles list', async () => {
      rolesRepo.findOne.mockImplementation(({ where }: any) =>
        Promise.resolve(role({ id: `role-${where.name}`, name: where.name })),
      );
      rolePermRepo.findOne.mockResolvedValue(null);

      await service.seedDefaults();

      const writtenRoleIds = rolePermRepo.save.mock.calls.map((call: any[]) => call[0].roleId);
      expect(writtenRoleIds).not.toContain(`role-${RoleName.SUPER_ADMIN}`);
      expect(writtenRoleIds).not.toContain(`role-${RoleName.SERVICE_HEAD}`);
    });

    it('skips a role not yet present in this environment rather than failing the whole seed', async () => {
      rolesRepo.findOne.mockResolvedValue(null);

      const result = await service.seedDefaults();

      expect(result.created).toBe(0);
      expect(rolePermRepo.save).not.toHaveBeenCalled();
    });
  });
});
