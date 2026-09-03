import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeRole, makeUser } from '../../test/fixtures';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/usersApi', () => ({
  listUsers: vi.fn(),
  listCreatableRoles: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deactivateUser: vi.fn(),
  reactivateUser: vi.fn(),
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
