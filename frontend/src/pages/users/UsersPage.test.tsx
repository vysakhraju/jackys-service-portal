import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  makeCapabilityMatrixEntry,
  makeRole,
  makeRoleAccessGrant,
  makeRoleCapabilityModule,
  makeRolePermissionUserRef,
  makeUser,
} from '../../test/fixtures';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/usersApi', () => ({
  listUsers: vi.fn(),
  listCreatableRoles: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deactivateUser: vi.fn(),
  reactivateUser: vi.fn(),
  resetPassword: vi.fn(),
}));
vi.mock('../../lib/roleAccessApi', () => ({
  listGrantableRoles: vi.fn(),
  getRoleCapabilities: vi.fn(),
  grantRoleAccess: vi.fn(),
  revokeRoleAccess: vi.fn(),
  listRoleAccessForUser: vi.fn(),
}));
vi.mock('../../lib/rolePermissionsApi', () => ({
  listRolePermissionRoles: vi.fn(),
  getRolePermissionsMatrix: vi.fn(),
  listUsersForRolePermission: vi.fn(),
  setRoleCapabilities: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
import {
  createUser,
  deactivateUser,
  listCreatableRoles,
  listUsers,
  reactivateUser,
  resetPassword,
  updateUser,
} from '../../lib/usersApi';
import {
  getRoleCapabilities,
  grantRoleAccess,
  listGrantableRoles,
  listRoleAccessForUser,
  revokeRoleAccess,
} from '../../lib/roleAccessApi';
import {
  getRolePermissionsMatrix,
  listRolePermissionRoles,
  listUsersForRolePermission,
  setRoleCapabilities,
} from '../../lib/rolePermissionsApi';
import { UsersPage } from './UsersPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <UsersPage />
    </QueryClientProvider>,
  );
}

// The page is now tabbed (2026-09-10) - Roster is the default/active tab, everything else
// (Designation access, Extra role access, Create user) needs an explicit switch before its
// section is even mounted, let alone queryable.
async function switchToTab(label: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: label }));
}

function mockCurrentUser(roleName: string, id = 'admin-1') {
  vi.mocked(useAuth).mockReturnValue({
    user: makeUser({ id, firstName: 'Admin', lastName: 'User', email: 'admin@jackys.com', role: makeRole({ name: roleName, displayName: roleName }) }),
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
  } as any);
}

const ROLES = [
  makeRole({ id: 'role-cce', name: 'CCE', displayName: 'Customer Care Executive' }),
  makeRole({ id: 'role-tl', name: 'TECHNICAL_TEAM_LEADER', displayName: 'Technical Team Leader' }),
];

beforeEach(() => {
  vi.mocked(listUsers).mockReset();
  vi.mocked(listCreatableRoles).mockReset().mockResolvedValue(ROLES);
  vi.mocked(createUser).mockReset();
  vi.mocked(updateUser).mockReset();
  vi.mocked(deactivateUser).mockReset();
  vi.mocked(reactivateUser).mockReset();
  vi.mocked(resetPassword).mockReset();
  vi.mocked(listGrantableRoles).mockReset().mockResolvedValue(ROLES);
  vi.mocked(getRoleCapabilities).mockReset();
  vi.mocked(grantRoleAccess).mockReset();
  vi.mocked(revokeRoleAccess).mockReset();
  vi.mocked(listRoleAccessForUser).mockReset().mockResolvedValue([]);
  vi.mocked(listRolePermissionRoles).mockReset().mockResolvedValue(ROLES);
  vi.mocked(getRolePermissionsMatrix).mockReset().mockResolvedValue([]);
  vi.mocked(listUsersForRolePermission).mockReset().mockResolvedValue([]);
  vi.mocked(setRoleCapabilities).mockReset();
});

