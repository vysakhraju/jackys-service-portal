import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { useAuth } from '../../lib/auth';
import type { User } from '../../lib/types';
import {
  createUser,
  deactivateUser,
  listCreatableRoles,
  listUsers,
  reactivateUser,
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
export function UsersPage() {
  const { user: currentUser } = useAuth();
  const isAdmin = !!currentUser && USER_MANAGEMENT_ADMIN_ROLES.includes(currentUser.role.name);
  const [grantFocusUserId, setGrantFocusUserId] = useState<string | null>(null);

  if (!isAdmin) {
    return (
      <p className="max-w-2xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
        User management is restricted to Super Admin / Service Head - every endpoint on this screen (list, create,
        edit role, deactivate, reactivate, extra role-access grants) is admin-only server-side.
      </p>
    );
  }

  return (
    <div className="max-w-4xl space-y-8 p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Users</p>
        <h1 className="mt-0.5 text-xl font-semibold text-slate-900">Create staff accounts and manage roles</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Every account with real access to this app - CCE, Technical Team Leader, technicians, finance staff, and
          so on - is created and assigned a role here.
        </p>
      </div>
      <RosterSection currentUserId={currentUser!.id} onGrantAccess={setGrantFocusUserId} />
      <RoleAccessSection currentUserId={currentUser!.id} focusUserId={grantFocusUserId} onFocusUserIdChange={setGrantFocusUserId} />
      <CreateUserSection />
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

function RosterSection({ currentUserId, onGrantAccess }: { currentUserId: string; onGrantAccess: (userId: string) => void }) {
  const queryClient = useQueryClient();
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const rolesQuery = useQuery({ queryKey: ['users', 'roles'], queryFn: listCreatableRoles });

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
          className={`${inputClass} py-1`}
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

  return (
    <section>
      <p className="mb-1 text-sm font-semibold text-slate-900">Roster</p>
      <p className="mb-3 text-xs text-slate-400">
        Changing a role re-checks the same open-job/appointment/spare-custody guard as deactivating - a change that
        would orphan work still in progress is blocked, not silently applied. "Extra access" is a separate,
        time-boxed delegation on top of a user's own role (e.g. covering someone's leave) - grant or revoke it below.
      </p>
      <ErrorNotice error={pendingError} />
      <DataTable
        columns={columns}
        rows={usersQuery.data}
        isLoading={usersQuery.isLoading}
        error={usersQuery.error}
        emptyMessage="No users yet - create the first one below."
        rowActions={(u) =>
          u.id === currentUserId ? (
            <span className="text-xs text-slate-400">You can't modify your own account here</span>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onGrantAccess(u.id)}
                className="rounded-md border border-indigo-300 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
              >
                Grant access
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
    <section className="border-t border-slate-200 pt-6">
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
    <section className="border-t border-slate-200 pt-6">
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
