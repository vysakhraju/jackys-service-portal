import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ActiveBadge, DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { useAuth } from '../../lib/auth';
import { grantPermission, listGrantsByType, listGrantsForUser, revokePermission } from '../../lib/permissionsApi';
import { PERMISSION_TYPES, type PermissionTypeValue, type UserPermissionGrant } from '../../lib/permissionsTypes';

// Granting/revoking is itself a high-trust admin action - mirrors PERMISSION_ADMIN_ROLES
// in permissions.controller.ts exactly (deliberately narrower than QC_GATE_ROLES: only
// SUPER_ADMIN/SERVICE_HEAD decide who holds QC_APPROVAL/REWORK_APPROVAL, not TLs/CCE/QC
// Officer themselves).
const PERMISSION_ADMIN_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD'];

export function PermissionsPage() {
  const { user } = useAuth();
  const isAdmin = !!user && PERMISSION_ADMIN_ROLES.includes(user.role.name);

  if (!isAdmin) {
    return (
      <p className="max-w-2xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
        Permissions administration is restricted to Super Admin / Service Head - every endpoint on this screen
        (grant, revoke, and both list views) is admin-only server-side.
      </p>
    );
  }

  return (
    <div className="max-w-3xl space-y-8">
      <WhoHoldsSection />
      <GrantSection />
      <UserHistorySection />
    </div>
  );
}

function WhoHoldsSection() {
  const [type, setType] = useState<PermissionTypeValue>('QC_APPROVAL');
  const queryClient = useQueryClient();
  const listQuery = useQuery({
    queryKey: ['permission-grants', 'by-type', type],
    queryFn: () => listGrantsByType(type),
  });
  const revokeMutation = useMutation({
    mutationFn: (grant: UserPermissionGrant) => revokePermission({ userId: grant.userId, permissionType: grant.permissionType }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['permission-grants'] }),
  });

  const columns: Column<UserPermissionGrant>[] = [
    {
      key: 'user',
      label: 'Holder',
      render: (g) => (g.user ? `${g.user.firstName} ${g.user.lastName} (${g.user.email})` : g.userId),
    },
    { key: 'grantedAt', label: 'Granted', render: (g) => new Date(g.grantedAt).toLocaleString() },
    {
      key: 'grantedBy',
      label: 'Granted by',
      render: (g) => (g.grantedBy ? `${g.grantedBy.firstName} ${g.grantedBy.lastName}` : g.grantedByUserId),
    },
    { key: 'notes', label: 'Notes', render: (g) => g.notes ?? '—' },
  ];

  return (
    <section>
      <p className="mb-1 text-sm font-semibold text-slate-900">Who currently holds a permission</p>
      <p className="mb-3 text-xs text-slate-400">
        GET /permissions?type=X is the one real list endpoint in this module - use it before granting or revoking
        so you're not acting blind.
      </p>
      <div className="mb-3 w-64">
        <Field label="Permission type">
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as PermissionTypeValue)}>
            {PERMISSION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ErrorNotice error={revokeMutation.error} />
      <DataTable
        columns={columns}
        rows={listQuery.data}
        isLoading={listQuery.isLoading}
        error={listQuery.error}
        emptyMessage="Nobody currently holds this permission."
        rowActions={(g) => (
          <button
            onClick={() => revokeMutation.mutate(g)}
            disabled={revokeMutation.isPending}
            className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Revoke
          </button>
        )}
      />
    </section>
  );
}

function GrantSection() {
  const queryClient = useQueryClient();
  const { register, handleSubmit, reset } = useForm<{ userId: string; permissionType: PermissionTypeValue; notes: string }>({
    defaultValues: { userId: '', permissionType: 'QC_APPROVAL', notes: '' },
  });
  const grantMutation = useMutation({
    mutationFn: (values: { userId: string; permissionType: PermissionTypeValue; notes: string }) =>
      grantPermission({ userId: values.userId, permissionType: values.permissionType, notes: values.notes || undefined }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['permission-grants'] }),
  });

  return (
    <section className="border-t border-slate-200 pt-6">
      <p className="mb-1 text-sm font-semibold text-slate-900">Grant a permission</p>
      <p className="mb-3 text-xs text-slate-400">
        Same "no list-users endpoint" convention as everywhere else on this app - paste the user's id (check the
        "who currently holds this" list above first, or the history lookup below, if you're not sure they already
        have it: the backend 409s on a duplicate active grant).
      </p>
      <ErrorNotice error={grantMutation.error} />
      <form
        onSubmit={handleSubmit((values) => grantMutation.mutate(values, { onSuccess: () => reset() }))}
        className="space-y-3"
      >
        <Field label="User id">
          <input className={inputClass} {...register('userId', { required: true })} />
        </Field>
        <Field label="Permission type">
          <select className={inputClass} {...register('permissionType', { required: true })}>
            {PERMISSION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes" hint="Optional - why this grant was made.">
          <input className={inputClass} {...register('notes')} />
        </Field>
        <button
          type="submit"
          disabled={grantMutation.isPending}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Grant
        </button>
      </form>
    </section>
  );
}

function UserHistorySection() {
  const [userIdInput, setUserIdInput] = useState('');
  const [activeUserId, setActiveUserId] = useState('');
  const historyQuery = useQuery({
    queryKey: ['permission-grants', 'by-user', activeUserId],
    queryFn: () => listGrantsForUser(activeUserId),
    enabled: !!activeUserId,
    retry: false,
  });

  const columns: Column<UserPermissionGrant>[] = [
    { key: 'permissionType', label: 'Type', render: (g) => g.permissionType.replaceAll('_', ' ') },
    { key: 'status', label: 'Status', render: (g) => <ActiveBadge active={g.revokedAt === null} /> },
    { key: 'grantedAt', label: 'Granted', render: (g) => new Date(g.grantedAt).toLocaleString() },
    { key: 'revokedAt', label: 'Revoked', render: (g) => (g.revokedAt ? new Date(g.revokedAt).toLocaleString() : '—') },
    { key: 'notes', label: 'Notes', render: (g) => g.notes ?? '—' },
  ];

  return (
    <section className="border-t border-slate-200 pt-6">
      <p className="mb-1 text-sm font-semibold text-slate-900">Look up a user's full grant history</p>
      <p className="mb-3 text-xs text-slate-400">
        GET /permissions/users/:userId - active and revoked grants, most recent first.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setActiveUserId(userIdInput.trim());
        }}
        className="mb-3 flex items-end gap-2"
      >
        <div className="flex-1">
          <Field label="User id">
            <input className={inputClass} value={userIdInput} onChange={(e) => setUserIdInput(e.target.value)} />
          </Field>
        </div>
        <button
          type="submit"
          disabled={!userIdInput.trim()}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Look up
        </button>
      </form>
      {activeUserId && (
        <DataTable
          columns={columns}
          rows={historyQuery.data}
          isLoading={historyQuery.isLoading}
          error={historyQuery.error}
          emptyMessage="This user has never held a permission grant."
        />
      )}
    </section>
  );
}
