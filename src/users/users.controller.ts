import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

// Same admin role set as AuthController.deactivateUser()/PermissionsController's
// PERMISSION_ADMIN_ROLES - only SUPER_ADMIN/SERVICE_HEAD can create accounts, change
// someone's role, or reactivate one. Deliberately not the broader per-module role sets
// used elsewhere (CCE, TL, etc.) - creating accounts and reassigning roles is itself a
// high-trust action, same reasoning PermissionsController documents for grant/revoke.
//
// Routed separately from AuthController's existing /auth/users/:id/deactivate (kept
// where it is, already tested) - new endpoints live under /users instead, matching what
// a frontend "usersApi.ts" would naturally call.
const USER_ADMIN_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD'];

@ApiTags('users')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...USER_ADMIN_ROLES)
@ApiBearerAuth('JWT-auth')
export class UsersController {
  constructor(private authService: AuthService) {}

  @Get()
  @ApiOperation({ summary: 'List every user (roster view) - name, email, employee ID, role, status' })
  @ApiResponse({ status: 200, description: 'All users, newest first' })
  async list() {
    return this.authService.listUsers();
  }

  @Get('roles')
  @ApiOperation({ summary: 'List roles selectable when creating/editing a user (excludes CUSTOMER - see CreateUserDto)' })
  @ApiResponse({ status: 200, description: 'Every role except CUSTOMER' })
  async listRoles() {
    return this.authService.listCreatableRoles();
  }

  @Post()
  @ApiOperation({ summary: 'Create a staff user with a temporary password and a role' })
  @ApiResponse({ status: 201, description: 'User created' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @ApiResponse({ status: 409, description: 'A user with this email or employee ID already exists' })
  async create(@Body() dto: CreateUserDto, @Request() req: any) {
    const user = await this.authService.createUser(
      {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        employeeId: dto.employeeId,
        phone: dto.phone,
        // AuthService.createUser() re-hashes whatever plaintext password arrives in this
        // field (see its own doc comment) - it is never persisted or logged as-is.
        passwordHash: dto.password,
      } as any,
      dto.roleName,
      req,
    );
    const { passwordHash, refreshTokenHash, ...safeUser } = user;
    return safeUser;
  }

  @Patch(':id')
  @ApiOperation({ summary: "Edit a user's profile fields and/or role (not their own account, not email)" })
  @ApiResponse({ status: 200, description: 'User updated' })
  @ApiResponse({ status: 403, description: 'Cannot modify your own account from this screen' })
  @ApiResponse({ status: 404, description: 'User or role not found' })
  @ApiResponse({ status: 409, description: 'Employee ID already in use, or the user still holds open assignments tied to their current role' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() currentUser: User, @Request() req: any) {
    const user = await this.authService.updateUser(id, currentUser.id, dto, req);
    const { passwordHash, refreshTokenHash, ...safeUser } = user;
    return safeUser;
  }

  @Patch(':id/reactivate')
  @ApiOperation({ summary: 'Reactivate a previously deactivated user' })
  @ApiResponse({ status: 200, description: 'User reactivated' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'User is already active' })
  async reactivate(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    const user = await this.authService.reactivateUser(id, req);
    const { passwordHash, refreshTokenHash, ...safeUser } = user;
    return safeUser;
  }
}
