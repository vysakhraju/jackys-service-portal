// Thin wrappers over src/users/users.controller.ts (list/create/update/reactivate) plus
// the pre-existing PATCH /auth/users/:id/deactivate route (kept where it already was and
// tested - see UsersController's own comment on why the new routes live under /users
// instead of alongside it).
import { api } from './api';
import type { Role, User } from './types';
import type { CreateUserInput, UpdateUserInput } from './usersTypes';

const BASE = '/users';

export const listUsers = () => api.get<User[]>(BASE).then((r) => r.data);

export const listCreatableRoles = () => api.get<Role[]>(`${BASE}/roles`).then((r) => r.data);

export const createUser = (data: CreateUserInput) => api.post<User>(BASE, data).then((r) => r.data);

export const updateUser = (id: string, data: UpdateUserInput) =>
  api.patch<User>(`${BASE}/${id}`, data).then((r) => r.data);

export const reactivateUser = (id: string) => api.patch<User>(`${BASE}/${id}/reactivate`).then((r) => r.data);

export const deactivateUser = (id: string) => api.patch<User>(`/auth/users/${id}/deactivate`).then((r) => r.data);
