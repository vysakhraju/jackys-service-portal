import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { RoleName } from './role.entity';

// Roles that can never be delegated through this mechanism, no matter who's granting.
// SUPER_ADMIN/SERVICE_HEAD are excluded because those two roles' own @Roles() gates cover
// the entire admin surface - user management, permission grants, and this table itself -
// so delegating either one is not "cover someone's day-to-day duties", it's recursively
// delegating the whole admin surface (the-fool finding #5, 2026-09-03). CUSTOMER is
// excluded for the same reason it's excluded from CREATABLE_ROLE_NAMES in
// users/dto/create-user.dto.ts - it isn't a staff-access role at all.
export const NON_GRANTABLE_ACCESS_ROLES: RoleName[] = [
  RoleName.SUPER_ADMIN,
  RoleName.SERVICE_HEAD,
  RoleName.CUSTOMER,
];

// A grant never lasts more than this from the moment it's issued - the-fool finding #2
// (2026-09-03): the vacation-coverage story this table exists for needs a natural
// cleanup point, not a manually-remembered revoke. Admins who need longer coverage
// re-grant rather than get a standing/permanent delegation.
export const MAX_ROLE_ACCESS_GRANT_DAYS = 90;

/**
 * "Extra role access" - lets an admin give a user everything a DIFFERENT role can do,
 * on top of (never instead of) their own real role, without changing who they actually
 * are in the system. Built for exactly the scenario the user described 2026-09-03: a
 * Technical Team Leader goes on leave, admin grants a capable CCE TL-level access for
 * the coverage window, then it expires (or is revoked early) and the CCE goes back to
 * being just a CCE - their own role, audit trail, and identity never changed.
 *
 * Deliberately a SEPARATE table/concept from UserPermissionGrant (QC_APPROVAL/
 * REWORK_APPROVAL): those are single named sign-off authorities with no role-based
 * floor-bypass (holding the grant is the ENTIRE gate). This table is the opposite shape
 * - it widens who satisfies an existing @Roles() list, it never narrows or replaces one.
 * See RolesGuard for exactly how the two interact (they don't - QC_APPROVAL/
 * REWORK_APPROVAL are untouched by this at all, on purpose - the-fool finding #3).
 */
@Entity('role_access_grants')
@Index(['userId', 'grantedRoleName'])
export class RoleAccessGrant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  // The role whose access this user is being given, on top of their own real role.
  @Column({ type: 'enum', enum: RoleName })
  grantedRoleName: RoleName;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'grantedByUserId' })
  grantedBy: User;

  @Column({ type: 'uuid' })
  grantedByUserId: string;

  @CreateDateColumn()
  grantedAt: Date;

  // Mandatory (the-fool finding #2) - every grant has a hard end date, capped at
  // MAX_ROLE_ACCESS_GRANT_DAYS from grantedAt. RolesGuard/RoleAccessService both treat a
  // grant whose expiresAt has passed as inactive, the same as an explicit revoke.
  @Column({ type: 'timestamp' })
  expiresAt: Date;

  // Grants are never deleted - revoking sets these instead, same pattern as
  // UserPermissionGrant, so "who could act as a TL on <date>" stays answerable forever.
  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'revokedByUserId' })
  revokedBy: User | null;

  @Column({ type: 'uuid', nullable: true })
  revokedByUserId: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;
}
