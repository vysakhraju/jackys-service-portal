import { api } from './api';

export interface ChangePasswordInput {
  oldPassword: string;
  newPassword: string;
}

// Not folded into AuthContext (lib/auth.tsx) - that context is about WHO is logged in
// (login/logout/profile-on-load), not a one-off action a user takes mid-session from the
// new top-right user menu. Mirrors POST /auth/change-password's exact body shape.
export async function changePassword(input: ChangePasswordInput): Promise<void> {
  await api.post('/auth/change-password', input, { successMessage: 'Password changed successfully.' });
}
