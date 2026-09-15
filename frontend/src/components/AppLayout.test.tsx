import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
// Both no-op in this test - neither owns anything relevant to nav visibility, and
// NeedSpareNotifier opens a real socket connection that has no place in a unit test.
vi.mock('./NeedSpareNotifier', () => ({ NeedSpareNotifier: () => null }));
vi.mock('./NotificationPermissionBanner', () => ({ NotificationPermissionBanner: () => null }));

import { useAuth } from '../lib/auth';
import { useMyCapabilities } from '../lib/useMyCapabilities';
import { AppLayout } from './AppLayout';

function mockUser() {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      id: 'user-1',
      firstName: 'Test',
      lastName: 'User',
      email: 't@example.com',
      employeeId: 'E1',
      status: 'ACTIVE',
      lastLoginAt: null,
      role: { id: 'r1', name: 'CCE', displayName: 'CCE' },
    },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
  } as any);
}

function mockCapabilities(capabilities: string[], fullAccess = false, loading = false) {
  vi.mocked(useMyCapabilities).mockReturnValue({
    loading,
    error: null,
    fullAccess,
    capabilities,
    has: (key: string) => fullAccess || capabilities.includes(key),
    hasAny: (keys: string[]) => fullAccess || keys.some((k) => capabilities.includes(k)),
  });
}

function renderLayout() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <AppLayout />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Modification Request (2026-09-15): NAV_ITEMS used to render unconditionally regardless
// of role/capability - these tests cover the fix, gating each row on its module's
// capabilities (or fullAccess for the admin-only rows) exactly like AppLayout.tsx's own
// comment on NAV_ITEMS describes.
describe('AppLayout - nav items hidden per capability', () => {
  it('shows only Dashboard and Job Card Journey (the two ungated rows) to a caller with zero capabilities', () => {
    mockUser();
    mockCapabilities([]);
    renderLayout();

    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Job Card Journey' })).toBeInTheDocument();
    expect(screen.queryByText('Users')).not.toBeInTheDocument();
    expect(screen.queryByText('Master Data')).not.toBeInTheDocument();
    expect(screen.queryByText('Workshop')).not.toBeInTheDocument();
    expect(screen.queryByText('Inventory')).not.toBeInTheDocument();
    expect(screen.queryByText('QC & Permissions')).not.toBeInTheDocument();
  });

  it('shows Workshop but not Inventory to a role holding only a Workshop capability', () => {
    mockUser();
    mockCapabilities(['WORKSHOP_ACTION']);
    renderLayout();

    expect(screen.getByRole('link', { name: 'Workshop' })).toBeInTheDocument();
    expect(screen.queryByText('Inventory')).not.toBeInTheDocument();
  });

  it('shows Inventory but not Workshop to a role holding only INVENTORY_VIEW', () => {
    mockUser();
    mockCapabilities(['INVENTORY_VIEW']);
    renderLayout();

    expect(screen.getByRole('link', { name: 'Inventory' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Workshop' })).not.toBeInTheDocument();
  });

  it('hides Users and the Permissions half of QC & Permissions from a non-admin, even one holding QC_GATE_ACCESS', () => {
    mockUser();
    mockCapabilities(['QC_GATE_ACCESS']);
    renderLayout();

    expect(screen.queryByText('Users')).not.toBeInTheDocument();
    // QC_GATE_ACCESS alone is still a real reason to open "QC & Permissions" (the QC tab) -
    // PermissionsPage itself still blocks the Permissions tab for a non-admin, same as today.
    expect(screen.getByRole('link', { name: 'QC & Permissions' })).toBeInTheDocument();
  });

  it('shows every row to a fullAccess (Super Admin / Service Head) user, Users included', () => {
    mockUser();
    mockCapabilities([], true);
    renderLayout();

    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Master Data' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Workshop' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Inventory' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'QC & Permissions' })).toBeInTheDocument();
  });

  it('shows every row while the capability check is still loading, to avoid a hide-then-show flash', () => {
    mockUser();
    mockCapabilities([], false, true);
    renderLayout();

    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Workshop' })).toBeInTheDocument();
  });
});
