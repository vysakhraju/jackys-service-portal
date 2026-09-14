import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeGrant } from '../../test/fixtures';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/permissionsApi', () => ({
  grantPermission: vi.fn(),
  revokePermission: vi.fn(),
  listGrantsForUser: vi.fn(),
  listGrantsByType: vi.fn(),
}));
// #218/#254: the two "paste the user's id" fields are now NamePickers backed by this -
// GET /users is SUPER_ADMIN/SERVICE_HEAD-only, same as this whole page, so no fallback
// needed (unlike most other #218 pickers).
vi.mock('../../lib/usersApi', () => ({
  listUsers: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
import { grantPermission, listGrantsByType, listGrantsForUser, revokePermission } from '../../lib/permissionsApi';
import { listUsers } from '../../lib/usersApi';
import { PermissionsPage } from './PermissionsPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/qc-permissions/permissions']}>
        <PermissionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockUser(roleName: string) {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      id: 'admin-1',
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@jackys.com',
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

beforeEach(() => {
  vi.mocked(grantPermission).mockReset();
  vi.mocked(revokePermission).mockReset();
  vi.mocked(listGrantsForUser).mockReset();
  vi.mocked(listGrantsByType).mockReset();
  vi.mocked(listGrantsByType).mockResolvedValue([]);
  vi.mocked(listUsers).mockReset().mockResolvedValue([
    {
      id: 'user-9',
      firstName: 'Noor',
      lastName: 'Hassan',
      email: 'noor@jackys.com',
      employeeId: 'E9',
      phone: null,
      status: 'ACTIVE',
      role: { id: 'r-qc', name: 'QC_OFFICER', displayName: 'QC Officer' },
      lastLoginAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'user-2',
      firstName: 'Quinn',
      lastName: 'Carter',
      email: 'quinn@jackys.com',
      employeeId: 'E2',
      phone: null,
      status: 'ACTIVE',
      role: { id: 'r-tl', name: 'TECHNICAL_TEAM_LEADER', displayName: 'Technical Team Leader' },
      lastLoginAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ] as any);
});

describe('PermissionsPage - admin-only gating', () => {
  it('shows a restricted notice for a role outside PERMISSION_ADMIN_ROLES, with no admin controls', async () => {
    mockUser('QC_OFFICER');
    renderPage();
    expect(await screen.findByText(/restricted to Super Admin \/ Service Head/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Grant' })).not.toBeInTheDocument();
  });

  it('shows the full admin console for SERVICE_HEAD', async () => {
    mockUser('SERVICE_HEAD');
    renderPage();
    expect(await screen.findByText('Who currently holds a permission')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grant' })).toBeInTheDocument();
  });
});

describe('PermissionsPage - who holds a permission + revoke', () => {
  it('lists active holders returned by GET /permissions?type=X and revokes on click', async () => {
    mockUser('SUPER_ADMIN');
    vi.mocked(listGrantsByType).mockResolvedValue([makeGrant()]);
    vi.mocked(revokePermission).mockResolvedValue(makeGrant({ revokedAt: '2026-08-31T00:00:00Z' }));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Quinn Carter (quinn@jackys.com)')).toBeInTheDocument();
    await waitFor(() => expect(listGrantsByType).toHaveBeenCalledWith('QC_APPROVAL'));

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(revokePermission).toHaveBeenCalledWith({ userId: 'user-2', permissionType: 'QC_APPROVAL' }),
    );
  });

  it('shows the empty-state message when nobody holds the selected type', async () => {
    mockUser('SUPER_ADMIN');
    vi.mocked(listGrantsByType).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Nobody currently holds this permission.')).toBeInTheDocument();
  });
});

describe('PermissionsPage - grant form', () => {
  it('submits the picked user id, selected type, and notes to grantPermission', async () => {
    mockUser('SUPER_ADMIN');
    vi.mocked(grantPermission).mockResolvedValue(makeGrant());
    const user = userEvent.setup();
    renderPage();

    // "Permission type" also appears in the Who-holds filter above, and the user-picker
    // testid is shared with the history lookup below - scope to this section's own
    // <section> so the queries are unambiguous.
    const section = (await screen.findByText('Grant a permission')).closest('section') as HTMLElement;
    fireEvent.focus(within(section).getByTestId('name-picker-input'));
    fireEvent.click(await within(section).findByText(/Noor Hassan/));
    await user.selectOptions(within(section).getByLabelText('Permission type'), 'REWORK_APPROVAL');
    // The Notes field also renders a hint span inside the same <label> ("Optional - why
    // this grant was made."), which becomes part of the label's full accessible name -
    // match by prefix rather than the exact "Notes" string.
    await user.type(within(section).getByLabelText(/^Notes/), 'covering for QC officer on leave');
    await user.click(within(section).getByRole('button', { name: 'Grant' }));

    await waitFor(() =>
      expect(grantPermission).toHaveBeenCalledWith({
        userId: 'user-9',
        permissionType: 'REWORK_APPROVAL',
        notes: 'covering for QC officer on leave',
      }),
    );
  });

  it('blocks submission with no user picked (required validation still active)', async () => {
    mockUser('SUPER_ADMIN');
    const user = userEvent.setup();
    renderPage();

    const section = (await screen.findByText('Grant a permission')).closest('section') as HTMLElement;
    await user.click(within(section).getByRole('button', { name: 'Grant' }));

    expect(await within(section).findByText('Required')).toBeInTheDocument();
    expect(grantPermission).not.toHaveBeenCalled();
  });
});

describe('PermissionsPage - per-user grant history lookup', () => {
  it('fetches and renders a user\'s active and revoked grants with a status badge', async () => {
    mockUser('SUPER_ADMIN');
    vi.mocked(listGrantsForUser).mockResolvedValue([
      makeGrant({ id: 'g1', permissionType: 'QC_APPROVAL', revokedAt: null }),
      makeGrant({ id: 'g2', permissionType: 'REWORK_APPROVAL', revokedAt: '2026-08-15T00:00:00Z' }),
    ]);
    renderPage();

    const section = (await screen.findByText("Look up a user's full grant history")).closest('section') as HTMLElement;
    fireEvent.focus(within(section).getByTestId('name-picker-input'));
    fireEvent.click(await within(section).findByText(/Quinn Carter/));

    expect(await screen.findByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(listGrantsForUser).toHaveBeenCalledWith('user-2');
  });
});
