import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/authApi', () => ({ changePassword: vi.fn() }));

import { useAuth } from '../lib/auth';
import { changePassword } from '../lib/authApi';
import { UserMenu } from './UserMenu';

const logout = vi.fn();

function mockUser(overrides: Record<string, unknown> = {}) {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      id: 'user-1',
      firstName: 'Priya',
      lastName: 'Nair',
      email: 'priya@example.com',
      employeeId: 'E42',
      status: 'ACTIVE',
      lastLoginAt: '2026-09-14T10:00:00Z',
      role: { id: 'r1', name: 'CCE', displayName: 'Customer Care Executive' },
      ...overrides,
    },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout,
  } as any);
}

function renderMenu() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <UserMenu />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  logout.mockReset();
  vi.mocked(changePassword).mockReset();
});

describe('UserMenu', () => {
  it('renders nothing when there is no logged-in user', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, isLoading: false, isAuthenticated: false, login: vi.fn(), logout } as any);
    const { container } = renderMenu();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the user's name and designation on the trigger button", () => {
    mockUser();
    renderMenu();
    expect(screen.getByText('Priya Nair')).toBeInTheDocument();
    expect(screen.getByText('Customer Care Executive')).toBeInTheDocument();
  });

  it('opens a menu with My Profile, Change Password, and Log out', () => {
    mockUser();
    renderMenu();
    fireEvent.click(screen.getByText('Priya Nair'));

    expect(screen.getByRole('button', { name: 'My Profile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change Password' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  it('calls logout() when Log out is clicked', () => {
    mockUser();
    renderMenu();
    fireEvent.click(screen.getByText('Priya Nair'));
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(logout).toHaveBeenCalled();
  });

  it('My Profile opens a popup showing the account details', () => {
    mockUser();
    renderMenu();
    fireEvent.click(screen.getByText('Priya Nair'));
    fireEvent.click(screen.getByRole('button', { name: 'My Profile' }));

    expect(screen.getByRole('dialog', { name: 'Account settings' })).toBeInTheDocument();
    expect(screen.getByText('priya@example.com')).toBeInTheDocument();
    expect(screen.getByText('E42')).toBeInTheDocument();
  });

  it('Change Password opens the popup directly on the password tab', () => {
    mockUser();
    renderMenu();
    fireEvent.click(screen.getByText('Priya Nair'));
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
  });

  it('blocks submission and shows an error when the new password and confirmation differ', async () => {
    mockUser();
    renderMenu();
    fireEvent.click(screen.getByText('Priya Nair'));
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'oldpass1' } });
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'newpass1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'newpass2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText("New password and confirmation don't match.")).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('submits oldPassword/newPassword and closes the popup on success when they match', async () => {
    mockUser();
    vi.mocked(changePassword).mockResolvedValue(undefined);
    renderMenu();
    fireEvent.click(screen.getByText('Priya Nair'));
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'oldpass1' } });
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'newpass12' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'newpass12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith({ oldPassword: 'oldpass1', newPassword: 'newpass12' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Account settings' })).not.toBeInTheDocument());
  });
});
