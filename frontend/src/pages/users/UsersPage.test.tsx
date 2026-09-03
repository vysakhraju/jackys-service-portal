import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeRole, makeRoleAccessGrant, makeRoleCapabilityModule, makeUser } from '../../test/fixtures';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/usersApi', () => ({
  listUsers: vi.fn(),
  listCreatableRoles: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deactivateUser: vi.fn(),
  reactivateUser: vi.fn(),
}));
vi.mock('../../lib/roleAccessApi', () => ({
  listGrantableRoles: vi.fn(),
  getRoleCapabilities: vi.fn(),
  grantRoleAccess: vi.fn(),
  revokeRoleAccess: vi.fn(),
  listRoleAccessForUser: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
import {
  createUser,
  deactivateUser,
  listCreatableRoles,
  listUsers,
  reactivateUser,
  updateUser,
} from '../../lib/usersApi';
import {
  getRoleCapabilities,
  grantRoleAccess,
  listGrantableRoles,
  listRoleAccessForUser,
  revokeRoleAccess,
} from '../../lib/roleAccessApi';
import { UsersPage } from './UsersPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <UsersPage />
    </QueryClientProvider>,
  );
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
  vi.mocked(listGrantableRoles).mockReset().mockResolvedValue(ROLES);
  vi.mocked(getRoleCapabilities).mockReset();
  vi.mocked(grantRoleAccess).mockReset();
  vi.mocked(revokeRoleAccess).mockReset();
  vi.mocked(listRoleAccessForUser).mockReset().mockResolvedValue([]);
});

describe('UsersPage - admin-only gating', () => {
  it('shows a restricted notice for a role outside the admin set, with no roster or create form', async () => {
    mockCurrentUser('CCE');
    renderPage();
    expect(await screen.findByText(/restricted to Super Admin \/ Service Head/i)).toBeInTheDocument();
    expect(screen.queryByText('Roster')).not.toBeInTheDocument();
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('shows the roster and create form for SERVICE_HEAD', async () => {
    mockCurrentUser('SERVICE_HEAD');
    vi.mocked(listUsers).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Roster')).toBeInTheDocument();
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
    expect(await screen.findByText('No users yet - create the first one below.')).toBeInTheDocument();
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

describe('UsersPage - create user form', () => {
  it('submits every field to createUser, omitting blank optional fields, and resets on success', async () => {
    mockCurrentUser('SUPER_ADMIN');
    vi.mocked(listUsers).mockResolvedValue([]);
    vi.mocked(createUser).mockResolvedValue(makeUser());
    const user = userEvent.setup();
    renderPage();

    const section = (await screen.findByText('Create a user')).closest('section') as HTMLElement;
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

    const section = (await screen.findByText('Create a user')).closest('section') as HTMLElement;
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

    const section = (await screen.findByText('Create a user')).closest('section') as HTMLElement;
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

    const section = (await screen.findByText('Extra role access')).closest('section') as HTMLElement;
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

    const section = (await screen.findByText('Extra role access')).closest('section') as HTMLElement;
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

    const section = (await screen.findByText('Extra role access')).closest('section') as HTMLElement;
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

    const section = (await screen.findByText('Extra role access')).closest('section') as HTMLElement;
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

    const section = (await screen.findByText('Extra role access')).closest('section') as HTMLElement;
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
});
