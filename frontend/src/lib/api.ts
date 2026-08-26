import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from './config';
import type { TokenPair } from './types';

// Keys used in localStorage. Centralized here so nothing else in the app has to
// remember the exact string — see also lib/auth.tsx, which is the only other
// place that touches these directly.
const ACCESS_TOKEN_KEY = 'jsp_access_token';
const REFRESH_TOKEN_KEY = 'jsp_refresh_token';

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export const api = axios.create({
  baseURL: API_BASE_URL,
});

// Attach the current JWT to every outgoing request, if we have one.
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// The access token is short-lived (15 min, per NFR-04) so a 401 usually just
// means it expired mid-session, not that the user did anything wrong. Try the
// refresh token once, replay the original request, and only give up (clearing
// storage so ProtectedRoute bounces to /login) if that refresh itself fails.
let refreshInFlight: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }
  // The backend's RefreshStrategy reads the token from the body (`body.refreshToken`),
  // not an Authorization header — see src/auth/strategies/refresh.strategy.ts.
  const response = await axios.post<TokenPair>(`${API_BASE_URL}/auth/refresh`, {
    refreshToken,
  });
  setTokens(response.data.accessToken, response.data.refreshToken);
  return response.data.accessToken;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;

    if (error.response?.status === 401 && original && !original._retried && getRefreshToken()) {
      original._retried = true;
      try {
        // Multiple requests can 401 around the same moment (e.g. a page that
        // fires several calls at once) — share one in-flight refresh instead
        // of racing several refresh calls against the same refresh token.
        refreshInFlight ??= refreshAccessToken().finally(() => {
          refreshInFlight = null;
        });
        const newAccessToken = await refreshInFlight;
        original.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(original);
      } catch {
        clearTokens();
        window.location.href = '/login';
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  },
);