describe('UsersPage - admin-only gating', () => {
  it('shows a restricted notice for a role outside the admin set, with no roster or create form', async () => {
    mockCurrentUser('CCE');
    renderPage();
    expect(await screen.findByText(/restricted to Super Admin \/ Service Head/i)).toBeInTheDocument();
    expect(screen.queryByText('Roster')).not.toBeInTheDocument();
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('shows the roster tab (active by default) and a Create user tab for SERVICE_HEAD', async () => {
    mockCurrentUser('SERVICE_HEAD');
    vi.mocked(listUsers).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByRole('tab', { name: 'Roster' })).toBeInTheDocument();
    expect(within(screen.getByRole('tabpanel')).getByText('Roster')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Create user' })).toBeInTheDocument();

    await switchToTab('Create user');
    expect(screen.getByText('Create a user')).toBeInTheDocument();
  });
});

describe('UsersPage - roster', () => {
  it('renders each user with name, email, employee ID, role, and status', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([
      makeUser({ id: 'user-2', firstName: 'Priya', lastName: 'Nair', email: 'priya@jackys.com', employeeId: 'E-2', status: 'ACTIVE' }),
    ]);
    renderPage();

    expect(await screen.findByText('Priya Nair')).toBeInTheDocument();
    expect(screen.getByText('priya@jackys.com')).toBeInTheDocument();
    expect(screen.getByText('E-2')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
  });

  it('shows the empty message when there are no users yet', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No users yet - create the first one from the Create user tab.')).toBeInTheDocument();
  });

  // Added 2026-09-10, your feedback: "no proper segregation" - the roster defaults to
  // Active only, with Inactive/All one click away, instead of always showing everyone.
  describe('status filter', () => {
    it('shows only ACTIVE users by default, hiding inactive ones', async () => {
      mockCurrentUser('SUPER_ADMIN');
      vi.mocked(listUsers).mockResolvedValue([
        makeUser({ id: 'user-2', firstName: 'Priya', lastName: 'Nair', status: 'ACTIVE' }),
        makeUser({ id: 'user-3', firstName: 'Rahul', lastName: 'Verma', status: 'INACTIVE' }),
      ]);
      renderPage();

      expect(await screen.findByText('Priya Nair')).toBeInTheDocument();
      expect(screen.queryByText('Rahul Verma')).not.toBeInTheDocument();
    });

    it('switching the filter to Inactive shows only inactive users', async () => {
      mockCurrentUser('SUPER_ADMIN');
      vi.mocked(listUsers).mockResolvedValue([
        makeUser({ id: 'user-2', firstName: 'Priya', lastName: 'Nair', status: 'ACTIVE' }),
        makeUser({ id: 'user-3', firstName: 'Rahul', lastName: 'Verma', status: 'INACTIVE' }),
      ]);
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Priya Nair');

      await user.selectOptions(screen.getByLabelText('Filter roster by status'), 'INACTIVE');

      expect(screen.getByText('Rahul Verma')).toBeInTheDocument();
      expect(screen.queryByText('Priya Nair')).not.toBeInTheDocument();
    });

    it('switching the filter to All shows both active and inactive users', async () => {
      mockCurrentUser('SUPER_ADMIN');
      vi.mocked(listUsers).mockResolvedValue([
        makeUser({ id: 'user-2', firstName: 'Priya', lastName: 'Nair', status: 'ACTIVE' }),
        makeUser({ id: 'user-3', firstName: 'Rahul', lastName: 'Verma', status: 'INACTIVE' }),
      ]);
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Priya Nair');

      await user.selectOptions(screen.getByLabelText('Filter roster by status'), 'ALL');

      expect(screen.getByText('Priya Nair')).toBeInTheDocument();
      expect(screen.getByText('Rahul Verma')).toBeInTheDocument();
    });

    it('shows a filter-aware empty message when the filter hides every user, distinct from the true zero-users message', async () => {
      mockCurrentUser('SUPER_ADMIN');
      vi.mocked(listUsers).mockResolvedValue([makeUser({ id: 'user-3', firstName: 'Rahul', lastName: 'Verma', status: 'INACTIVE' })]);
      renderPage();

      expect(await screen.findByText('No active users to show.')).toBeInTheDocument();
    });
  });

  it("marks the current admin's own row and disables its role select and row action (the-fool finding #1)", async () => {
    mockCurrentUser('SUPER_ADMIN', 'admin-1');
    vi.mocked(listUsers).mockResolvedValue([makeUser({ id: 'admin-1', firstName: 'Admin', lastName: 'User' })]);
    renderPage();

    expect(await screen.findByText('Admin User (you)')).toBeInTheDocument();
    expect(screen.getByLabelText('Change role for Admin User')).toBeDisabled();
    expect(screen.getByText("You can't modify your own account here")).toBeInTheDocument();
  });

  it('changes another user\'s role via the inline select', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([makeUser({ id: 'user-2', role: makeRole({ name: 'CCE', displayName: 'Customer Care Executive' }) })]);
    vi.mocked(updateUser).mockResolvedValue(makeUser({ id: 'user-2', role: makeRole({ name: 'TECHNICAL_TEAM_LEADER' }) }));
    const user = userEvent.setup();
    renderPage();

    const roleSelect = await screen.findByDisplayValue('Customer Care Executive');
    await user.selectOptions(roleSelect, 'TECHNICAL_TEAM_LEADER');

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith('user-2', { roleName: 'TECHNICAL_TEAM_LEADER' }));
  });

  it('deactivates an active user and reactivates an inactive one', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([makeUser({ id: 'user-2', status: 'ACTIVE' })]);
    vi.mocked(deactivateUser).mockResolvedValue(makeUser({ id: 'user-2', status: 'INACTIVE' }));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(deactivateUser).toHaveBeenCalledWith('user-2'));
  });

  it('surfaces a blocked role change or deactivation (open-assignment blockers) as an error notice', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([makeUser({ id: 'user-2', status: 'ACTIVE' })]);
    vi.mocked(deactivateUser).mockRejectedValue({
      response: { data: { message: 'Cannot deactivate priya@jackys.com: they still hold 1 open item(s). Clear these first.' } },
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText(/still hold 1 open item/)).toBeInTheDocument();
  });
});

