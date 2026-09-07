// Holistic test-master pass (2026-09-07): api.ts's 401-refresh interceptor had NO
// coverage anywhere in the suite - AuthContext.test.tsx (the only other place that
// touches this module) mocks '../lib/api' wholesale, so the actual interceptor logic
// itself - the retry-once guard, the shared in-flight refresh dedup, and the
// clear-tokens-and-bounce-to-login path when a refresh itself fails - had never been
// exercised. This is real, security-relevant behavior (an infinite refresh loop, a
// session that never clears, or a silently-swallowed error would all be genuine
// production bugs), so it gets its own dedicated file.
//
// Testing approach: rather than reaching into axios's internal interceptor-handler
// array (an implementation detail that would make these tests fragile across axios
// versions), this drives the REAL `api` instance through its public interface
// (`api.get`/`api.post`) with a custom `adapter` swapped in - exactly the layer real
// HTTP/XHR transport sits at, so axios's own request/response pipeline (interceptors,
// `settle()`'s reject-on-4xx/5xx, config merging) all run for real. Only the network
// call itself is faked.
import axios, { type InternalAxiosRequestConfig } from 'axios';
import { api, setOnSessionExpired } from './api';
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './tokenStorage';

jest.mock('./tokenStorage', () => ({
  getAccessToken: jest.fn(),
  getRefreshToken: jest.fn(),
  setTokens: jest.fn(),
  clearTokens: jest.fn(),
}));

const mockedGetAccessToken = getAccessToken as jest.Mock;
const mockedGetRefreshToken = getRefreshToken as jest.Mock;
const mockedSetTokens = setTokens as jest.Mock;
const mockedClearTokens = clearTokens as jest.Mock;

type FakeResponse = { status: number; data?: unknown } | Error;

// Queues one fake "network" response per call, in order - the last entry repeats if
// more calls come in than responses were queued. Real http/xhr adapters call axios's
// internal `settle()` themselves after getting a response - a custom `adapter`
// function is expected to implement that same contract, so this replicates it
// directly against `config.validateStatus` rather than always resolving (a naive
// always-resolve fake would never actually reject on a 401/500, defeating the point
// of testing the retry-on-401 interceptor at all).
function queueAdapter(responses: FakeResponse[]) {
  let call = 0;
  const calls: InternalAxiosRequestConfig[] = [];
  const fn = jest.fn(async (config: InternalAxiosRequestConfig) => {
    calls.push(config);
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    if (next instanceof Error) throw next;
    const response = { data: next.data, status: next.status, statusText: '', headers: {}, config };
    if (!config.validateStatus || config.validateStatus(next.status)) {
      return response;
    }
    const error = Object.assign(new Error(`Request failed with status code ${next.status}`), {
      isAxiosError: true,
      config,
      response,
    });
    throw error;
  });
  return { fn, calls };
}

const originalApiAdapter = api.defaults.adapter;
const originalAxiosAdapter = axios.defaults.adapter;

beforeEach(() => {
  jest.clearAllMocks();
  setOnSessionExpired(null);
  mockedGetAccessToken.mockResolvedValue(null);
  mockedGetRefreshToken.mockResolvedValue(null);
});

afterEach(() => {
  api.defaults.adapter = originalApiAdapter;
  axios.defaults.adapter = originalAxiosAdapter;
});

describe('request interceptor', () => {
  it('attaches a Bearer Authorization header when an access token is stored', async () => {
    mockedGetAccessToken.mockResolvedValue('token-123');
    const { fn, calls } = queueAdapter([{ status: 200, data: { ok: true } }]);
    api.defaults.adapter = fn;

    await api.get('/technician/schedule');

    expect((calls[0].headers as Record<string, string>).Authorization).toBe('Bearer token-123');
  });

  it('sends no Authorization header when no access token is stored', async () => {
    mockedGetAccessToken.mockResolvedValue(null);
    const { fn, calls } = queueAdapter([{ status: 200, data: { ok: true } }]);
    api.defaults.adapter = fn;

    await api.get('/technician/schedule');

    expect((calls[0].headers as Record<string, string>).Authorization).toBeUndefined();
  });
});

