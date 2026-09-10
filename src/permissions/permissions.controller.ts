import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  ParseUUIDPipe,
  ParseEnumPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { PermissionsService } from './permissions.service';
import { RoleCapabilitiesService } from './role-capabilities.service';
import { RoleAccessService } from '../auth/role-access.service';
import { RolePermissionsService } from '../auth/role-permissions.service';
import { GrantPermissionDto } from './dto/grant-permission.dto';
import { RevokePermissionDto } from './dto/revoke-permission.dto';
import { SetRoleCapabilitiesDto } from './dto/set-role-capabilities.dto';
import { PermissionType } from './entities/user-permission-grant.entity';
import { GrantRoleAccessDto, GRANTABLE_ACCESS_ROLE_NAMES } from '../auth/dto/grant-role-access.dto';
import { RevokeRoleAccessDto } from '../auth/dto/revoke-role-access.dto';
import { RoleName } from '../auth/entities/role.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction } from '../auth/entities/audit-log.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

// Granting/revoking a permission is itself a high-trust admin action - deliberately the
// same narrow admin role set AuthController uses for deactivateUser()/seed-roles, NOT the
// broader office-staff role sets used elsewhere. This is what makes "admin control" real:
// only SUPER_ADMIN/SERVICE_HEAD can decide who holds QC_APPROVAL/REWORK_APPROVAL, and
// (2026-09-03) who holds delegated "extra role access" - the same admin gate for both,
// since both are ultimately "who gets more access than their own role gives them".
const PERMISSION_ADMIN_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD'];

