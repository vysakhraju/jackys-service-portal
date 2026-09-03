import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { AuthProvider, useAuth } from './AuthContext';
import { api } from '../lib/api';
import { getAccessToken, getRefreshToken } from '../lib/tokenStorage';

// api.ts's own axios instance is mocked wholesale here - this test is about
// AuthProvider's state machine (login/logout/session-restore), not the interceptor's
// retry-on-401 wiring, so real HTTP/refresh timing doesn't need to be involved.
jest.mock('../lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn() },
  setOnSessionExpired: jest.fn(),
}));

const mockedApi = api as jest.Mocked<typeof api>;

const FAKE_USER = {
  id: 'user-1',
  firstName: 'Amina',
  lastName: 'Khan',
  email: 'amina@jackys.com',
  employeeId: 'E-1',
  phone: null,
  status: 'ACTIVE' as const,
  role: { id: 'role-1', name: 'TECHNICIAN_FIELD', displayName: 'Field Technician', description: null, permissions: [], isSystem: true },
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// A tiny probe component so tests can assert on AuthProvider's exposed state/actions
// without needing a real screen.
function Probe() {
  const { user, isLoading, isAuthenticated, login, logout } = useAuth();
  return (
    <>
      <Text testID="loading">{String(isLoading)}</Text>
      <Text testID="authenticated">{String(isAuthenticated)}</Text>
      <Text testID="user-name">{user ? `${user.firstName} ${user.lastName}` : 'none'}</Text>
      <Text testID="do-login" onPress={() => login('amina@jackys.com', 'secret123').catch(() => {})}>
        login
      </Text>
      <Text testID="do-logout" onPress={() => logout()}>
        logout
      </Text>
    </>
  );
}

async function renderProbe() {
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  // Start each test from a clean SecureStore (it's an in-memory mock shared across
  // the module, per jest.setup.js) so session-restore tests don't leak into others.
  const { clearTokens } = require('../lib/tokenStorage');
  await clearTokens();
});

describe('AuthProvider', () => {
  it('starts unauthenticated with no stored token, and stops loading', async () => {
    await renderProbe();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('logs in successfully: stores tokens and exposes the returned user', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { accessToken: 'access-1', refreshToken: 'refresh-1', user: FAKE_USER },
    });
    await renderProbe();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    await fireEvent.press(screen.getByTestId('do-login'));

    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('true'));
    expect(screen.getByTestId('user-name')).toHaveTextContent('Amina Khan');
    expect(mockedApi.post).toHaveBeenCalledWith('/auth/login', { email: 'amina@jackys.com', password: 'secret123' });
    await expect(getAccessToken()).resolves.toBe('access-1');
    await expect(getRefreshToken()).resolves.toBe('refresh-1');
  });

  it('a failed login (e.g. 401) leaves the session unauthenticated and propagates the error', async () => {
    mockedApi.post.mockRejectedValueOnce({ response: { status: 401 } });
    await renderProbe();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    await fireEvent.press(screen.getByTestId('do-login'));

    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    await expect(getAccessToken()).resolves.toBeNull();
  });

  it('logs out: clears tokens and returns to unauthenticated, even if the server call fails', async () => {
    mockedApi.post
      .mockResolvedValueOnce({ data: { accessToken: 'access-1', refreshToken: 'refresh-1', user: FAKE_USER } })
      .mockRejectedValueOnce(new Error('network down'));
    await renderProbe();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    await fireEvent.press(screen.getByTestId('do-login'));
    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('true'));

    await fireEvent.press(screen.getByTestId('do-logout'));

    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('false'));
    await expect(getAccessToken()).resolves.toBeNull();
  });

  it('restores a session on load when a token is already stored, via GET /auth/profile', async () => {
    const { setTokens } = require('../lib/tokenStorage');
    await setTokens('existing-access', 'existing-refresh');
    mockedApi.get.mockResolvedValueOnce({ data: FAKE_USER });

    await renderProbe();

    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('true'));
    expect(screen.getByTestId('user-name')).toHaveTextContent('Amina Khan');
    expect(mockedApi.get).toHaveBeenCalledWith('/auth/profile');
  });

  it('clears a stored token that GET /auth/profile rejects (e.g. revoked) rather than trusting it', async () => {
    const { setTokens } = require('../lib/tokenStorage');
    await setTokens('stale-access', 'stale-refresh');
    mockedApi.get.mockRejectedValueOnce({ response: { status: 401 } });

    await renderProbe();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    await expect(getAccessToken()).resolves.toBeNull();
  });
});
