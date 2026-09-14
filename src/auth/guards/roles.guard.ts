import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { CAPABILITY_KEY } from '../decorators/requires-capability.decorator';
import { RoleAccessService } from '../role-access.service';
import { RolePermissionsService } from '../role-permissions.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private roleAccessService: RoleAccessService,
    private rolePermissionsService: RolePermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredCapability = this.reflector.getAllAndOverride<string>(CAPABILITY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // An endpoint carries exactly one of these, never both - migrating an endpoint means
    // swapping its @Roles() for @RequiresCapability(), not adding the second on top (see
    // requires-capability.decorator.ts). No decorator at all still means open, unchanged.
    if (!requiredCapability && (!requiredRoles || requiredRoles.length === 0)) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user || !user.role) {
      throw new ForbiddenException('User role not found');
    }

    if (requiredCapability) {
      return this.checkCapability(user, requiredCapability);
    }

    const hasRole = requiredRoles.some((role) => user.role.name === role);

    if (hasRole) {
      return true;
    }

    // Not covered by the user's own role - fall back to checking for delegated "extra
    // role access" (RoleAccessService/Users page - e.g. an admin covering a Technical
    // Team Leader's access on a CCE while the TL is on leave). This is purely additive:
    // every request that already passed via a direct role match above never reaches this
    // branch at all, so existing behaviour for every current role holder is unchanged.
    //
    // Fails CLOSED (the-fool finding #4, 2026-09-03): this guard now gates every @Roles()
    // endpoint in the app, so a lookup error here must deny access, never silently allow
    // it - the opposite of what a bug in this branch could otherwise cause app-wide.
    let hasDelegatedAccess = false;
    try {
      hasDelegatedAccess = await this.roleAccessService.hasActiveAccessToAnyRole(user.id, requiredRoles);
    } catch {
      hasDelegatedAccess = false;
    }

    if (!hasDelegatedAccess) {
      throw new ForbiddenException(
        `Access denied. Required roles: ${requiredRoles.join(', ')}. Your role: ${user.role.name}`,
      );
    }

    return true;
  }

  // The designation permission matrix's own check, mirroring the @Roles() path above
  // exactly (direct grant, then fall through to delegated "extra role access" on a miss,
  // fail CLOSED on any lookup error) so migrating an endpoint changes nothing about how
  // access decisions are made - only where the allowed-role list is stored.
  //
  // 2026-09-14 (Group C): the actual decision logic now lives in
  // RolePermissionsService.userHasCapability() - extracted so InventoryGateway's
  // handleConnection() (which can't reuse this HTTP-only guard, see that gateway's own
  // doc comment) can make the exact same access decision instead of its own separate,
  // hand-rolled hardcoded-role-array check. This method is now just the HTTP-specific
  // wrapper: turn a `false` into the guard's own ForbiddenException.
  private async checkCapability(user: any, capabilityKey: string): Promise<boolean> {
    const allowed = await this.rolePermissionsService.userHasCapability(user, capabilityKey);

    if (!allowed) {
      throw new ForbiddenException(`Access denied. Missing capability: ${capabilityKey}.`);
    }

    return true;
  }
}
