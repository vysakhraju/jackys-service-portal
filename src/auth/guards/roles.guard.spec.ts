import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { RoleAccessService } from '../role-access.service';

// This guard now gates every @Roles()-decorated endpoint in the app (2026-09-03) - it
// went from a zero-risk, DB-free array check to the single highest-leverage file in the
// backend, per the-fool's pre-mortem finding #4. This spec exists specifically because
// that finding called out that no test file covered this guard before.
describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: any;
  let roleAccessService: any;

  function contextWithUser(user: any): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as any;
  }

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    roleAccessService = { hasActiveAccessToAnyRole: jest.fn() };
    guard = new RolesGuard(reflector as Reflector, roleAccessService as RoleAccessService);
  });

  it('allows the request through with no DB call when no roles are required on the route', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const result = await guard.canActivate(contextWithUser({ role: { name: 'CCE' } }));
    expect(result).toBe(true);
    expect(roleAccessService.hasActiveAccessToAnyRole).not.toHaveBeenCalled();
  });

  it("allows the request through on a direct role match, without ever calling RoleAccessService (existing behaviour unchanged)", async () => {
    reflector.getAllAndOverride.mockReturnValue(['TECHNICAL_TEAM_LEADER', 'CCE']);
    const result = await guard.canActivate(contextWithUser({ id: 'user-1', role: { name: 'CCE' } }));
    expect(result).toBe(true);
    expect(roleAccessService.hasActiveAccessToAnyRole).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when the user has no role loaded', async () => {
    reflector.getAllAndOverride.mockReturnValue(['CCE']);
    await expect(guard.canActivate(contextWithUser(null))).rejects.toThrow(ForbiddenException);
  });

  it("falls back to checking a delegated role-access grant when the user's own role doesn't match, and allows through when one is active", async () => {
    reflector.getAllAndOverride.mockReturnValue(['TECHNICAL_TEAM_LEADER']);
    roleAccessService.hasActiveAccessToAnyRole.mockResolvedValue(true);

    const result = await guard.canActivate(contextWithUser({ id: 'user-1', role: { name: 'CCE' } }));

    expect(result).toBe(true);
    expect(roleAccessService.hasActiveAccessToAnyRole).toHaveBeenCalledWith('user-1', ['TECHNICAL_TEAM_LEADER']);
  });

  it('denies (ForbiddenException) when neither the role nor a delegated grant matches', async () => {
    reflector.getAllAndOverride.mockReturnValue(['TECHNICAL_TEAM_LEADER']);
    roleAccessService.hasActiveAccessToAnyRole.mockResolvedValue(false);

    await expect(guard.canActivate(contextWithUser({ id: 'user-1', role: { name: 'CCE' } }))).rejects.toThrow(ForbiddenException);
  });

  it('fails CLOSED (denies) when the grant lookup itself throws, rather than allowing through (the-fool finding #4)', async () => {
    reflector.getAllAndOverride.mockReturnValue(['TECHNICAL_TEAM_LEADER']);
    roleAccessService.hasActiveAccessToAnyRole.mockRejectedValue(new Error('DB is down'));

    await expect(guard.canActivate(contextWithUser({ id: 'user-1', role: { name: 'CCE' } }))).rejects.toThrow(ForbiddenException);
  });

  it("does not leak access to an unrelated role - a grant for a DIFFERENT role than required still denies", async () => {
    reflector.getAllAndOverride.mockReturnValue(['FINANCE_MANAGER']);
    // The service itself is the source of truth for "matches one of the required roles" -
    // this test proves the guard passes the full required-roles list through untouched,
    // so RoleAccessService (already unit-tested to filter by exact role) is what's
    // actually doing the narrowing, not the guard trusting a broader answer.
    roleAccessService.hasActiveAccessToAnyRole.mockResolvedValue(false);

    await expect(guard.canActivate(contextWithUser({ id: 'user-1', role: { name: 'CCE' } }))).rejects.toThrow(ForbiddenException);
    expect(roleAccessService.hasActiveAccessToAnyRole).toHaveBeenCalledWith('user-1', ['FINANCE_MANAGER']);
  });
});
