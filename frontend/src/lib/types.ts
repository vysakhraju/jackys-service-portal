// Shared shapes that mirror the backend's real DTOs (see src/auth/entities on the API side).
// Keeping these in one file means every screen agrees on what a "user" or "role" looks like.

export interface Role {
  id: string;
  name: string; // e.g. "SUPER_ADMIN", "CCE", "TECHNICIAN_FIELD" — see backend RoleName enum
  displayName: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
}

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  employeeId: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  role: Role;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  user: User;
}
