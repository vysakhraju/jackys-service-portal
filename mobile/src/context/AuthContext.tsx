// Mirrors the web app's src/lib/auth.tsx AuthProvider/useAuth shape exactly, so anyone
// who has worked on the web app already knows this file. The one real difference:
// session expiry here is driven by api.ts's onSessionExpired callback (registered
// below) rather than a raw window.location.href redirect, since expo-router's
// Stack.Protected guard (src/app/_layout.tsx) is what actually moves the user to the
// login screen once isAuthenticated flips to false - this provider only owns the state.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setOnSessionExpired } from '../lib/api';
import { clearTokens, getAccessToken, setTokens } from '../lib/tokenStorage';
import type { TokenPair, User } from '../lib/types';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On first load, if we already have an access token (e.g. the app was killed and
  // reopened), ask the backend who that token belongs to rather than trusting
  // anything cached locally - GET /auth/profile is the source of truth for who's
  // logged in, exactly like the web app's equivalent effect.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getAccessToken();
      if (!token) {
        if (!cancelled) setIsLoading(false);
        return;
      }
      try {
        const response = await api.get<User>('/auth/profile');
        if (!cancelled) setUser(response.data);
      } catch {
        await clearTokens();
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // If a background API call's token refresh ever fails outright (refresh token
  // itself expired/revoked), api.ts calls this to drop the session - the
  // Stack.Protected guard in the root layout takes it from there.
  useEffect(() => {
    setOnSessionExpired(() => setUser(null));
    return () => setOnSessionExpired(null);
  }, []);

  async function login(email: string, password: string) {
    const response = await api.post<TokenPair>('/auth/login', { email, password });
    await setTokens(response.data.accessToken, response.data.refreshToken);
    setUser(response.data.user);
  }

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      // Best-effort - even if the server call fails (e.g. token already expired), the
      // local session still needs to end and send the technician back to login.
    }
    await clearTokens();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
