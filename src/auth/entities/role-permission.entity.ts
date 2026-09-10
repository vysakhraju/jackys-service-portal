import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from './user.entity';
import { RoleName } from './role.entity';

// Roles that can never appear as an editable column in the designation permission matrix -
// their access is hardcoded, not DB-driven, so a bad row (empty table, seed bug, admin
// mistake) can never lock either of them out. Deliberately reuses the exact same two-role
// (+CUSTOMER) shape as RoleAccessGrant.NON_GRANTABLE_ACCESS_ROLES: this codebase already
// treats SUPER_ADMIN + SERVICE_HEAD as one joint "admin tier" everywhere - every single
// @Roles() array that includes one includes the other - and CUSTOMER never logs into this
// staff app at all (see NON_GRANTABLE_ACCESS_ROLES's own comment for the CUSTOMER part).
// RolesGuard checks membership in this list BEFORE ever touching the RolePermission table.
export const MATRIX_LOCKED_ROLES: RoleName[] = [RoleName.SUPER_ADMIN, RoleName.SERVICE_HEAD, RoleName.CUSTOMER];

/**
 * One row = one role holds one capability (see capability-catalog.ts for the full list of
 * capability keys and what each replaces). Presence of a row is the only signal - there is
 * no "explicit false" row, a role simply has no row for a capability it doesn't hold.
 *
 * This is the designation-level permission matrix: "CCE can do Schedule + QC" cascades to
 * every user whose role is CCE, with no per-user configuration here at all. It is
 * deliberately a SEPARATE table from RoleAccessGrant (per-user delegation of a whole other
 * role's access, e.g. covering someone's leave) and from UserPermissionGrant (QC_APPROVAL/
 * REWORK_APPROVAL, per-user named sign-off authorities) - all three coexist, none replaces
 * either of the other two. See RolesGuard for how this one is actually consulted.
 *
 * Only ever touches roles NOT in MATRIX_LOCKED_ROLES - SUPER_ADMIN/SERVICE_HEAD/CUSTOMER
 * should never have rows written here; RolesGuard would ignore them anyway (its hardcoded
 * bypass runs first for the first two, and CUSTOMER never reaches an @Roles()-gated route),
 * but the admin-facing write path also refuses to write rows for these roles defensively -
 * see RolePermissionsService.setGrant().
 */
@Entity('role_permissions')
@Index(['roleId', 'capabilityKey'], { unique: true })
export class RolePermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  roleId: string;

  // Matches a key in capability-catalog.ts's CAPABILITY_CATALOG. Not a DB foreign key -
  // the catalog is code, not data (see capability-catalog.ts's own comment for why) - so
  // this is validated against the catalog at the service layer, not at the schema level.
  @Column({ length: 100 })
  capabilityKey: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'grantedByUserId' })
  grantedBy: User | null;

  @Column({ type: 'uuid', nullable: true })
  grantedByUserId: string | null;

  @CreateDateColumn()
  grantedAt: Date;
}
