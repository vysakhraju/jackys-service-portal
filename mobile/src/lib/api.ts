// Mirrors the web app's src/lib/api.ts request/refresh pattern as closely as the
// storage-layer difference allows (SecureStore is async, localStorage isn't - so the
// request interceptor awaits the token instead of reading it synchronously).
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from './config';
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './tokenStorage';
import type { TokenPair } from './types';

export const api = axios.create({
  baseURL: API_BASE_URL,
});

// A callback the auth layer registers so this module can react to a session that's
// unrecoverably gone (refresh itself failed) without importing the auth context here
// and creating a circular dependency between api.ts and AuthContext.tsx.
let onSessionExpired: (() => void) | null = null;
export function setOnSessionExpired(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// The access token is short-lived (15 min, per NFR-04) so a 401 usually just means it
// expired mid-visit, not that anything went wrong. Try the refresh token once, replay
// the original request, and only give up (clearing storage, bouncing to login) if that
// refresh itself fails.
let refreshInFlight: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }
  // The backend's RefreshStrategy reads the token from the body (`body.refreshToken`),
  // not an Authorization header - see src/auth/strategies/refresh.strategy.ts.
  const response = await axios.post<TokenPair>(`${API_BASE_URL}/auth/refresh`, { refreshToken });
  await setTokens(response.data.accessToken, response.data.refreshToken);
  return response.data.accessToken;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;

    if (error.response?.status === 401 && original && !original._retried && (await getRefreshToken())) {
      original._retried = true;
      try {
        // Multiple requests can 401 around the same moment (e.g. the schedule screen
        // firing several calls at once) - share one in-flight refresh instead of
        // racing several refresh calls against the same refresh token.
        refreshInFlight ??= refreshAccessToken().finally(() => {
          refreshInFlight = null;
        });
        const newAccessToken = await refreshInFlight;
        original.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(original);
      } catch {
        await clearTokens();
        onSessionExpired?.();
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  },
);
