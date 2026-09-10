import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./toast', () => ({
  notifySaveSuccess: vi.fn(),
}));

import { api } from './api';
import { notifySaveSuccess } from './toast';

// The automatic "Saved successfully" toast (2026-09-10) lives in the fulfilled half of the
// FIRST response interceptor api.ts registers - grabbed directly here and called with a
// fake response object, rather than hitting the network, since axios exposes registered
// interceptors via interceptors.response.handlers[n].fulfilled/rejected.
function fireSuccess(config: Record<string, unknown>) {
  const handler = (api.interceptors.response as unknown as { handlers: { fulfilled: (r: unknown) => unknown }[] })
    .handlers[0].fulfilled;
  return handler({ data: {}, status: 200, config });
}

beforeEach(() => {
  vi.mocked(notifySaveSuccess).mockClear();
});

describe('api - automatic success toast', () => {
  it('fires the default "Saved successfully." toast on a successful POST', () => {
    fireSuccess({ method: 'post' });
    expect(notifySaveSuccess).toHaveBeenCalledWith('Saved successfully.');
  });

  it('fires it on PUT and PATCH too', () => {
    fireSuccess({ method: 'put' });
    fireSuccess({ method: 'patch' });
    expect(notifySaveSuccess).toHaveBeenCalledTimes(2);
    expect(notifySaveSuccess).toHaveBeenNthCalledWith(1, 'Saved successfully.');
    expect(notifySaveSuccess).toHaveBeenNthCalledWith(2, 'Saved successfully.');
  });

  it('fires "Deleted successfully." on a successful DELETE', () => {
    fireSuccess({ method: 'delete' });
    expect(notifySaveSuccess).toHaveBeenCalledWith('Deleted successfully.');
  });

  it('does not fire on a GET', () => {
    fireSuccess({ method: 'get' });
    expect(notifySaveSuccess).not.toHaveBeenCalled();
  });

  it('does not fire when the request opted out with skipSuccessToast', () => {
    fireSuccess({ method: 'post', skipSuccessToast: true });
    expect(notifySaveSuccess).not.toHaveBeenCalled();
  });

  it('uses a custom successMessage when the request provides one', () => {
    fireSuccess({ method: 'post', successMessage: 'Estimate sent to customer.' });
    expect(notifySaveSuccess).toHaveBeenCalledWith('Estimate sent to customer.');
  });

  it('passes the response through unchanged', () => {
    const response = { data: { id: '1' }, status: 201, config: { method: 'post' } };
    const handler = (api.interceptors.response as unknown as { handlers: { fulfilled: (r: unknown) => unknown }[] })
      .handlers[0].fulfilled;
    expect(handler(response)).toBe(response);
  });
});
