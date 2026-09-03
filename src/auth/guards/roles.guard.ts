import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RoleAccessService } from '../role-access.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private roleAccessService: RoleAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user || !user.role) {
      throw new ForbiddenException('User role not found');
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
}