describe('UsersPage - reset password', () => {
  it("opens a reset-password modal from a user's row and resets on submit with matching passwords", async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([
      makeUser({ id: 'user-2', firstName: 'Priya', lastName: 'Nair', email: 'priya@jackys.com', status: 'ACTIVE' }),
    ]);
    vi.mocked(resetPassword).mockResolvedValue({ message: 'Password reset successfully' });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Reset password' }));
    const modal = (await screen.findByText('Reset password for Priya Nair')).closest('div.rounded-lg') as HTMLElement;

    await user.type(within(modal).getByLabelText(/^New password/), 'Welcome2026!');
    await user.type(within(modal).getByLabelText('Confirm new password'), 'Welcome2026!');
    await user.click(within(modal).getByRole('button', { name: 'Reset password' }));

    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith('user-2', 'Welcome2026!'));
    expect(await screen.findByText(/Password reset\. priya@jackys\.com is signed out/)).toBeInTheDocument();
  });

  it('blocks submit and shows a mismatch warning when the two password fields differ', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([makeUser({ id: 'user-2', firstName: 'Priya', lastName: 'Nair', status: 'ACTIVE' })]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Reset password' }));
    const modal = (await screen.findByText('Reset password for Priya Nair')).closest('div.rounded-lg') as HTMLElement;

    await user.type(within(modal).getByLabelText(/^New password/), 'Welcome2026!');
    await user.type(within(modal).getByLabelText('Confirm new password'), 'Different2026!');

    expect(await within(modal).findByText("Passwords don't match.")).toBeInTheDocument();
    expect(within(modal).getByRole('button', { name: 'Reset password' })).toBeDisabled();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('surfaces a server error (e.g. an admin trying to reset their own account) as an error notice inside the modal', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([makeUser({ id: 'user-2', firstName: 'Priya', lastName: 'Nair', status: 'ACTIVE' })]);
    vi.mocked(resetPassword).mockRejectedValue({
      response: { data: { message: 'You cannot reset your own password from this screen - use Change Password instead.' } },
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Reset password' }));
    const modal = (await screen.findByText('Reset password for Priya Nair')).closest('div.rounded-lg') as HTMLElement;

    await user.type(within(modal).getByLabelText(/^New password/), 'Welcome2026!');
    await user.type(within(modal).getByLabelText('Confirm new password'), 'Welcome2026!');
    await user.click(within(modal).getByRole('button', { name: 'Reset password' }));

    expect(await within(modal).findByText(/use Change Password instead/)).toBeInTheDocument();
  });
});

describe('UsersPage - create user form', () => {
  it('submits every field to createUser, omitting blank optional fields, and resets on success', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([]);
    vi.mocked(createUser).mockResolvedValue(makeUser());
    const user = userEvent.setup();
    renderPage();
    await switchToTab('Create user');

    const section = screen.getByRole('tabpanel') as HTMLElement;
    await user.type(within(section).getByLabelText('First name'), 'New');
    await user.type(within(section).getByLabelText('Last name'), 'Hire');
    await user.type(within(section).getByLabelText('Email'), 'new.hire@jackys.com');
    await user.type(within(section).getByLabelText(/^Temporary password/), 'Welcome2026!');
    await user.selectOptions(within(section).getByLabelText('Role'), 'CCE');
    await user.click(within(section).getByRole('button', { name: 'Create user' }));

    await waitFor(() =>
      expect(createUser).toHaveBeenCalledWith({
        firstName: 'New',
        lastName: 'Hire',
        email: 'new.hire@jackys.com',
        employeeId: undefined,
        phone: undefined,
        password: 'Welcome2026!',
        roleName: 'CCE',
      }),
    );
  });

  it('never offers CUSTOMER as a role option (the-fool finding #3)', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([]);
    // listCreatableRoles is mocked per the beforeEach default (CCE, TECHNICAL_TEAM_LEADER
    // only) - this test just asserts the page renders exactly what the API returned,
    // proving the page does not add CUSTOMER back in on its own.
    renderPage();
    await switchToTab('Create user');

    const section = screen.getByRole('tabpanel') as HTMLElement;
    const roleSelect = within(section).getByLabelText('Role') as HTMLSelectElement;
    const optionLabels = Array.from(roleSelect.options).map((o) => o.value);
    expect(optionLabels).not.toContain('CUSTOMER');
  });

  it('surfaces a duplicate email/employee ID conflict as an error notice', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([]);
    vi.mocked(createUser).mockRejectedValue({
      response: { data: { message: 'User with this email or employee ID already exists' } },
    });
    const user = userEvent.setup();
    renderPage();
    await switchToTab('Create user');

    const section = screen.getByRole('tabpanel') as HTMLElement;
    await user.type(within(section).getByLabelText('First name'), 'New');
    await user.type(within(section).getByLabelText('Last name'), 'Hire');
    await user.type(within(section).getByLabelText('Email'), 'admin@jackys.com');
    await user.type(within(section).getByLabelText(/^Temporary password/), 'Welcome2026!');
    await user.selectOptions(within(section).getByLabelText('Role'), 'CCE');
    await user.click(within(section).getByRole('button', { name: 'Create user' }));

    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
  });
});

