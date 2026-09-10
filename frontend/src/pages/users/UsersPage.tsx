import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Checkbox, Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { TabBar, TabPanel, type TabDef } from '../../components/Tabs';
import { useAuth } from '../../lib/auth';
import type { User } from '../../lib/types';
import {
  createUser,
  deactivateUser,
  listCreatableRoles,
  listUsers,
  reactivateUser,
  resetPassword,
  updateUser,
} from '../../lib/usersApi';
import { USER_MANAGEMENT_ADMIN_ROLES, type CreateUserInput } from '../../lib/usersTypes';
import {
  getRoleCapabilities,
  grantRoleAccess,
  listGrantableRoles,
  listRoleAccessForUser,
  revokeRoleAccess,
} from '../../lib/roleAccessApi';
import { isRoleAccessGrantActive, MAX_ROLE_ACCESS_GRANT_DAYS } from '../../lib/roleAccessTypes';
import {
  getRolePermissionsMatrix,
  listRolePermissionRoles,
  listUsersForRolePermission,
  setRoleCapabilities,
} from '../../lib/rolePermissionsApi';
import type { CapabilityMatrixEntry } from '../../lib/rolePermissionsTypes';

// The only way to get a new staff account into this app used to be a CLI script run
// directly on the server (scripts/seed-admin.ts / seed-technician.ts) - this screen is
// what replaces that. Admin-gated the same way PermissionsPage.tsx already gates on
// PERMISSION_ADMIN_ROLES: only SUPER_ADMIN/SERVICE_HEAD, matching every endpoint here
// being admin-only server-side too.
//
// the-fool pre-mortem (2026-09-03, mode: Find failure modes) shaped three things below:
// CUSTOMER never appears in the role dropdown (GET /users/roles already excludes it -
// customers use the no-login /track/:token portal, not a staff account); an admin's own
// row has its role select and Deactivate button disabled, not just server-blocked, so the
// 403 is never actually hit; and a role-change or deactivate that would orphan an open
// appointment/job-card/inventory custody surfaces the backend's blockers[] message as-is
// rather than a generic failure.
//
// A second the-fool pre-mortem (2026-09-03, mode: Find failure modes) ran before "Extra
// role access" (RoleAccessSection below) was added, on top of the above - a materially
// higher-stakes surface since it touches the authorization check behind every @Roles()
// endpoint in the app, not just this screen. Its 5 findings shaped: SUPER_ADMIN/
// SERVICE_HEAD/CUSTOMER never appearing in the delegatable-role dropdown (GET
// /permissions/roles/grantable already excludes them - delegating either admin role would
// recursively delegate the whole admin surface, including this page); every grant
// requiring an expiry, capped at 90 days, with no way to leave it blank; the live
// capabilities preview flagging QC-gated endpoints as needing a SEPARATE grant instead of
// silently listing them as included; and an admin never being able to select themselves as
// the recipient in the grant form.
const USER_TABS: TabDef[] = [
  { id: 'roster', label: 'Roster' },
  { id: 'designation-access', label: 'Designation access', hint: 'Set what an entire role can do - cascades to every user with that role' },
  { id: 'extra-access', label: 'Extra role access', hint: "Delegate one specific person more than their role, without changing the role itself" },
  { id: 'create', label: 'Create user' },
];

