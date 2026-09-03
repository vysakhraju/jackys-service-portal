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
export function UsersPage() {
  const { user: currentUser } = useAuth();
  const isAdmin = !!currentUser && USER_MANAGEMENT_ADMIN_ROLES.includes(currentUser.role.name);

  if (!isAdmin) {
    return (
      <p className="max-w-2xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
        User management is restricted to Super Admin / Service Head - every endpoint on this screen (list, create,
        edit role, deactivate, reactivate) is admin-only server-side.
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
      <RosterSection currentUserId={currentUser!.id} />
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

function RosterSection({ currentUserId }: { currentUserId: string }) {
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
  ];

  return (
    <section>
      <p className="mb-1 text-sm font-semibold text-slate-900">Roster</p>
      <p className="mb-3 text-xs text-slate-400">
        Changing a role re-checks the same open-job/appointment/spare-custody guard as deactivating - a change that
        would orphan work still in progress is blocked, not silently applied.
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
          ) : u.status === 'ACTIVE' ? (
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
          )
        }
      />
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