describe('response interceptor - 401 refresh-and-retry', () => {
  it('refreshes the token once and replays the original request on a 401', async () => {
    mockedGetAccessToken.mockResolvedValueOnce('expired-token').mockResolvedValueOnce('new-token');
    mockedGetRefreshToken.mockResolvedValue('refresh-token-1');
    const { fn: apiAdapter, calls: apiCalls } = queueAdapter([
      { status: 401, data: { message: 'Unauthorized' } },
      { status: 200, data: { id: 'visit-1' } },
    ]);
    api.defaults.adapter = apiAdapter;
    const { fn: refreshAdapter, calls: refreshCalls } = queueAdapter([
      { status: 200, data: { accessToken: 'new-token', refreshToken: 'refresh-token-2' } },
    ]);
    axios.defaults.adapter = refreshAdapter;

    const response = await api.get('/technician/visits/appt-1');

    expect(response.data).toEqual({ id: 'visit-1' });
    expect(refreshCalls).toHaveLength(1);
    expect(refreshCalls[0].url).toBe('http://localhost:3000/api/v1/auth/refresh');
    expect(refreshCalls[0].data).toBe(JSON.stringify({ refreshToken: 'refresh-token-1' }));
    expect(mockedSetTokens).toHaveBeenCalledWith('new-token', 'refresh-token-2');
    // The replayed request (the 2nd call into the api adapter) must carry the NEW token.
    expect(apiCalls).toHaveLength(2);
    expect((apiCalls[1].headers as Record<string, string>).Authorization).toBe('Bearer new-token');
  });

  it('does not attempt a refresh when there is no refresh token stored', async () => {
    mockedGetAccessToken.mockResolvedValue('expired-token');
    mockedGetRefreshToken.mockResolvedValue(null);
    const { fn: apiAdapter, calls: apiCalls } = queueAdapter([{ status: 401, data: { message: 'Unauthorized' } }]);
    api.defaults.adapter = apiAdapter;
    const refreshAdapter = jest.fn();
    axios.defaults.adapter = refreshAdapter;

    await expect(api.get('/technician/schedule')).rejects.toMatchObject({ response: { status: 401 } });

    expect(refreshAdapter).not.toHaveBeenCalled();
    expect(apiCalls).toHaveLength(1);
    expect(mockedSetTokens).not.toHaveBeenCalled();
    expect(mockedClearTokens).not.toHaveBeenCalled();
  });

  it('clears tokens and fires the session-expired handler when the refresh call itself fails, rejecting with the ORIGINAL 401', async () => {
    const sessionExpired = jest.fn();
    setOnSessionExpired(sessionExpired);
    mockedGetAccessToken.mockResolvedValue('expired-token');
    mockedGetRefreshToken.mockResolvedValue('stale-refresh-token');
    const { fn: apiAdapter } = queueAdapter([{ status: 401, data: { message: 'Unauthorized' } }]);
    api.defaults.adapter = apiAdapter;
    const { fn: refreshAdapter } = queueAdapter([{ status: 401, data: { message: 'Refresh token expired' } }]);
    axios.defaults.adapter = refreshAdapter;

    const rejection = await api.get('/technician/schedule').catch((err) => err);

    // The promise rejects with the ORIGINAL request's 401, not the refresh call's own
    // error - `refreshAccessToken()`'s rejection is caught and translated into the
    // session-expired path, while `error` in scope is still the original.
    expect(rejection.config.url).toBe('/technician/schedule');
    expect(mockedClearTokens).toHaveBeenCalledTimes(1);
    expect(sessionExpired).toHaveBeenCalledTimes(1);
    expect(mockedSetTokens).not.toHaveBeenCalled();
  });

  it('does not loop into a second refresh when the replayed request 401s again (the _retried guard)', async () => {
    mockedGetAccessToken.mockResolvedValue('expired-token');
    mockedGetRefreshToken.mockResolvedValue('refresh-token-1');
    const { fn: apiAdapter, calls: apiCalls } = queueAdapter([
      { status: 401, data: { message: 'Unauthorized' } },
      { status: 401, data: { message: 'Still unauthorized after refresh' } },
    ]);
    api.defaults.adapter = apiAdapter;
    const { fn: refreshAdapter, calls: refreshCalls } = queueAdapter([
      { status: 200, data: { accessToken: 'new-token', refreshToken: 'refresh-token-2' } },
    ]);
    axios.defaults.adapter = refreshAdapter;

    await expect(api.get('/technician/schedule')).rejects.toMatchObject({ response: { status: 401 } });

    // Exactly one refresh attempt and exactly two api calls (original + one retry) -
    // a second 401 on the retried request must NOT trigger a second refresh cycle.
    expect(refreshCalls).toHaveLength(1);
    expect(apiCalls).toHaveLength(2);
  });

  it('shares one in-flight refresh across two requests that 401 around the same moment', async () => {
    mockedGetAccessToken.mockResolvedValue('expired-token');
    mockedGetRefreshToken.mockResolvedValue('refresh-token-1');
    const { fn: apiAdapter } = queueAdapter([
      { status: 401, data: {} },
      { status: 401, data: {} },
      { status: 200, data: { from: 'first-retry' } },
      { status: 200, data: { from: 'second-retry' } },
    ]);
    api.defaults.adapter = apiAdapter;
    let refreshCallCount = 0;
    axios.defaults.adapter = jest.fn(async (config) => {
      refreshCallCount += 1;
      return {
        data: { accessToken: 'new-token', refreshToken: 'refresh-token-2' },
        status: 200,
        statusText: '',
        headers: {},
        config,
      };
    });

    const [first, second] = await Promise.all([api.get('/a'), api.get('/b')]);

    expect(refreshCallCount).toBe(1);
    expect([first.data, second.data]).toEqual(
      expect.arrayContaining([{ from: 'first-retry' }, { from: 'second-retry' }]),
    );
  });

  it('passes through a non-401 error without attempting a refresh', async () => {
    mockedGetAccessToken.mockResolvedValue('a-token');
    const { fn: apiAdapter } = queueAdapter([{ status: 500, data: { message: 'Internal error' } }]);
    api.defaults.adapter = apiAdapter;

    await expect(api.get('/technician/schedule')).rejects.toMatchObject({ response: { status: 500 } });

    expect(mockedGetRefreshToken).not.toHaveBeenCalled();
    expect(mockedSetTokens).not.toHaveBeenCalled();
  });

  it('setOnSessionExpired(null) unregisters a previously-registered handler', async () => {
    const sessionExpired = jest.fn();
    setOnSessionExpired(sessionExpired);
    setOnSessionExpired(null);
    mockedGetAccessToken.mockResolvedValue('expired-token');
    mockedGetRefreshToken.mockResolvedValue('stale-refresh-token');
    const { fn: apiAdapter } = queueAdapter([{ status: 401, data: {} }]);
    api.defaults.adapter = apiAdapter;
    const { fn: refreshAdapter } = queueAdapter([new Error('Network Error')]);
    axios.defaults.adapter = refreshAdapter;

    await api.get('/technician/schedule').catch(() => undefined);

    expect(sessionExpired).not.toHaveBeenCalled();
    // clearTokens still runs - only the (unregistered) callback is skipped.
    expect(mockedClearTokens).toHaveBeenCalledTimes(1);
  });
});
