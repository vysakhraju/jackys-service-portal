import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));

import { useAuth } from '../../lib/auth';
import { QcPermissionsLayout } from './QcPermissionsLayout';

// Live-tested finding (2026-09-16): a Customer Care Executive could see and click the
// "Permissions" tab, only to land on PermissionsPage's own restricted-access notice -
// every endpoint behind that screen is admin-only server-side. The fix filters the tab
// out at the layout level for non-admins, so that notice is never reached via normal
// navigation. These tests cover the tab list itself, not PermissionsPage's own guard
// (already covered by PermissionsPage.test.tsx).
function mockUser(roleName: string) {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      id: 'u1',
      firstName: 'Test',
      lastName: 'User',
      email: 'test@jackys.com',
      employeeId: 'E1',
      status: 'ACTIVE',
      lastLoginAt: null,
      role: { id: 'r1', name: roleName, displayName: roleName },
    },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
  } as any);
}

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/qc-permissions/qc']}>
      <Routes>
        <Route path="/qc-permissions" element={<QcPermissionsLayout />}>
          <Route path="qc" element={<div>QC page</div>} />
          <Route path="permissions" element={<div>Permissions page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('QcPermissionsLayout', () => {
  it('shows only the QC tab for a non-admin role (e.g. Customer Care Executive)', () => {
    mockUser('CUSTOMER_CARE_EXECUTIVE');
    renderLayout();

    expect(screen.getByRole('link', { name: 'QC' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Permissions' })).not.toBeInTheDocument();
  });

  it('shows both tabs for SUPER_ADMIN', () => {
    mockUser('SUPER_ADMIN');
    renderLayout();

    expect(screen.getByRole('link', { name: 'QC' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Permissions' })).toBeInTheDocument();
  });

  it('shows both tabs for SERVICE_HEAD', () => {
    mockUser('SERVICE_HEAD');
    renderLayout();

    expect(screen.getByRole('link', { name: 'QC' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Permissions' })).toBeInTheDocument();
  });

  it('shows only the QC tab when there is no authenticated user yet', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isLoading: true,
      isAuthenticated: false,
      login: vi.fn(),
      logout: vi.fn(),
    } as any);
    renderLayout();

    expect(screen.getByRole('link', { name: 'QC' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Permissions' })).not.toBeInTheDocument();
  });
});
