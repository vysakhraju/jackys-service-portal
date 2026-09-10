import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { RolePermission, MATRIX_LOCKED_ROLES } from './entities/role-permission.entity';
import { Role, RoleName } from './entities/role.entity';
import { User } from './entities/user.entity';
import { CAPABILITY_CATALOG, getMigratedCapability } from './capability-catalog';

/**
 * The designation permission matrix: which roles hold which capabilities. See
 * RolePermission's own doc comment for how this differs from RoleAccessService (per-user
 * whole-role delegation) and PermissionsService (per-user named sign-off grants like
 * QC_APPROVAL) - all three are separate, coexisting systems.
 */
@Injectable()
export class RolePermissionsService {
  constructor(
    @InjectRepository(RolePermission)
    private rolePermRepo: Repository<RolePermission>,
    @InjectRepository(Role)
    private rolesRepo: Repository<Role>,
    @InjectRepository(User)
    private usersRepo: Repository<User>,
  ) {}

  // The single call site RolesGuard uses. Deliberately narrow and exception-free on the
  // "not granted" path, same shape as RoleAccessService.hasActiveAccessToAnyRole - the
  // guard itself decides what a `false` (or a thrown error) means.
  async roleHasCapability(roleId: string, capabilityKey: string): Promise<boolean> {
    const row = await this.rolePermRepo.findOne({ where: { roleId, capabilityKey } });
    return !!row;
  }

  // Every capability in the catalog, with each grantable role's role id and whether that
  // role currently holds it - the shape the admin matrix UI reads directly. Capabilities
  // not yet migrated are still listed (so the UI can show "coming soon"), just with no
  // grants possible yet.
  async getMatrix(): Promise<
    {
      key: string;
      label: string;
      module: string;
      migrated: boolean;
      grantedRoleIds: string[];
    }[]
  > {
    const grants = await this.rolePermRepo.find();
    const grantsByKey = new Map<string, Set<string>>();
    for (const g of grants) {
      if (!grantsByKey.has(g.capabilityKey)) grantsByKey.set(g.capabilityKey, new Set());
      grantsByKey.get(g.capabilityKey)!.add(g.roleId);
    }
    return CAPABILITY_CATALOG.map((c) => ({
      key: c.key,
      label: c.label,
      module: c.module,
      migrated: c.migrated,
      grantedRoleIds: [...(grantsByKey.get(c.key) ?? [])],
    }));
  }

  // RolesGuard's fallback call site: which (non-locked) roles currently hold a capability,
  // by name - the exact input shape RoleAccessService.hasActiveAccessToAnyRole already
  // expects, so a user with delegated "extra role access" to one of these roles gets the
  // capability too, the same way delegation already works for the old @Roles() path.
  // MATRIX_LOCKED_ROLES never appear here by construction (setGrant refuses to write rows
  // for them), so no filtering needed on the way out.
  async getGrantedRoleNames(capabilityKey: string): Promise<RoleName[]> {
    const grants = await this.rolePermRepo.find({ where: { capabilityKey } });
    if (grants.length === 0) return [];
    const roleIds = [...new Set(grants.map((g) => g.roleId))];
    const roles = await this.rolesRepo.find({ where: { id: In(roleIds) } });
    return roles.map((r) => r.name);
  }

  // Roles that can appear as an editable column at all - every grantable role except
  // MATRIX_LOCKED_ROLES (their access is hardcoded, editing them here would be inert).
  async listEditableRoles(): Promise<Role[]> {
    return this.rolesRepo.find({
      where: {},
      order: { displayName: 'ASC' },
    }).then((roles) => roles.filter((r) => !MATRIX_LOCKED_ROLES.includes(r.name)));
  }

  // Users currently holding a role - the "N users have this designation" reference list
  // shown alongside the checklist so an admin sees who a change actually affects before
  // saving, not just an abstract role name.
  async listUsersForRole(roleId: string): Promise<Pick<User, 'id' | 'firstName' | 'lastName' | 'email' | 'status'>[]> {
    return this.usersRepo.find({
      where: { roleId },
      select: { id: true, firstName: true, lastName: true, email: true, status: true },
      order: { firstName: 'ASC' },
    });
  }

