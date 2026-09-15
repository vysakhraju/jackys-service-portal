import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  api: { post: vi.fn() },
}));

import { api } from './api';
import { changePassword } from './authApi';

beforeEach(() => {
  vi.mocked(api.post).mockReset();
});

describe('authApi', () => {
  it('changePassword posts to /auth/change-password with the old/new password body', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await changePassword({ oldPassword: 'old-pw', newPassword: 'new-pw' });
    expect(api.post).toHaveBeenCalledWith(
      '/auth/change-password',
      { oldPassword: 'old-pw', newPassword: 'new-pw' },
      { successMessage: 'Password changed successfully.' },
    );
  });
});
