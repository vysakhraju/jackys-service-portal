// Mirrors src/users/dto/create-user.dto.ts and update-user.dto.ts, and what
// UsersController actually returns (passwordHash/refreshTokenHash always stripped
// server-side before the response leaves the controller - see its own comments).
// Reuses the existing User/Role shapes from lib/types.ts rather than redefining them.

// Same admin role set as UsersController's USER_ADMIN_ROLES / PermissionsPage's
// PERMISSION_ADMIN_ROLES - only SUPER_ADMIN/SERVICE_HEAD can reach this screen at all
// (every endpoint here is admin-only server-side too).
export const USER_MANAGEMENT_ADMIN_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD'];

export interface CreateUserInput {
  firstName: string;
  lastName: string;
  email: string;
  employeeId?: string;
  phone?: string;
  // Temporary password, set and shared by the admin directly - see CreateUserDto's own
  // comment for why (no email/invite-link flow exists in this app).
  password: string;
  roleName: string;
}

// Email is deliberately not editable here - see UpdateUserDto's own comment. Profile
// fields (name/employeeId/phone) and role are the only things this screen edits in this
// round; both can be sent together or separately in one PATCH.
export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  employeeId?: string;
  phone?: string;
  roleName?: string;
}
