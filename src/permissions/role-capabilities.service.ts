import { Injectable } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { DECORATORS as SWAGGER_DECORATORS } from '@nestjs/swagger';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { REQUIRES_PERMISSION_GRANT_KEY } from './decorators/requires-permission-grant.decorator';
import { RoleName } from '../auth/entities/role.entity';

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.ALL]: 'ALL',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
};

export interface RoleCapabilityEndpoint {
  method: string;
  path: string;
  summary: string | null;
  // Set when this endpoint's REAL gate is a separate, individually-issued permission
  // grant (e.g. QC_APPROVAL) - RoleAccessGrant does not include this on its own, even
  // though the role technically passes @Roles() (the-fool finding #3, 2026-09-03).
  requiresSeparatePermissionGrant: string | null;
}

export interface RoleCapabilityModule {
  module: string;
  endpoints: RoleCapabilityEndpoint[];
}

function joinPaths(prefix: string, path: string): string {
  const cleaned = [prefix, path]
    .filter((p) => p && p !== '/')
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);
  return '/' + cleaned.join('/');
}

/**
 * Builds a live, always-accurate "what can this role actually do" list, straight from
 * the real @Roles()/@ApiOperation/route metadata already on every controller - never a
 * hand-maintained list that can drift out of date as new endpoints get added. Backs the
 * Users page's role-access grant preview ("admin should see what all access the user
 * will have" - the user's own requirement, 2026-09-03).
 */
@Injectable()
export class RoleCapabilitiesService {
  constructor(
    private discoveryService: DiscoveryService,
    private metadataScanner: MetadataScanner,
  ) {}

  getCapabilitiesForRole(roleName: RoleName): RoleCapabilityModule[] {
    const modules: Map<string, RoleCapabilityEndpoint[]> = new Map();

    const controllers = this.discoveryService.getControllers();
    for (const wrapper of controllers) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) {
        continue;
      }
      const prototype = Object.getPrototypeOf(instance);
      const controllerPath: string = Reflect.getMetadata(PATH_METADATA, metatype) || '';
      const tags: string[] = Reflect.getMetadata(SWAGGER_DECORATORS.API_TAGS, metatype) || [];
      const moduleName = tags[0] || metatype.name.replace(/Controller$/, '');

      // Class-level @Roles() (e.g. ReportsController, FinanceReportsController,
      // QualityReportsController, OperationalReportsController, UsersController - all
      // apply @Roles() once above the class rather than repeating it on every method) is
      // read as a fallback, mirroring RolesGuard's own
      // reflector.getAllAndOverride(ROLES_KEY, [handler, class]) semantics (method-level
      // overrides class-level; class-level applies when the method has none). Reading
      // ONLY the method here would silently omit every endpoint in those controllers from
      // every role's preview - found 2026-09-03 during an independent test-master pass:
      // it happened to hit the flagship "delegate TECHNICAL_TEAM_LEADER to a CCE" scenario
      // directly, since ReportsController's whole Kanban board is class-level @Roles().
      const classRoles: string[] | undefined = Reflect.getMetadata(ROLES_KEY, metatype);

      const methodNames = this.metadataScanner.getAllMethodNames(prototype);
      for (const methodName of methodNames) {
        const handler = prototype[methodName];
        const requiredRoles: string[] | undefined = Reflect.getMetadata(ROLES_KEY, handler) ?? classRoles;
        if (!requiredRoles || !requiredRoles.includes(roleName)) {
          continue;
        }

        const routePath: string = Reflect.getMetadata(PATH_METADATA, handler) ?? '';
        const routeMethod: number | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
        if (routeMethod === undefined) {
          // Not an HTTP route handler (e.g. a plain helper method on the class) - skip.
          continue;
        }
        const summary: string | undefined = Reflect.getMetadata(SWAGGER_DECORATORS.API_OPERATION, handler)?.summary;
        const requiresGrant: string | undefined = Reflect.getMetadata(REQUIRES_PERMISSION_GRANT_KEY, handler);

        const endpoint: RoleCapabilityEndpoint = {
          method: METHOD_NAMES[routeMethod] ?? 'ALL',
          path: joinPaths(controllerPath, routePath),
          summary: summary ?? null,
          requiresSeparatePermissionGrant: requiresGrant ?? null,
        };

        if (!modules.has(moduleName)) {
          modules.set(moduleName, []);
        }
        modules.get(moduleName)!.push(endpoint);
      }
    }

    return Array.from(modules.entries())
      .map(([module, endpoints]) => ({
        module,
        endpoints: endpoints.sort((a, b) => a.path.localeCompare(b.path)),
      }))
      .sort((a, b) => a.module.localeCompare(b.module));
  }
}
