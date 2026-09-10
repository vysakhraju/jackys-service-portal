import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { CAPABILITY_KEY } from '../decorators/requires-capability.decorator';
import { RoleAccessService } from '../role-access.service';
import { RolePermissionsService } from '../role-permissions.service';
import { MATRIX_LOCKED_ROLES } from '../entities/role-permission.entity';

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
  private async checkCapability(user: any, capabilityKey: string): Promise<boolean> {
    // Hardcoded bypass - SUPER_ADMIN/SERVICE_HEAD always pass regardless of what the
    // RolePermission table says, same as every one of today's @Roles() arrays already
    // includes both (see MATRIX_LOCKED_ROLES's own comment). A bad row, an empty table, or
    // a seed bug can never lock either of them out.
    if (MATRIX_LOCKED_ROLES.includes(user.role.name)) {
      return true;
    }

    let hasDirectGrant = false;
    try {
      hasDirectGrant = await this.rolePermissionsService.roleHasCapability(user.role.id, capabilityKey);
    } catch {
      hasDirectGrant = false;
    }

    if (hasDirectGrant) {
      return true;
    }

    // Not covered by the user's own role's grants - fall back to delegated "extra role
    // access", exactly like the @Roles() path: find every (non-locked) role that currently
    // holds this capability, then ask RoleAccessService whether the user has active
    // delegated access to any of them.
    let rolesWithCapability: string[] = [];
    try {
      rolesWithCapability = await this.rolePermissionsService.getGrantedRoleNames(capabilityKey);
    } catch {
      rolesWithCapability = [];
    }

    let hasDelegatedAccess = false;
    if (rolesWithCapability.length > 0) {
      try {
        hasDelegatedAccess = await this.roleAccessService.hasActiveAccessToAnyRole(user.id, rolesWithCapability);
      } catch {
        hasDelegatedAccess = false;
      }
    }

    if (!hasDelegatedAccess) {
      throw new ForbiddenException(`Access denied. Missing capability: ${capabilityKey}.`);
    }

    return true;
  }
}