// Redesigned 2026-09-10 (your feedback: "the page is very big need to scroll so much and
// no proper segregation") - four tabs instead of one long stacked scroll. Only the active
// tab's section is mounted (TabPanel), so a rarely-opened tab's own queries don't even fire
// until it's actually opened. "Designation access" is the new role-level capability matrix
// (RBAC Phase 1); "Extra role access" (per-user delegation) is unchanged, still the right
// tool for "cover this one person while the TL is on leave" - see that section's own note.
export function UsersPage() {
  const { user: currentUser } = useAuth();
  const isAdmin = !!currentUser && USER_MANAGEMENT_ADMIN_ROLES.includes(currentUser.role.name);
  const [grantFocusUserId, setGrantFocusUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('roster');

  if (!isAdmin) {
    return (
      <p className="max-w-2xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
        User management is restricted to Super Admin / Service Head - every endpoint on this screen (list, create,
        edit role, deactivate, reactivate, extra role-access grants) is admin-only server-side.
      </p>
    );
  }

  const goToExtraAccess = (userId: string) => {
    setGrantFocusUserId(userId);
    setActiveTab('extra-access');
  };

  return (
    <div className="max-w-6xl space-y-6 p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Users</p>
        <h1 className="mt-0.5 text-xl font-semibold text-slate-900">Create staff accounts and manage roles</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Every account with real access to this app - CCE, Technical Team Leader, technicians, finance staff, and
          so on - is created and assigned a role here.
        </p>
      </div>

      <TabBar tabs={USER_TABS} active={activeTab} onChange={setActiveTab} />

      <TabPanel active={activeTab === 'roster'}>
        <RosterSection currentUserId={currentUser!.id} onGrantAccess={goToExtraAccess} />
      </TabPanel>
      <TabPanel active={activeTab === 'designation-access'}>
        <RolePermissionsSection />
      </TabPanel>
      <TabPanel active={activeTab === 'extra-access'}>
        <RoleAccessSection currentUserId={currentUser!.id} focusUserId={grantFocusUserId} onFocusUserIdChange={setGrantFocusUserId} />
      </TabPanel>
      <TabPanel active={activeTab === 'create'}>
        <CreateUserSection />
      </TabPanel>
    </div>
  );
}

function StatusPill({ status }: { status: User['status'] }) {
  const styles: Record<User['status'], string> = {
    ACTIVE: 'bg-emerald-50 text-emerald-700',
    INACTIVE: 'bg-slate-100 text-slate-500',
    SUSPENDED: 'bg-amber-50 text-amber-700',
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>{status}</span>;
}

function UserRoleAccessPills({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const grantsQuery = useQuery({ queryKey: ['role-access', userId], queryFn: () => listRoleAccessForUser(userId) });
  const revokeMutation = useMutation({
    mutationFn: (roleName: string) => revokeRoleAccess({ userId, roleName }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['role-access', userId] }),
  });

  const active = (grantsQuery.data ?? []).filter(isRoleAccessGrantActive);
  if (grantsQuery.isLoading) {
    return <span className="text-xs text-slate-300">…</span>;
  }
  if (active.length === 0) {
    return <span className="text-xs text-slate-300">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {active.map((g) => (
        <span
          key={g.id}
          title={`Expires ${new Date(g.expiresAt).toLocaleString()}`}
          className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
        >
          {g.grantedRoleName.replaceAll('_', ' ')} · until {new Date(g.expiresAt).toLocaleDateString()}
          <button
            onClick={() => revokeMutation.mutate(g.grantedRoleName)}
            disabled={revokeMutation.isPending}
            title="Revoke this delegated access now"
            className="ml-0.5 text-indigo-400 hover:text-indigo-700 disabled:opacity-50"
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

// Raised alongside "Designation access" (2026-09-10, your feedback: "no proper
// segregation") - the roster defaults to Active only, since that's who an admin is
// managing day to day; Inactive/All are one click away, not the default scroll.
type StatusFilter = 'ACTIVE' | 'INACTIVE' | 'ALL';

function RosterSection({ currentUserId, onGrantAccess }: { currentUserId: string; onGrantAccess: (userId: string) => void }) {
  const queryClient = useQueryClient();
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const rolesQuery = useQuery({ queryKey: ['users', 'roles'], queryFn: listCreatableRoles });
  const [resetPasswordTarget, setResetPasswordTarget] = useState<User | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ACTIVE');

  const roleMutation = useMutation({
    mutationFn: ({ id, roleName }: { id: string; roleName: string }) => updateUser(id, { roleName }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
  const reactivateMutation = useMutation({
    mutationFn: (id: string) => reactivateUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const pendingError = roleMutation.error ?? deactivateMutation.error ?? reactivateMutation.error;

  const columns: Column<User>[] = [
    { key: 'name', label: 'Name', render: (u) => `${u.firstName} ${u.lastName}${u.id === currentUserId ? ' (you)' : ''}` },
    { key: 'email', label: 'Email', render: (u) => u.email },
    { key: 'employeeId', label: 'Employee ID', render: (u) => u.employeeId ?? '—' },
    {
      key: 'role',
      label: 'Role',
      render: (u) => (
        <select
          aria-label={`Change role for ${u.firstName} ${u.lastName}`}
          // min-width prevents the browser's table auto-layout from collapsing this
          // column down to just the dropdown arrow, hiding the selected role's text
          // entirely - a real bug you hit live (2026-09-08), not just a style nit.
          className={`${inputClass} min-w-[10rem] py-1`}
          value={u.role.name}
          disabled={u.id === currentUserId || roleMutation.isPending}
          onChange={(e) => roleMutation.mutate({ id: u.id, roleName: e.target.value })}
        >
          <option value={u.role.name}>{u.role.displayName}</option>
          {rolesQuery.data
            ?.filter((r) => r.name !== u.role.name)
            .map((r) => (
              <option key={r.id} value={r.name}>
                {r.displayName}
              </option>
            ))}
        </select>
      ),
    },
    { key: 'status', label: 'Status', render: (u) => <StatusPill status={u.status} /> },
    { key: 'extraAccess', label: 'Extra access', render: (u) => <UserRoleAccessPills userId={u.id} /> },
  ];

  const filteredUsers = (usersQuery.data ?? []).filter((u) => statusFilter === 'ALL' || u.status === statusFilter);

  return (
    <section>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">Roster</p>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          Show
          <select
            aria-label="Filter roster by status"
            className={`${inputClass} w-auto py-1`}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="ALL">All</option>
          </select>
        </label>
      </div>
      <p className="mb-3 text-xs text-slate-400">
        Changing a role re-checks the same open-job/appointment/spare-custody guard as deactivating - a change that
        would orphan work still in progress is blocked, not silently applied. "Extra access" is a separate,
        time-boxed delegation on top of a user's own role (e.g. covering someone's leave) - grant or revoke it under
        the Extra role access tab.
      </p>
      <ErrorNotice error={pendingError} />
      <DataTable
        columns={columns}
        rows={filteredUsers}
        isLoading={usersQuery.isLoading}
        error={usersQuery.error}
        emptyMessage={
          (usersQuery.data ?? []).length === 0
            ? 'No users yet - create the first one from the Create user tab.'
            : `No ${statusFilter === 'ALL' ? '' : statusFilter.toLowerCase() + ' '}users to show.`
        }
        rowActions={(u) =>
          u.id === currentUserId ? (
            <span className="text-xs text-slate-400">You can't modify your own account here</span>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={() => onGrantAccess(u.id)}
                className="rounded-md border border-indigo-300 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
              >
                Grant access
              </button>
              <button
                onClick={() => setResetPasswordTarget(u)}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Reset password
              </button>
              {u.status === 'ACTIVE' ? (
                <button
                  onClick={() => deactivateMutation.mutate(u.id)}
                  disabled={deactivateMutation.isPending}
                  className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Deactivate
                </button>
              ) : (
                <button
                  onClick={() => reactivateMutation.mutate(u.id)}
                  disabled={reactivateMutation.isPending}
                  className="rounded-md border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                >
                  Reactivate
                </button>
              )}
            </div>
          )
        }
      />
      <ResetPasswordModal user={resetPasswordTarget} onClose={() => setResetPasswordTarget(null)} />
    </section>
  );
}

// Admin-set password, shared directly with the user afterwards - same convention as
// CreateUserSection below (no email/invite-link flow exists in this app). The backend
// blocks resetting your own password from this screen (AuthService.resetPasswordByAdmin),
// which is exactly why this modal is only ever reachable from another user's row - the
// roster already hides all row actions, including this one, on the admin's own row.
function ResetPasswordModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [justReset, setJustReset] = useState(false);

  const resetMutation = useMutation({
    mutationFn: () => resetPassword(user!.id, newPassword),
    onSuccess: () => setJustReset(true),
  });

  const handleClose = () => {
    setNewPassword('');
    setConfirmPassword('');
    setJustReset(false);
    resetMutation.reset();
    onClose();
  };

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const tooShort = newPassword.length > 0 && newPassword.length < 8;

  return (
    <Modal
      open={!!user}
      onClose={handleClose}
      title={user ? `Reset password for ${user.firstName} ${user.lastName}` : 'Reset password'}
    >
      {justReset ? (
        <div className="space-y-3">
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Password reset. {user?.email} is signed out of any existing session - share the new password with them
            directly (WhatsApp, verbally, a note); they can change it themselves afterwards.
          </p>
          <button
            onClick={handleClose}
            className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Done
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!mismatch && newPassword.length >= 8) resetMutation.mutate();
          }}
          className="space-y-3"
        >
          <p className="text-xs text-slate-500">
            Sets a new temporary password directly, the same way a new account's password is set.{' '}
            {user?.email} is signed out of any existing session immediately once this is saved.
          </p>
          <ErrorNotice error={resetMutation.error} />
          <Field label="New password" hint="At least 8 characters.">
            <input
              type="text"
              autoFocus
              className={inputClass}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirm new password">
            <input
              type="text"
              className={inputClass}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </Field>
          {tooShort && <p className="text-xs text-red-600">Must be at least 8 characters.</p>}
          {mismatch && <p className="text-xs text-red-600">Passwords don't match.</p>}
          <button
            type="submit"
            disabled={resetMutation.isPending || newPassword.length < 8 || mismatch}
            className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Reset password
          </button>
        </form>
      )}
    </Modal>
  );
}

// Designation access (2026-09-10) - the designation permission matrix. "Admin picks a
// designation, sees who currently holds it (reference only), ticks the capabilities that
// role should have, saves" - per your own description of the flow, deliberately not the
// full multi-column matrix grid from the screenshot you shared (that was "just to show the
// logic", not the final UI). "Extra role access" (its own tab) stays the tool for
// delegating access to one specific person - this tab only ever changes an entire role at
// once, cascading to everyone who holds it.
function RolePermissionsSection() {
  const queryClient = useQueryClient();
  const rolesQuery = useQuery({ queryKey: ['role-permissions', 'roles'], queryFn: listRolePermissionRoles });
  const matrixQuery = useQuery({ queryKey: ['role-permissions', 'matrix'], queryFn: getRolePermissionsMatrix });
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const usersForRoleQuery = useQuery({
    queryKey: ['role-permissions', 'users', selectedRoleId],
    queryFn: () => listUsersForRolePermission(selectedRoleId),
    enabled: !!selectedRoleId,
  });

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);

  const saveMutation = useMutation({
    mutationFn: () => setRoleCapabilities(selectedRoleId, [...checked]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['role-permissions', 'matrix'] });
      setDirty(false);
    },
  });

  // Resets local checkbox state to exactly what the server has, every time the selected
  // designation changes (or the matrix is refetched after a save) - never carries a
  // previous role's ticks into a newly-selected one, and never shows a stale "Saved."
  // message against a role that was never actually saved.
  useEffect(() => {
    saveMutation.reset();
    if (!selectedRoleId || !matrixQuery.data) {
      setChecked(new Set());
      setDirty(false);
      return;
    }
    setChecked(new Set(matrixQuery.data.filter((c) => c.grantedRoleIds.includes(selectedRoleId)).map((c) => c.key)));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoleId, matrixQuery.data]);

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setDirty(true);
  };

  const byModule = new Map<string, CapabilityMatrixEntry[]>();
  for (const c of matrixQuery.data ?? []) {
    if (!byModule.has(c.module)) byModule.set(c.module, []);
    byModule.get(c.module)!.push(c);
  }

  const selectedRole = rolesQuery.data?.find((r) => r.id === selectedRoleId);
  const usersForRole = usersForRoleQuery.data ?? [];
  const activeUsersForRole = usersForRole.filter((u) => u.status === 'ACTIVE');

  return (
    <section>
      <p className="mb-1 text-sm font-semibold text-slate-900">Designation access</p>
      <p className="mb-3 max-w-2xl text-xs text-slate-400">
        Set what an entire designation can do - tick a capability once here and every user assigned that role gets
        it immediately, no per-user setup needed. Super Admin and Service Head always have full access and never
        appear below. Need to give ONE specific person more than their own role, without changing the designation
        itself? Use the Extra role access tab instead.
      </p>

      <Field label="Designation">
        <select
          className={`${inputClass} max-w-sm`}
          value={selectedRoleId}
          onChange={(e) => setSelectedRoleId(e.target.value)}
        >
          <option value="" disabled>
            Select a designation…
          </option>
          {rolesQuery.data?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.displayName}
            </option>
          ))}
        </select>
      </Field>

      {selectedRoleId && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_16rem]">
          <div className="rounded-md border border-slate-200 bg-white p-4">
            {matrixQuery.isLoading && <p className="text-xs text-slate-400">Loading capabilities…</p>}
            {[...byModule.entries()].map(([moduleName, capabilities]) => (
              <div key={moduleName} className="mb-4 last:mb-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{moduleName}</p>
                <div className="mt-2 space-y-2">
                  {capabilities.map((c) => (
                    <div key={c.key} className="flex items-start gap-2">
                      <Checkbox
                        label={c.label}
                        checked={c.migrated && checked.has(c.key)}
                        disabled={!c.migrated}
                        onChange={() => c.migrated && toggle(c.key)}
                      />
                      {!c.migrated && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                          Coming soon
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
              {selectedRole?.displayName ?? 'This designation'} today
            </p>
            <p className="mb-2 text-xs text-slate-500">
              Reference only - who this change affects. Not editable from here.
            </p>
            {usersForRoleQuery.isLoading && <p className="text-xs text-slate-400">Loading…</p>}
            {!usersForRoleQuery.isLoading && usersForRole.length === 0 && (
              <p className="text-xs text-slate-400">No one currently holds this designation.</p>
            )}
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {usersForRole.map((u) => (
                <li key={u.id} className="text-xs text-slate-600">
                  {u.firstName} {u.lastName}
                  {u.status !== 'ACTIVE' && <span className="ml-1 text-slate-400">({u.status.toLowerCase()})</span>}
                </li>
              ))}
            </ul>
            {usersForRole.length > 0 && (
              <p className="mt-2 text-xs font-medium text-slate-500">
                {activeUsersForRole.length} active user{activeUsersForRole.length === 1 ? '' : 's'} will get this
                change immediately on save.
              </p>
            )}
          </div>
        </div>
      )}

      {selectedRoleId && (
        <>
          <ErrorNotice error={saveMutation.error} />
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={!dirty || saveMutation.isPending}
              className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Save
            </button>
            {saveMutation.isSuccess && !dirty && <span className="text-xs text-emerald-600">Saved.</span>}
          </div>
        </>
      )}
    </section>
  );
}

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function defaultExpiryDate(): string {
  return toDateInputValue(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000));
}
function minExpiryDate(): string {
  return toDateInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000));
}
function maxExpiryDate(): string {
  return toDateInputValue(new Date(Date.now() + MAX_ROLE_ACCESS_GRANT_DAYS * 24 * 60 * 60 * 1000));
}

function RoleAccessSection({
  currentUserId,
  focusUserId,
  onFocusUserIdChange,
}: {
  currentUserId: string;
  focusUserId: string | null;
  onFocusUserIdChange: (userId: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const grantableRolesQuery = useQuery({ queryKey: ['role-access', 'grantable-roles'], queryFn: listGrantableRoles });

  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [expiresAt, setExpiresAt] = useState(defaultExpiryDate());
  const [notes, setNotes] = useState('');

  // Clicking "Grant access" on a roster row (RosterSection) focuses this form on that
  // user, rather than making the admin re-find them in the dropdown below.
  useEffect(() => {
    if (focusUserId) {
      setSelectedUserId(focusUserId);
    }
  }, [focusUserId]);

  const capabilitiesQuery = useQuery({
    queryKey: ['role-capabilities', selectedRole],
    queryFn: () => getRoleCapabilities(selectedRole),
    enabled: !!selectedRole,
  });

  const grantMutation = useMutation({
    mutationFn: () =>
      grantRoleAccess({
        userId: selectedUserId,
        roleName: selectedRole,
        expiresAt: new Date(expiresAt).toISOString(),
        notes: notes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['role-access', selectedUserId] });
      setSelectedRole('');
      setNotes('');
      setExpiresAt(defaultExpiryDate());
      onFocusUserIdChange(null);
    },
  });

  // Can't delegate access to an inactive account, and self-grant is blocked server-side
  // (the-fool: self-grant) - excluded here too so the doomed choice is never offered.
  const eligibleRecipients = (usersQuery.data ?? []).filter((u) => u.status === 'ACTIVE' && u.id !== currentUserId);

  return (
    <section>
      <p className="mb-1 text-sm font-semibold text-slate-900">Extra role access</p>
      <p className="mb-3 max-w-2xl text-xs text-slate-400">
        Give a user everything a DIFFERENT role can do, on top of their own real role - e.g. cover a Technical Team
        Leader's access on a capable CCE while the TL is on leave. Their own role, login, and identity never change,
        and access always ends on its own (max {MAX_ROLE_ACCESS_GRANT_DAYS} days out) - there's no standing grant, so
        coverage that needs to run longer is re-granted, not left open-ended.
      </p>
      <ErrorNotice error={grantMutation.error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="User">
          <select
            className={inputClass}
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
          >
            <option value="" disabled>
              Select a user…
            </option>
            {eligibleRecipients.map((u) => (
              <option key={u.id} value={u.id}>
                {u.firstName} {u.lastName} ({u.role.displayName})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Role to delegate" hint="Super Admin, Service Head, and Customer can never be delegated.">
          <select className={inputClass} value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)}>
            <option value="" disabled>
              Select a role…
            </option>
            {grantableRolesQuery.data?.map((r) => (
              <option key={r.id} value={r.name}>
                {r.displayName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Access ends" hint={`Required - up to ${MAX_ROLE_ACCESS_GRANT_DAYS} days out, no standing grants.`}>
          <input
            type="date"
            className={inputClass}
            value={expiresAt}
            min={minExpiryDate()}
            max={maxExpiryDate()}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </Field>
        <Field label="Notes" hint="Optional - why, e.g. 'Covering TL leave 09/15-09/29'.">
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>

      {selectedRole && (
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            What {selectedRole.replaceAll('_', ' ')} access includes
          </p>
          {capabilitiesQuery.isLoading && <p className="text-xs text-slate-400">Loading…</p>}
          {capabilitiesQuery.data && capabilitiesQuery.data.length === 0 && (
            <p className="text-xs text-slate-400">This role has no distinct gated capabilities in the app today.</p>
          )}
          <div className="max-h-64 space-y-3 overflow-y-auto">
            {capabilitiesQuery.data?.map((mod) => (
              <div key={mod.module}>
                <p className="text-xs font-semibold text-slate-600">{mod.module}</p>
                <ul className="mt-1 space-y-0.5">
                  {mod.endpoints.map((ep) => (
                    <li key={`${ep.method} ${ep.path}`} className="text-xs text-slate-500">
                      <span className="font-mono text-slate-400">{ep.method}</span> {ep.summary ?? ep.path}
                      {ep.requiresSeparatePermissionGrant && (
                        <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700">
                          also needs {ep.requiresSeparatePermissionGrant.replaceAll('_', ' ')} grant
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => grantMutation.mutate()}
        disabled={!selectedUserId || !selectedRole || !expiresAt || grantMutation.isPending}
        className="mt-4 rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        Grant
      </button>
    </section>
  );
}

function CreateUserSection() {
  const queryClient = useQueryClient();
  const rolesQuery = useQuery({ queryKey: ['users', 'roles'], queryFn: listCreatableRoles });
  const { register, handleSubmit, reset } = useForm<CreateUserInput>({
    defaultValues: { firstName: '', lastName: '', email: '', employeeId: '', phone: '', password: '', roleName: '' },
  });
  const createMutation = useMutation({
    mutationFn: (values: CreateUserInput) =>
      createUser({
        ...values,
        employeeId: values.employeeId || undefined,
        phone: values.phone || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      reset();
    },
  });

  return (
    <section>
      <p className="mb-1 text-sm font-semibold text-slate-900">Create a user</p>
      <p className="mb-3 text-xs text-slate-400">
        Sets a temporary password directly - tell the new hire what it is (WhatsApp, verbally, a note); they can
        change it themselves afterwards. CUSTOMER isn't offered here - customers use their tracking link, not a
        staff login.
      </p>
      <ErrorNotice error={createMutation.error} />
      <form
        onSubmit={handleSubmit((values) => createMutation.mutate(values))}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <Field label="First name">
          <input className={inputClass} {...register('firstName', { required: true })} />
        </Field>
        <Field label="Last name">
          <input className={inputClass} {...register('lastName', { required: true })} />
        </Field>
        <Field label="Email">
          <input type="email" className={inputClass} {...register('email', { required: true })} />
        </Field>
        <Field label="Employee ID" hint="Optional">
          <input className={inputClass} {...register('employeeId')} />
        </Field>
        <Field label="Phone" hint="Optional">
          <input className={inputClass} {...register('phone')} />
        </Field>
        <Field label="Temporary password" hint="At least 8 characters - shared directly, not emailed.">
          <input type="text" className={inputClass} {...register('password', { required: true, minLength: 8 })} />
        </Field>
        <Field label="Role">
          <select className={inputClass} {...register('roleName', { required: true })}>
            <option value="" disabled>
              Select a role…
            </option>
            {rolesQuery.data?.map((r) => (
              <option key={r.id} value={r.name}>
                {r.displayName}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Create user
          </button>
        </div>
      </form>
    </section>
  );
}