@ApiTags('permissions')
@Controller('permissions')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class PermissionsController {
  constructor(
    private permissionsService: PermissionsService,
    private roleAccessService: RoleAccessService,
    private roleCapabilitiesService: RoleCapabilitiesService,
    private rolePermissionsService: RolePermissionsService,
  ) {}

  @Post('grant')
  @Roles(...PERMISSION_ADMIN_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.PERMISSION_GRANT,
    entityType: 'UserPermissionGrant',
    getNewValues: (result) => ({ id: result?.id, userId: result?.userId, permissionType: result?.permissionType }),
  })
  @ApiOperation({ summary: "Grant a user a permission (QC_APPROVAL or REWORK_APPROVAL) - admin only, works regardless of the user's primary role" })
  @ApiResponse({ status: 201, description: 'Permission granted' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'User already holds an active grant of this type' })
  async grant(@Body() dto: GrantPermissionDto, @CurrentUser() user: User) {
    return this.permissionsService.grant(dto.userId, dto.permissionType, user.id, dto.notes);
  }

  @Post('revoke')
  @Roles(...PERMISSION_ADMIN_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.PERMISSION_REVOKE,
    entityType: 'UserPermissionGrant',
    getNewValues: (result) => ({ id: result?.id, userId: result?.userId, permissionType: result?.permissionType }),
  })
  @ApiOperation({ summary: 'Revoke a previously granted permission - admin only' })
  @ApiResponse({ status: 200, description: 'Permission revoked' })
  @ApiResponse({ status: 404, description: 'No active grant of this type found for this user' })
  async revoke(@Body() dto: RevokePermissionDto, @CurrentUser() user: User) {
    return this.permissionsService.revoke(dto.userId, dto.permissionType, user.id, dto.notes);
  }

  @Get('users/:userId')
  @Roles(...PERMISSION_ADMIN_ROLES)
  @ApiOperation({ summary: "List a user's full grant history (active and revoked)" })
  @ApiResponse({ status: 200, description: 'Grant history, most recent first' })
  async listForUser(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.permissionsService.listGrantsForUser(userId);
  }

  @Get()
  @Roles(...PERMISSION_ADMIN_ROLES)
  @ApiQuery({ name: 'type', enum: PermissionType, required: true })
  @ApiOperation({ summary: 'List everyone currently holding a given permission type (e.g. who can QC-approve today)' })
  @ApiResponse({ status: 200, description: 'Active grants of this type' })
  async listByType(@Query('type') type: PermissionType) {
    return this.permissionsService.listGrantsByType(type);
  }

  // --- "Extra role access" (2026-09-03) --------------------------------------------
  // Delegates a role's access to a user who doesn't hold it, without changing their
  // actual role - built for the "TL goes on leave, admin covers with a capable CCE"
  // scenario. See RoleAccessGrant's own doc comment and RolesGuard for the mechanics.
  // Deliberately its own set of endpoints/entity, not folded into grant/revoke above -
  // QC_APPROVAL/REWORK_APPROVAL are single sign-off authorities with no role-based floor,
  // this is the opposite shape (widens an existing @Roles() list). Same admin gate either
  // way, so this stays on the same controller as one coherent "admin-assignable access"
  // surface for the frontend.

  @Get('roles/grantable')
  @Roles(...PERMISSION_ADMIN_ROLES)
  @ApiOperation({ summary: 'List every role an admin may delegate through role-access grants (excludes SUPER_ADMIN, SERVICE_HEAD, CUSTOMER)' })
  @ApiResponse({ status: 200, description: 'Grantable roles' })
  async listGrantableRoles() {
    return this.roleAccessService.listGrantableRoles();
  }

  @Get('roles/:roleName/capabilities')
  @Roles(...PERMISSION_ADMIN_ROLES)
  @ApiParam({ name: 'roleName', enum: RoleName })
  @ApiOperation({ summary: 'Live preview of every endpoint a role can currently reach, grouped by module - built from the real @Roles()/route metadata, not a hand-maintained list. Shown before an admin confirms a role-access grant.' })
  @ApiResponse({ status: 200, description: 'Capabilities grouped by module' })
  @ApiResponse({ status: 400, description: 'roleName is not a real role' })
  async getRoleCapabilities(@Param('roleName', new ParseEnumPipe(RoleName)) roleName: RoleName) {
    return this.roleCapabilitiesService.getCapabilitiesForRole(roleName);
  }

  @Post('role-access/grant')
  @Roles(...PERMISSION_ADMIN_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.ROLE_ACCESS_GRANT,
    entityType: 'RoleAccessGrant',
    getNewValues: (result) => ({ id: result?.id, userId: result?.userId, grantedRoleName: result?.grantedRoleName, expiresAt: result?.expiresAt }),
  })
  @ApiOperation({ summary: `Delegate a role's access to a user, on top of their own real role. Requires an expiry (max 90 days) - there is no standing/permanent grant. Grantable roles: ${GRANTABLE_ACCESS_ROLE_NAMES.join(', ')}.` })
  @ApiResponse({ status: 201, description: 'Role access granted' })
  @ApiResponse({ status: 400, description: 'expiresAt missing/invalid, in the past, or more than 90 days out' })
  @ApiResponse({ status: 403, description: 'The role is not delegatable, or you tried to grant yourself access' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'User already holds active delegated access to this role' })
  async grantRoleAccess(@Body() dto: GrantRoleAccessDto, @CurrentUser() user: User) {
    return this.roleAccessService.grant(dto.userId, dto.roleName as RoleName, dto.expiresAt, user.id, dto.notes);
  }

  @Post('role-access/revoke')
  @Roles(...PERMISSION_ADMIN_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.ROLE_ACCESS_REVOKE,
    entityType: 'RoleAccessGrant',
    getNewValues: (result) => ({ id: result?.id, userId: result?.userId, grantedRoleName: result?.grantedRoleName }),
  })
  @ApiOperation({ summary: 'Revoke a previously granted role-access delegation, before it expires on its own' })
  @ApiResponse({ status: 200, description: 'Role access revoked' })
  @ApiResponse({ status: 404, description: 'No active delegated access to this role found for this user' })
  async revokeRoleAccess(@Body() dto: RevokeRoleAccessDto, @CurrentUser() user: User) {
    return this.roleAccessService.revoke(dto.userId, dto.roleName as RoleName, user.id, dto.notes);
  }

  @Get('role-access/users/:userId')
  @Roles(...PERMISSION_ADMIN_ROLES)
  @ApiOperation({ summary: "List a user's full role-access grant history (active, expired, and revoked)" })
  @ApiResponse({ status: 200, description: 'Grant history, most recent first' })
  async listRoleAccessForUser(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.roleAccessService.listForUser(userId);
  }

  @Get('role-access/roles/:roleName')
  @Roles(...PERMISSION_ADMIN_ROLES)
  @ApiParam({ name: 'roleName', enum: RoleName })
  @ApiOperation({ summary: 'List everyone currently holding delegated access to a given role' })
  @ApiResponse({ status: 200, description: 'Active role-access grants for this role' })
  @ApiResponse({ status: 400, description: 'roleName is not a real role' })
  async listRoleAccessByRole(@Param('roleName', new ParseEnumPipe(RoleName)) roleName: RoleName) {
    return this.roleAccessService.listByRole(roleName);
  }

  // --- Designation permission matrix (2026-09-10) -----------------------------------
  // "CCE gets Schedule + QC access, every user with that role gets it" - role-level,
  // cascading capabilities, as opposed to role-access above (per-USER whole-role
  // delegation) or grant/revoke above (per-USER named sign-off authority). See
  // RolePermission's own doc comment for the full three-way distinction. Same admin gate
  // as everything else on this controller, on purpose (the-fool finding, 2026-09-10): this
  // is the screen that fixes a broken matrix, so it can never depend on the matrix itself.

  @Get('role-permissions/roles')
  @Roles(...PERMISSION_ADMIN_ROLES)
  @ApiOperation({ summary: 'List every role that can appear as an editable column in the designation permission matrix (excludes SUPER_ADMIN, SERVICE_HEAD, CUSTOMER - always full access, hardcoded)' })
  @ApiResponse({ status: 200, description: 'Editable roles' })
  async listRolePermissionRoles() {
    return this.rolePermissionsService.listEditableRoles();
  }

  @Get('role-permissions/matrix')
  @Roles(...PERMISSION_ADMIN_ROLES)
  @ApiOperation({ summary: 'The full capability catalog, each entry listing which role ids currently hold it. Not-yet-migrated capabilities are included (migrated: false) so the UI can show them as "coming soon".' })
  @ApiResponse({ status: 200, description: 'Capability catalog with current grants' })
  async getRolePermissionsMatrix() {
    return this.rolePermissionsService.getMatrix();
  }

  @Get('role-permissions/roles/:roleId/users')
  @Roles(...PERMISSION_ADMIN_ROLES)
  @ApiParam({ name: 'roleId', type: String })
  @ApiOperation({ summary: 'Reference-only list of every user currently holding this role, shown alongside the capability checklist so an admin sees who a change actually affects before saving' })
  @ApiResponse({ status: 200, description: 'Users holding this role' })
  async listUsersForRolePermission(@Param('roleId', ParseUUIDPipe) roleId: string) {
    return this.rolePermissionsService.listUsersForRole(roleId);
  }

  @Post('role-permissions/roles/:roleId')
  @Roles(...PERMISSION_ADMIN_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.ROLE_CAPABILITIES_UPDATE,
    entityType: 'RolePermission',
    getEntityId: (args) => args.params?.roleId,
    getNewValues: (result) => result,
  })
  @ApiParam({ name: 'roleId', type: String })
  @ApiOperation({ summary: "Sets a role's complete capability set in one call (tick-and-save) - cascades to every user holding that role immediately, no per-user configuration" })
  @ApiResponse({ status: 201, description: '{ granted: string[], revoked: string[] }' })
  @ApiResponse({ status: 400, description: 'Role not found' })
  @ApiResponse({ status: 403, description: 'Role always has full access and cannot be edited here' })
  async setRolePermissionCapabilities(
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: SetRoleCapabilitiesDto,
    @CurrentUser() user: User,
  ) {
    return this.rolePermissionsService.setRoleCapabilities(roleId, dto.capabilityKeys, user.id);
  }
}
