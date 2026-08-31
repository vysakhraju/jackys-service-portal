import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Checkbox } from '../../components/Field';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../lib/auth';
import { createDelivery, getReadyForDelivery } from '../../lib/deliveryApi';
import type { CreateDeliveryResult, DeliveryBlocker, ReadyForDeliveryRow } from '../../lib/deliveryTypes';
import type { WarrantyStatusValue } from '../../lib/appointmentsTypes';
import { RecordPaymentModal } from './RecordPaymentModal';
import { DeliveryBlockersNotice } from './DeliveryBlockersNotice';

// Plain @Roles() gating on the backend (DELIVERY_ROLES in delivery.controller.ts) -
// deliberately NOT the admin-assignable PermissionsService grant mechanism Phase 6/7
// introduced for QC/rework, which stays scoped there. Unlike QC's role list (a floor
// only, with a separate hidden grant on top), this one IS the real gate, so it's safe to
// hide the whole page behind it rather than just show a warning.
const DELIVERY_ROLES = ['LOGISTICS_DISPATCHER', 'DRIVER', 'SUPER_ADMIN', 'SERVICE_HEAD'];

type Row = ReadyForDeliveryRow & { id: string };

export function ReadyForDeliveryPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const warrantyStatus: WarrantyStatusValue = searchParams.get('warranty') === 'OOW' ? 'OOW' : 'IW';

  const canAct = !!user && DELIVERY_ROLES.includes(user.role.name);

  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [paymentTarget, setPaymentTarget] = useState<{ jobCardId: string; invoiceId?: string } | null>(null);
  const [createdResult, setCreatedResult] = useState<CreateDeliveryResult | null>(null);

  const readyQuery = useQuery({
    queryKey: ['ready-for-delivery', warrantyStatus],
    queryFn: () => getReadyForDelivery(warrantyStatus),
  });
  const rows: Row[] = (readyQuery.data ?? []).map((r) => ({ ...r, id: r.jobCard.id }));

  function switchTab(next: 'IW' | 'OOW') {
    setSearchParams({ warranty: next });
    setSelectedIds(new Set());
    setCreatedResult(null);
  }

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const createMutation = useMutation({
    mutationFn: () => createDelivery({ jobCardIds: Array.from(selectedIds) }),
    onSuccess: (result) => {
      setCreatedResult(result);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['ready-for-delivery'] });
    },
  });

  const blockers = (createMutation.error as AxiosError<{ message?: string; blockers?: DeliveryBlocker[] }> | null)?.response?.data
    ?.blockers;

  const columns: Column<Row>[] = [
    {
      key: 'select',
      label: '',
      render: (r) => <Checkbox label="" checked={selectedIds.has(r.id)} onChange={() => toggle(r.id)} />,
      className: 'w-8',
    },
    {
      key: 'jobCardNumber',
      label: 'Job Card',
      render: (r) => (
        <div>
          <p className="font-medium text-slate-800">{r.jobCard.jobCardNumber}</p>
          <p className="text-xs text-slate-400">
            {r.jobCard.brand ?? 'Unknown brand'} · S/N {r.jobCard.serialNumber}
          </p>
        </div>
      ),
    },
    {
      key: 'warranty',
      label: 'Warranty',
      render: (r) => <StatusBadge status={r.jobCard.warrantyStatus} />,
    },
    ...(warrantyStatus === 'OOW'
      ? [
          {
            key: 'invoice',
            label: 'Invoice',
            render: (r: Row) => (
              <div className="flex items-center gap-2">
                {r.invoiceStatus ? <StatusBadge status={r.invoiceStatus} /> : <span className="text-xs text-slate-400">not yet invoiced</span>}
                <button
                  type="button"
                  onClick={() => setPaymentTarget({ jobCardId: r.jobCard.id })}
                  className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  {r.invoiceStatus ? 'View / pay' : 'Check invoice'}
                </button>
              </div>
            ),
          } satisfies Column<Row>,
        ]
      : []),
  ];

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex gap-1">
        {(['IW', 'OOW'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => switchTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              warrantyStatus === t ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t === 'IW' ? 'In Warranty' : 'Out of Warranty'}
          </button>
        ))}
      </div>

      {!canAct && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Your role ({user?.role.displayName}) can't create or manage deliveries - this list is read-only for you.
        </p>
      )}

      <DataTable columns={columns} rows={rows} isLoading={readyQuery.isLoading} error={readyQuery.error} emptyMessage="Nothing QC-passed and unclaimed right now." />

      {canAct && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          {createdResult && (
            <p className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              Created <span className="font-medium">{createdResult.delivery.deliveryNumber}</span> with{' '}
              {createdResult.jobCards.length} job card{createdResult.jobCards.length === 1 ? '' : 's'}.{' '}
              <Link to={`/delivery/deliveries?deliveryId=${createdResult.delivery.id}`} className="font-medium underline">
                Go dispatch it →
              </Link>
            </p>
          )}
          {createMutation.error && !blockers?.length && <ErrorNotice error={createMutation.error} />}
          {!!blockers?.length && (
            <div className="mb-3">
              <DeliveryBlockersNotice blockers={blockers} onRecordPayment={(jobCardId, invoiceId) => setPaymentTarget({ jobCardId, invoiceId })} />
            </div>
          )}
          <p className="mb-2 text-xs text-slate-400">
            {selectedIds.size === 0
              ? 'Select one or more job cards above to batch (or normal, N=1) them into a single delivery.'
              : `${selectedIds.size} job card${selectedIds.size === 1 ? '' : 's'} selected.`}{' '}
            For Out of Warranty, every member must be fully paid (or B2B Credit) - the whole batch is blocked otherwise, not just the unpaid ones.
          </p>
          <button
            onClick={() => createMutation.mutate()}
            disabled={selectedIds.size === 0 || createMutation.isPending}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Create Delivery
          </button>
        </div>
      )}

      {paymentTarget && (
        <RecordPaymentModal
          open={!!paymentTarget}
          onClose={() => setPaymentTarget(null)}
          jobCardId={paymentTarget.jobCardId}
          invoiceId={paymentTarget.invoiceId}
          onPaid={() => queryClient.invalidateQueries({ queryKey: ['ready-for-delivery'] })}
        />
      )}
    </div>
  );
}