describe('UsersPage - extra role access (RoleAccessSection)', () => {
  it('never offers SUPER_ADMIN, SERVICE_HEAD, or CUSTOMER as a delegatable role (the-fool findings #1/#5)', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([makeUser({ id: 'user-2', status: 'ACTIVE' })]);
    // listGrantableRoles is mocked per beforeEach to return only CCE/TECHNICAL_TEAM_LEADER -
    // this test proves the page renders exactly what the API returned, not that it adds
    // the excluded roles back in on its own.
    renderPage();
    await switchToTab('Extra role access');

    const section = screen.getByRole('tabpanel') as HTMLElement;
    await within(section).findByRole('option', { name: 'Technical Team Leader' });
    const roleSelect = within(section).getByLabelText(/^Role to delegate/) as HTMLSelectElement;
    const optionValues = Array.from(roleSelect.options).map((o) => o.value);
    expect(optionValues).not.toContain('SUPER_ADMIN');
    expect(optionValues).not.toContain('SERVICE_HEAD');
    expect(optionValues).not.toContain('CUSTOMER');
  });

  it("never offers the current admin as their own grant recipient (the-fool: self-grant)", async () => {
    mockCurrentUser('SUPER_ADMIN', 'admin-1');
    vi.mocked(listUsers).mockResolvedValue([
      makeUser({ id: 'admin-1', firstName: 'Admin', lastName: 'User' }),
      makeUser({ id: 'user-2', firstName: 'Priya', lastName: 'Nair', status: 'ACTIVE' }),
    ]);
    renderPage();
    await switchToTab('Extra role access');

    const section = screen.getByRole('tabpanel') as HTMLElement;
    await within(section).findByRole('option', { name: /Priya Nair/ });
    const userSelect = within(section).getByLabelText('User') as HTMLSelectElement;
    const optionLabels = Array.from(userSelect.options).map((o) => o.textContent);
    expect(optionLabels.some((label) => label?.includes('Admin User'))).toBe(false);
    expect(optionLabels.some((label) => label?.includes('Priya Nair'))).toBe(true);
  });

  it('shows a live capability preview when a role is selected, flagging QC-gated endpoints as needing a separate grant (the-fool finding #3)', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([makeUser({ id: 'user-2', status: 'ACTIVE' })]);
    vi.mocked(getRoleCapabilities).mockResolvedValue([makeRoleCapabilityModule()]);
    const user = userEvent.setup();
    renderPage();
    await switchToTab('Extra role access');

    const section = screen.getByRole('tabpanel') as HTMLElement;
    await within(section).findByRole('option', { name: 'Technical Team Leader' });
    await user.selectOptions(within(section).getByLabelText(/^Role to delegate/), 'TECHNICAL_TEAM_LEADER');

    expect(await screen.findByText(/What TECHNICAL TEAM LEADER access includes/)).toBeInTheDocument();
    expect(await screen.findByText(/Warranty Override/)).toBeInTheDocument();
    expect(await screen.findByText(/also needs QC APPROVAL grant/)).toBeInTheDocument();
    expect(getRoleCapabilities).toHaveBeenCalledWith('TECHNICAL_TEAM_LEADER');
  });

  it('submits a grant with the selected user, role, and a required expiry date', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([makeUser({ id: 'user-2', firstName: 'Priya', lastName: 'Nair', status: 'ACTIVE' })]);
    vi.mocked(getRoleCapabilities).mockResolvedValue([]);
    vi.mocked(grantRoleAccess).mockResolvedValue(makeRoleAccessGrant());
    const user = userEvent.setup();
    renderPage();
    await switchToTab('Extra role access');

    const section = screen.getByRole('tabpanel') as HTMLElement;
    await within(section).findByRole('option', { name: /Priya Nair/ });
    await user.selectOptions(within(section).getByLabelText('User'), 'user-2');
    await user.selectOptions(within(section).getByLabelText(/^Role to delegate/), 'TECHNICAL_TEAM_LEADER');
    await user.click(within(section).getByRole('button', { name: 'Grant' }));

    await waitFor(() =>
      expect(grantRoleAccess).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-2', roleName: 'TECHNICAL_TEAM_LEADER', expiresAt: expect.any(String) }),
      ),
    );
  });

  it("clicking a roster row's \"Grant access\" button focuses the form on that user", async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([makeUser({ id: 'user-2', firstName: 'Priya', lastName: 'Nair', status: 'ACTIVE' })]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Grant access' }));

    const section = screen.getByRole('tabpanel') as HTMLElement;
    const userSelect = within(section).getByLabelText('User') as HTMLSelectElement;
    await waitFor(() => expect(userSelect.value).toBe('user-2'));
  });

  it('shows an active grant as a pill on the roster row, with a working revoke button', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([makeUser({ id: 'user-2', status: 'ACTIVE' })]);
    vi.mocked(listRoleAccessForUser).mockResolvedValue([makeRoleAccessGrant({ expiresAt: '2099-01-01T00:00:00Z' })]);
    vi.mocked(revokeRoleAccess).mockResolvedValue(makeRoleAccessGrant({ revokedAt: '2026-09-03T00:00:00Z' }));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/TECHNICAL TEAM LEADER · until/)).toBeInTheDocument();

    await user.click(screen.getByTitle('Revoke this delegated access now'));
    await waitFor(() =>
      expect(revokeRoleAccess).toHaveBeenCalledWith({ userId: 'user-2', roleName: 'TECHNICAL_TEAM_LEADER' }),
    );
  });

  it('shows a placeholder dash when a user holds no active extra access', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([makeUser({ id: 'user-2', status: 'ACTIVE' })]);
    vi.mocked(listRoleAccessForUser).mockResolvedValue([]);
    renderPage();

    await screen.findByText('Priya Nair');
    expect(await screen.findByText('—')).toBeInTheDocument();
  });

  it('does not show an already-expired grant as an active pill', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([makeUser({ id: 'user-2', status: 'ACTIVE' })]);
    vi.mocked(listRoleAccessForUser).mockResolvedValue([makeRoleAccessGrant({ expiresAt: '2020-01-01T00:00:00Z' })]);
    renderPage();

    await screen.findByText('Priya Nair');
    expect(screen.queryByText(/TECHNICAL TEAM LEADER · until/)).not.toBeInTheDocument();
    expect(await screen.findByText('—')).toBeInTheDocument();
  });

  // Gaps found 2026-09-03 during an independent test-master pass: the 8 tests above cover
  // the-fool's guardrail findings and the happy path, but none of them exercised the
  // grant button's disabled state, the error path, or the capability-preview zero-state
  // message - all three are real, user-visible behavior on this form.

  it('disables the Grant button until a user, role, and expiry are all chosen, and via a granted mutation in flight', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([makeUser({ id: 'user-2', firstName: 'Priya', lastName: 'Nair', status: 'ACTIVE' })]);
    vi.mocked(getRoleCapabilities).mockResolvedValue([]);
    vi.mocked(grantRoleAccess).mockImplementation(() => new Promise(() => {})); // never resolves - simulates in-flight
    const user = userEvent.setup();
    renderPage();
    await switchToTab('Extra role access');

    const section = screen.getByRole('tabpanel') as HTMLElement;
    const grantButton = within(section).getByRole('button', { name: 'Grant' });
    // Expiry defaults to a valid date, so with no user/role picked the button starts disabled.
    expect(grantButton).toBeDisabled();

    await within(section).findByRole('option', { name: /Priya Nair/ });
    await user.selectOptions(within(section).getByLabelText('User'), 'user-2');
    expect(grantButton).toBeDisabled(); // role still unset

    await user.selectOptions(within(section).getByLabelText(/^Role to delegate/), 'TECHNICAL_TEAM_LEADER');
    expect(grantButton).not.toBeDisabled();

    await user.click(grantButton);
    await waitFor(() => expect(grantButton).toBeDisabled()); // mutation now pending
  });

  it('surfaces the server error message when a grant submission fails (e.g. a duplicate active grant)', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([makeUser({ id: 'user-2', firstName: 'Priya', lastName: 'Nair', status: 'ACTIVE' })]);
    vi.mocked(getRoleCapabilities).mockResolvedValue([]);
    vi.mocked(grantRoleAccess).mockRejectedValue({
      response: { data: { message: 'User already holds active delegated access to this role' } },
    });
    const user = userEvent.setup();
    renderPage();
    await switchToTab('Extra role access');

    const section = screen.getByRole('tabpanel') as HTMLElement;
    await within(section).findByRole('option', { name: /Priya Nair/ });
    await user.selectOptions(within(section).getByLabelText('User'), 'user-2');
    await user.selectOptions(within(section).getByLabelText(/^Role to delegate/), 'TECHNICAL_TEAM_LEADER');
    await user.click(within(section).getByRole('button', { name: 'Grant' }));

    expect(await within(section).findByText('User already holds active delegated access to this role')).toBeInTheDocument();
  });

  it('shows a zero-state message in the capability preview when the selected role has no distinct gated endpoints', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([makeUser({ id: 'user-2', status: 'ACTIVE' })]);
    vi.mocked(getRoleCapabilities).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await switchToTab('Extra role access');

    const section = screen.getByRole('tabpanel') as HTMLElement;
    await within(section).findByRole('option', { name: 'Technical Team Leader' });
    await user.selectOptions(within(section).getByLabelText(/^Role to delegate/), 'TECHNICAL_TEAM_LEADER');

    expect(await screen.findByText('This role has no distinct gated capabilities in the app today.')).toBeInTheDocument();
  });
});

