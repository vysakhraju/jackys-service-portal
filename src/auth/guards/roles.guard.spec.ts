import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { RoleAccessService } from '../role-access.service';
import { RolePermissionsService } from '../role-permissions.service';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { CAPABILITY_KEY } from '../decorators/requires-capability.decorator';

// This guard now gates every @Roles()-decorated endpoint in the app (2026-09-03) - it
// went from a zero-risk, DB-free array check to the single highest-leverage file in the
// backend, per the-fool's pre-mortem finding #4. This spec exists specifically because
// that finding called out that no test file covered this guard before.
//
// 2026-09-10: extended to also cover the new @RequiresCapability() / designation
// permission matrix path (RBAC Phase 1) - see checkCapability() in roles.guard.ts. The
// original @Roles() tests below are otherwise untouched, proving that path's behaviour is
// unchanged by the addition.
describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: any;
  let roleAccessService: any;
  let rolePermissionsService: any;

  function contextWithUser(user: any): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as any;
  }

  // The guard now asks the reflector for TWO separate metadata keys every call
  // (ROLES_KEY, then CAPABILITY_KEY) - this stands in for both, keyed by which one is
  // being asked for, rather than a single fixed mockReturnValue.
  function mockMetadata(roles: string[] | undefined, capability: string | undefined): void {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === ROLES_KEY) return roles;
      if (key === CAPABILITY_KEY) return capability;
      return undefined;
    });
  }

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    roleAccessService = { hasActiveAccessToAnyRole: jest.fn() };
    rolePermissionsService = { roleHasCapability: jest.fn(), getGrantedRoleNames: jest.fn(), userHasCapability: jest.fn() };
    guard = new RolesGuard(
      reflector as Reflector,
      roleAccessService as RoleAccessService,
      rolePermissionsService as RolePermissionsService,
    );
  });

  describe('@Roles() path (unchanged)', () => {
    it('allows the request through with no DB call when no roles/capability are required on the route', async () => {
      mockMetadata(undefined, undefined);
      const result = await guard.canActivate(contextWithUser({ role: { name: 'CCE' } }));
      expect(result).toBe(true);
      expect(roleAccessService.hasActiveAccessToAnyRole).not.toHaveBeenCalled();
      expect(rolePermissionsService.roleHasCapability).not.toHaveBeenCalled();
    });

    it("allows the request through on a direct role match, without ever calling RoleAccessService (existing behaviour unchanged)", async () => {
      mockMetadata(['TECHNICAL_TEAM_LEADER', 'CCE'], undefined);
      const result = await guard.canActivate(contextWithUser({ id: 'user-1', role: { name: 'CCE' } }));
      expect(result).toBe(true);
      expect(roleAccessService.hasActiveAccessToAnyRole).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the user has no role loaded', async () => {
      mockMetadata(['CCE'], undefined);
      await expect(guard.canActivate(contextWithUser(null))).rejects.toThrow(ForbiddenException);
    });

    it("falls back to checking a delegated role-access grant when the user's own role doesn't match, and allows through when one is active", async () => {
      mockMetadata(['TECHNICAL_TEAM_LEADER'], undefined);
      roleAccessService.hasActiveAccessToAnyRole.mockResolvedValue(true);

      const result = await guard.canActivate(contextWithUser({ id: 'user-1', role: { name: 'CCE' } }));

      expect(result).toBe(true);
      expect(roleAccessService.hasActiveAccessToAnyRole).toHaveBeenCalledWith('user-1', ['TECHNICAL_TEAM_LEADER']);
    });

    it('denies (ForbiddenException) when neither the role nor a delegated grant matches', async () => {
      mockMetadata(['TECHNICAL_TEAM_LEADER'], undefined);
      roleAccessService.hasActiveAccessToAnyRole.mockResolvedValue(false);

      await expect(guard.canActivate(contextWithUser({ id: 'user-1', role: { name: 'CCE' } }))).rejects.toThrow(ForbiddenException);
    });

    it('fails CLOSED (denies) when the grant lookup itself throws, rather than allowing through (the-fool finding #4)', async () => {
      mockMetadata(['TECHNICAL_TEAM_LEADER'], undefined);
      roleAccessService.hasActiveAccessToAnyRole.mockRejectedValue(new Error('DB is down'));

      await expect(guard.canActivate(contextWithUser({ id: 'user-1', role: { name: 'CCE' } }))).rejects.toThrow(ForbiddenException);
    });

    it("does not leak access to an unrelated role - a grant for a DIFFERENT role than required still denies", async () => {
      mockMetadata(['FINANCE_MANAGER'], undefined);
      // The service itself is the source of truth for "matches one of the required roles" -
      // this test proves the guard passes the full required-roles list through untouched,
      // so RoleAccessService (already unit-tested to filter by exact role) is what's
      // actually doing the narrowing, not the guard trusting a broader answer.
      roleAccessService.hasActiveAccessToAnyRole.mockResolvedValue(false);

      await expect(guard.canActivate(contextWithUser({ id: 'user-1', role: { name: 'CCE' } }))).rejects.toThrow(ForbiddenException);
      expect(roleAccessService.hasActiveAccessToAnyRole).toHaveBeenCalledWith('user-1', ['FINANCE_MANAGER']);
    });
  });

  // 2026-09-14 (Group C): the actual bypass/direct-grant/delegated-fallback/fail-CLOSED
  // decision logic that used to live in this guard's private checkCapability() was
  // extracted to RolePermissionsService.userHasCapability() (see that method's own doc
  // comment - InventoryGateway needs to make the identical decision outside an HTTP
  // context). Every one of those scenarios is now covered directly against that method in
  // role-permissions.service.spec.ts's own 'userHasCapability' describe block; what's left
  // here is proving only that this guard delegates correctly and turns the result into the
  // right outcome (return true, or throw its own ForbiddenException).
  describe('@RequiresCapability() path (designation permission matrix)', () => {
    it('allows the request through when RolePermissionsService.userHasCapability resolves true', async () => {
      mockMetadata(undefined, 'SCHEDULE_CCE_MANAGE');
      rolePermissionsService.userHasCapability.mockResolvedValue(true);

      const user = { id: 'user-1', role: { id: 'role-cce', name: 'CCE' } };
      const result = await guard.canActivate(contextWithUser(user));

      expect(result).toBe(true);
      expect(rolePermissionsService.userHasCapability).toHaveBeenCalledWith(user, 'SCHEDULE_CCE_MANAGE');
    });

    it('denies (ForbiddenException, naming the missing capability) when RolePermissionsService.userHasCapability resolves false', async () => {
      mockMetadata(undefined, 'SCHEDULE_ASSIGN_TECHNICIAN');
      rolePermissionsService.userHasCapability.mockResolvedValue(false);

      await expect(
        guard.canActivate(contextWithUser({ id: 'user-1', role: { id: 'role-cce', name: 'CCE' } })),
      ).rejects.toThrow(/Missing capability: SCHEDULE_ASSIGN_TECHNICIAN/);
    });

    it('a capability-gated route never falls back to the old @Roles() array check, even if one happened to also be present', async () => {
      // Shouldn't happen in real code (migrating a route swaps @Roles() for
      // @RequiresCapability(), never both) - this proves the guard's own precedence, not
      // reliance on that convention being followed.
      mockMetadata(['SUPER_ADMIN'], 'SCHEDULE_ASSIGN_TECHNICIAN');
      rolePermissionsService.userHasCapability.mockResolvedValue(false);

      await expect(
        guard.canActivate(contextWithUser({ id: 'user-1', role: { id: 'role-cce', name: 'CCE' } })),
      ).rejects.toThrow(ForbiddenException);
      // Never consults the plain role-name check that would have passed 'SUPER_ADMIN' by
      // itself - only the capability path ran.
      expect(rolePermissionsService.userHasCapability).toHaveBeenCalled();
      expect(roleAccessService.hasActiveAccessToAnyRole).not.toHaveBeenCalled();
    });
  });
});
