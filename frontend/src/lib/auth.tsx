import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, clearTokens, getAccessToken, setTokens } from './api';
import type { TokenPair, User } from './types';

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

  // On first load, if we already have an access token (e.g. the page was
  // refreshed), ask the backend who that token belongs to rather than
  // trusting anything we might have cached — GET /auth/profile is the
  // source of truth for the current user.
  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setIsLoading(false);
      return;
    }
    api
      .get<User>('/auth/profile')
      .then((response) => setUser(response.data))
      .catch(() => {
        clearTokens();
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const response = await api.post<TokenPair>('/auth/login', { email, password });
    setTokens(response.data.accessToken, response.data.refreshToken);
    setUser(response.data.user);
  }

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      // Best-effort — even if the server call fails (e.g. token already
      // expired), we still want to clear local state and send the user
      // back to the login screen.
    }
    clearTokens();
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