  // Sets a role's ENTIRE grant set for one capability to exactly `granted` - true inserts
  // the row if missing, false removes it if present. Idempotent either way. This is the
  // single write path the admin "tick and save" screen calls.
  async setGrant(roleId: string, capabilityKey: string, granted: boolean, grantedByUserId: string): Promise<void> {
    const capability = getMigratedCapability(capabilityKey);
    if (!capability) {
      throw new BadRequestException(`"${capabilityKey}" is not a recognized, migrated capability.`);
    }
    const role = await this.rolesRepo.findOne({ where: { id: roleId } });
    if (!role) {
      throw new BadRequestException('Role not found.');
    }
    if (MATRIX_LOCKED_ROLES.includes(role.name)) {
      throw new ForbiddenException(
        `${role.displayName} always has full access and cannot be edited here.`,
      );
    }

    const existing = await this.rolePermRepo.findOne({ where: { roleId, capabilityKey } });
    if (granted && !existing) {
      await this.rolePermRepo.save(this.rolePermRepo.create({ roleId, capabilityKey, grantedByUserId }));
    } else if (!granted && existing) {
      await this.rolePermRepo.remove(existing);
    }
    // Already in the desired state - no-op, matches setGrant's idempotent contract.
  }

  // The admin UI's single "tick and save" write path: sets a role's ENTIRE migrated-
  // capability set to exactly `capabilityKeys` in one call, diffing against what the role
  // holds today and only touching what actually changed (reuses setGrant() per changed
  // key, so role-existence/lock validation and the write itself stay exactly as tested
  // there). Unknown/not-yet-migrated keys in the input are silently ignored - the UI only
  // ever renders checkboxes for migrated catalog entries, so anything else is not a real
  // toggle to begin with.
  async setRoleCapabilities(
    roleId: string,
    capabilityKeys: string[],
    grantedByUserId: string,
  ): Promise<{ granted: string[]; revoked: string[] }> {
    const role = await this.rolesRepo.findOne({ where: { id: roleId } });
    if (!role) {
      throw new BadRequestException('Role not found.');
    }
    if (MATRIX_LOCKED_ROLES.includes(role.name)) {
      throw new ForbiddenException(
        `${role.displayName} always has full access and cannot be edited here.`,
      );
    }

    const desired = new Set(capabilityKeys);
    const granted: string[] = [];
    const revoked: string[] = [];

    for (const capability of CAPABILITY_CATALOG) {
      if (!capability.migrated) continue; // not a real checkbox yet - nothing to toggle
      const shouldHave = desired.has(capability.key);
      const hasNow = await this.roleHasCapability(roleId, capability.key);
      if (shouldHave === hasNow) continue;
      await this.setGrant(roleId, capability.key, shouldHave, grantedByUserId);
      (shouldHave ? granted : revoked).push(capability.key);
    }

    return { granted, revoked };
  }

  // Seeds every migrated capability's defaultRoles, INSERT-IF-MISSING ONLY - never
  // touches a row that already exists, so a previously-applied admin edit (including an
  // admin UNCHECKING a default) is never silently reverted by re-running this. Matches
  // seed-admin.ts's own skip-if-exists convention. Safe to run repeatedly, including after
  // adding a brand-new migrated capability later (only the new one's rows get created).
  async seedDefaults(): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;
    for (const capability of CAPABILITY_CATALOG) {
      if (!capability.migrated) continue;
      for (const roleName of capability.defaultRoles) {
        if (MATRIX_LOCKED_ROLES.includes(roleName)) continue; // inert, see catalog comment
        const role = await this.rolesRepo.findOne({ where: { name: roleName } });
        if (!role) continue; // role not seeded yet in this environment - nothing to attach to
        const existing = await this.rolePermRepo.findOne({ where: { roleId: role.id, capabilityKey: capability.key } });
        if (existing) {
          skipped++;
          continue;
        }
        await this.rolePermRepo.save(this.rolePermRepo.create({ roleId: role.id, capabilityKey: capability.key, grantedByUserId: null }));
        created++;
      }
    }
    return { created, skipped };
  }
}
