import { SetMetadata } from '@nestjs/common';

export const CAPABILITY_KEY = 'requiresCapability';

/**
 * Marks an endpoint as migrated onto the designation permission matrix. Replaces (never
 * combines with) that endpoint's old @Roles() decorator - RolesGuard checks this key's
 * grants in RolePermission instead of a hardcoded array once present. `key` must be a
 * `migrated: true` entry in capability-catalog.ts.
 */
export const RequiresCapability = (key: string) => SetMetadata(CAPABILITY_KEY, key);
