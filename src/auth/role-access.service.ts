import { Injectable, ConflictException, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Not, Repository } from 'typeorm';
import { RoleAccessGrant, NON_GRANTABLE_ACCESS_ROLES, MAX_ROLE_ACCESS_GRANT_DAYS } from './entities/role-access-grant.entity';
import { Role, RoleName } from './entities/role.entity';
import { User } from './entities/user.entity';

/**
 * "Extra role access" - admin-assignable delegation of one role's access to a user who
 * doesn't hold that role, without changing their real role. See RoleAccessGrant's own
 * doc comment for the full rationale and the the-fool findings that shaped this.
 *
 * Deliberately separate from PermissionsService (QC_APPROVAL/REWORK_APPROVAL) - that
 * stays exactly as it was, untouched by this file. See hasActiveAccessToAnyRole()'s
 * comment for how RolesGuard uses this alongside (never instead of) the plain role check.
 */
@Injectable()
export class RoleAccessService {
  constructor(
    @InjectRepository(RoleAccessGrant)
    private grantsRepo: Repository<RoleAccessGrant>,
    @InjectRepository(User)
    private usersRepo: Repository<User>,
    @InjectRepository(Role)
    private rolesRepo: Repository<Role>,
  ) {}

  async grant(
    userId: string,
    grantedRoleName: RoleName,
    expiresAt: string,
    grantedByUserId: string,
    notes?: string,
  ): Promise<RoleAccessGrant> {
    // the-fool finding (self-grant, 2026-09-03): an admin can never delegate role access
    // to their own account, mirroring the self-lockout check AuthService.updateUser()
    // already enforces for direct role changes.
    if (userId === grantedByUserId) {
      throw new ForbiddenException('You cannot grant yourself extra role access.');
    }

    if (NON_GRANTABLE_ACCESS_ROLES.includes(grantedRoleName)) {
      throw new ForbiddenException(
        `${grantedRoleName} access can never be delegated this way - it is excluded to prevent recursive admin delegation (see RoleAccessGrant.NON_GRANTABLE_ACCESS_ROLES).`,
      );
    }

    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const expiry = new Date(expiresAt);
    const now = new Date();
    if (Number.isNaN(expiry.getTime()) || expiry <= now) {
      throw new BadRequestException('expiresAt must be a valid date in the future.');
    }
    const maxExpiry = new Date(now.getTime() + MAX_ROLE_ACCESS_GRANT_DAYS * 24 * 60 * 60 * 1000);
    if (expiry > maxExpiry) {
      throw new BadRequestException(
        `expiresAt cannot be more than ${MAX_ROLE_ACCESS_GRANT_DAYS} days out - there is no standing/permanent delegation. Re-grant if coverage needs extending.`,
      );
    }

    const existing = await this.grantsRepo.findOne({
      where: { userId, grantedRoleName, revokedAt: IsNull(), expiresAt: MoreThan(now) },
    });
    if (existing) {
      throw new ConflictException(`User already holds active delegated access to ${grantedRoleName}`);
    }

    const grant = this.grantsRepo.create({
      userId,
      grantedRoleName,
      expiresAt: expiry,
      grantedByUserId,
      notes: notes ?? null,
    });
    return this.grantsRepo.save(grant);
  }

  async revoke(
    userId: string,
    grantedRoleName: RoleName,
    revokedByUserId: string,
    notes?: string,
  ): Promise<RoleAccessGrant> {
    const existing = await this.grantsRepo.findOne({
      where: { userId, grantedRoleName, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
    });
    if (!existing) {
      throw new NotFoundException(`User has no active delegated access to ${grantedRoleName} to revoke`);
    }

    existing.revokedAt = new Date();
    existing.revokedByUserId = revokedByUserId;
    if (notes) {
      existing.notes = notes;
    }
    return this.grantsRepo.save(existing);
  }

  // The single call site RolesGuard uses. Returns true only if the user holds an active,
  // unexpired grant for at least one of the given roles. Deliberately narrow and
  // exception-free on the "no access" path (callers decide what to do with `false`) -
  // RolesGuard itself is what fails closed on any unexpected error from this call.
  async hasActiveAccessToAnyRole(userId: string, roleNames: string[]): Promise<boolean> {
    if (roleNames.length === 0) {
      return false;
    }
    const count = await this.grantsRepo.count({
      where: {
        userId,
        grantedRoleName: In(roleNames as RoleName[]),
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
    return count > 0;
  }

  async listForUser(userId: string): Promise<RoleAccessGrant[]> {
    return this.grantsRepo.find({
      where: { userId },
      order: { grantedAt: 'DESC' },
    });
  }

  async listActiveForUser(userId: string): Promise<RoleAccessGrant[]> {
    return this.grantsRepo.find({
      where: { userId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      order: { grantedAt: 'DESC' },
    });
  }

  async listByRole(grantedRoleName: RoleName, activeOnly = true): Promise<RoleAccessGrant[]> {
    return this.grantsRepo.find({
      where: activeOnly
        ? { grantedRoleName, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) }
        : { grantedRoleName },
      order: { grantedAt: 'DESC' },
      relations: { user: true },
    });
  }

  // Roles an admin is allowed to delegate - every role except the three in
  // NON_GRANTABLE_ACCESS_ROLES. Backs both the frontend's role picker and defense-in-depth
  // validation alongside GrantRoleAccessDto's own @IsIn check.
  async listGrantableRoles(): Promise<Role[]> {
    return this.rolesRepo.find({
      where: { name: Not(In(NON_GRANTABLE_ACCESS_ROLES)) },
      order: { displayName: 'ASC' },
    });
  }
}
