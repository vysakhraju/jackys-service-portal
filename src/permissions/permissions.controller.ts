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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PermissionsService } from './permissions.service';
import { GrantPermissionDto } from './dto/grant-permission.dto';
import { RevokePermissionDto } from './dto/revoke-permission.dto';
import { PermissionType } from './entities/user-permission-grant.entity';
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
// only SUPER_ADMIN/SERVICE_HEAD can decide who holds QC_APPROVAL/REWORK_APPROVAL.
const PERMISSION_ADMIN_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD'];

@ApiTags('permissions')
@Controller('permissions')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class PermissionsController {
  constructor(private permissionsService: PermissionsService) {}

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
}