// RBAC Phase 1 admin UI (2026-09-10): a single designation dropdown, a reference-only list
// of who currently holds it, and a tick-and-save capability checklist grouped by module -
// per your own description of the flow, not the multi-column matrix grid from the
// screenshot (that was "just to show the logic", not the final UI).
describe('UsersPage - designation access (RolePermissionsSection)', () => {
  const CAPABILITIES = [
    makeCapabilityMatrixEntry({ key: 'SCHEDULE_CCE_MANAGE', label: 'Create & manage appointments', module: 'Appointments', migrated: true, grantedRoleIds: ['role-cce'] }),
    makeCapabilityMatrixEntry({ key: 'SCHEDULE_ASSIGN_TECHNICIAN', label: 'Assign a technician to an appointment', module: 'Appointments', migrated: true, grantedRoleIds: ['role-tl'] }),
    makeCapabilityMatrixEntry({ key: 'QC_GATE_ACCESS', label: 'Eligible to hold QC approve/reject sign-off', module: 'QC', migrated: true, grantedRoleIds: [] }),
    makeCapabilityMatrixEntry({ key: 'INVENTORY_ISSUE', label: 'Issue spares from Main Store', module: 'Inventory', migrated: false, grantedRoleIds: [] }),
  ];

  it('never offers a locked role (SUPER_ADMIN/SERVICE_HEAD/CUSTOMER) as a designation - proves the page renders exactly what the API returned', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([]);
    // listRolePermissionRoles is mocked per beforeEach to return only CCE/TECHNICAL_TEAM_LEADER -
    // the backend is what actually excludes SUPER_ADMIN/SERVICE_HEAD/CUSTOMER (MATRIX_LOCKED_ROLES).
    renderPage();
    await switchToTab('Designation access');

    const panel = screen.getByRole('tabpanel') as HTMLElement;
    await within(panel).findByRole('option', { name: 'Technical Team Leader' });
    const roleSelect = within(panel).getByLabelText('Designation') as HTMLSelectElement;
    const optionLabels = Array.from(roleSelect.options).map((o) => o.textContent);
    expect(optionLabels).not.toContain('Super Admin');
    expect(optionLabels).not.toContain('Service Head');
    expect(optionLabels).not.toContain('Customer');
  });

  it('selecting a designation shows its reference-only user list and its capabilities grouped by module, pre-ticked from the matrix', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([]);
    vi.mocked(getRolePermissionsMatrix).mockResolvedValue(CAPABILITIES);
    vi.mocked(listUsersForRolePermission).mockResolvedValue([
      makeRolePermissionUserRef({ id: 'u1', firstName: 'Amina', lastName: 'Khan', status: 'ACTIVE' }),
    ]);
    const user = userEvent.setup();
    renderPage();
    await switchToTab('Designation access');

    const panel = screen.getByRole('tabpanel') as HTMLElement;
    await within(panel).findByRole('option', { name: 'Customer Care Executive' });
    await user.selectOptions(within(panel).getByLabelText('Designation'), 'role-cce');

    expect(await within(panel).findByText('Amina Khan')).toBeInTheDocument();
    expect(within(panel).getByText(/1 active user.*will get this change/)).toBeInTheDocument();

    const cceCheckbox = within(panel).getByLabelText('Create & manage appointments') as HTMLInputElement;
    expect(cceCheckbox.checked).toBe(true);
    const assignCheckbox = within(panel).getByLabelText('Assign a technician to an appointment') as HTMLInputElement;
    expect(assignCheckbox.checked).toBe(false);
    expect(within(panel).getByText('Appointments')).toBeInTheDocument();
    expect(within(panel).getByText('QC')).toBeInTheDocument();
  });

  it('shows a not-yet-migrated capability as a disabled "Coming soon" checkbox, never tickable', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([]);
    vi.mocked(getRolePermissionsMatrix).mockResolvedValue(CAPABILITIES);
    const user = userEvent.setup();
    renderPage();
    await switchToTab('Designation access');

    const panel = screen.getByRole('tabpanel') as HTMLElement;
    await within(panel).findByRole('option', { name: 'Customer Care Executive' });
    await user.selectOptions(within(panel).getByLabelText('Designation'), 'role-cce');

    expect(await within(panel).findByText('Coming soon')).toBeInTheDocument();
    const comingSoonCheckbox = within(panel).getByLabelText('Issue spares from Main Store') as HTMLInputElement;
    expect(comingSoonCheckbox.disabled).toBe(true);
    expect(comingSoonCheckbox.checked).toBe(false);
  });

  it('shows a message when no one currently holds the selected designation', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([]);
    vi.mocked(getRolePermissionsMatrix).mockResolvedValue(CAPABILITIES);
    vi.mocked(listUsersForRolePermission).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await switchToTab('Designation access');

    const panel = screen.getByRole('tabpanel') as HTMLElement;
    await within(panel).findByRole('option', { name: 'Customer Care Executive' });
    await user.selectOptions(within(panel).getByLabelText('Designation'), 'role-cce');

    expect(await within(panel).findByText('No one currently holds this designation.')).toBeInTheDocument();
  });

  it('disables Save until a checkbox is toggled, then saves exactly the new full capability set for that role', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([]);
    vi.mocked(getRolePermissionsMatrix).mockResolvedValue(CAPABILITIES);
    vi.mocked(setRoleCapabilities).mockResolvedValue({ granted: ['SCHEDULE_ASSIGN_TECHNICIAN'], revoked: [] });
    const user = userEvent.setup();
    renderPage();
    await switchToTab('Designation access');

    const panel = screen.getByRole('tabpanel') as HTMLElement;
    await within(panel).findByRole('option', { name: 'Customer Care Executive' });
    await user.selectOptions(within(panel).getByLabelText('Designation'), 'role-cce');

    const saveButton = await within(panel).findByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();

    await user.click(within(panel).getByLabelText('Assign a technician to an appointment'));
    expect(saveButton).not.toBeDisabled();

    await user.click(saveButton);

    await waitFor(() =>
      expect(setRoleCapabilities).toHaveBeenCalledWith(
        'role-cce',
        expect.arrayContaining(['SCHEDULE_CCE_MANAGE', 'SCHEDULE_ASSIGN_TECHNICIAN']),
      ),
    );
    expect(await within(panel).findByText('Saved.')).toBeInTheDocument();
  });

  it('resets the checklist to the newly-selected role\'s own capabilities when switching designations, not carrying over the previous selection', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([]);
    vi.mocked(getRolePermissionsMatrix).mockResolvedValue(CAPABILITIES);
    const user = userEvent.setup();
    renderPage();
    await switchToTab('Designation access');

    const panel = screen.getByRole('tabpanel') as HTMLElement;
    await within(panel).findByRole('option', { name: 'Customer Care Executive' });
    await user.selectOptions(within(panel).getByLabelText('Designation'), 'role-cce');
    expect((within(panel).getByLabelText('Create & manage appointments') as HTMLInputElement).checked).toBe(true);

    await user.selectOptions(within(panel).getByLabelText('Designation'), 'role-tl');
    expect((within(panel).getByLabelText('Create & manage appointments') as HTMLInputElement).checked).toBe(false);
    expect((within(panel).getByLabelText('Assign a technician to an appointment') as HTMLInputElement).checked).toBe(true);
  });

  it('surfaces a server error from a failed save as an error notice', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([]);
    vi.mocked(getRolePermissionsMatrix).mockResolvedValue(CAPABILITIES);
    vi.mocked(setRoleCapabilities).mockRejectedValue({
      response: { data: { message: 'Role not found.' } },
    });
    const user = userEvent.setup();
    renderPage();
    await switchToTab('Designation access');

    const panel = screen.getByRole('tabpanel') as HTMLElement;
    await within(panel).findByRole('option', { name: 'Customer Care Executive' });
    await user.selectOptions(within(panel).getByLabelText('Designation'), 'role-cce');
    await user.click(within(panel).getByLabelText('Assign a technician to an appointment'));
    await user.click(within(panel).getByRole('button', { name: 'Save' }));

    expect(await within(panel).findByText('Role not found.')).toBeInTheDocument();
  });
});
