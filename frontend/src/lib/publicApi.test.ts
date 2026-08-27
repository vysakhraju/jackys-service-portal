import { describe, expect, it } from 'vitest';
import { publicApi } from './publicApi';
import { api } from './api';

// the-fool pre-mortem, Phase 5, finding #2: the public customer-facing pages must never
// share the staff `api` client's interceptors - no auth header attached, no redirect-to
// -/login on 401. This test fails loudly if someone "simplifies" publicApi.ts later by
// having it just re-export `api`.
describe('publicApi', () => {
  it('is a distinct axios instance from the staff api client', () => {
    expect(publicApi).not.toBe(api);
  });

  it('has no request interceptors (no auth header is ever attached)', () => {
    // axios stores interceptors as a private array on `.interceptors.request.handlers` -
    // not officially public API, but the simplest reliable way to assert "nothing is
    // registered" without also depending on the client's private module.
    const handlers = (publicApi.interceptors.request as unknown as { handlers: unknown[] }).handlers;
    expect(handlers.filter(Boolean)).toHaveLength(0);
  });

  it('has no response interceptors (no redirect-on-401 behavior)', () => {
    const handlers = (publicApi.interceptors.response as unknown as { handlers: unknown[] }).handlers;
    expect(handlers.filter(Boolean)).toHaveLength(0);
  });
});
