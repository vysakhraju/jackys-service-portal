import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Checkbox, Field, inputClass } from '../../components/Field';
import { StatusBadge } from '../../components/StatusBadge';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { createDelivery, getReadyForDelivery } from '../../lib/deliveryApi';
import type { CreateDeliveryResult, DeliveryBlocker, ReadyForDeliveryRow } from '../../lib/deliveryTypes';
import type { WarrantyStatusValue } from '../../lib/appointmentsTypes';
import { RecordPaymentModal } from './RecordPaymentModal';
import { DeliveryBlockersNotice } from './DeliveryBlockersNotice';

type Row = ReadyForDeliveryRow & { id: string };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Modification Request (2026-09-15): "12-Sep-26" - date only, no time, matches the format
// requested for the new Created date column.
function formatDateOnly(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate().toString().padStart(2, '0');
  const month = d.toLocaleString('en-US', { month: 'short' });
  const year = d.getFullYear().toString().slice(-2);
  return `${day}-${month}-${year}`;
}

export function ReadyForDeliveryPage() {
  // 2026-09-14: was a hardcoded DELIVERY_ROLES role array - delivery.controller.ts's own
  // create-delivery action is @RequiresCapability('DELIVERY_MANAGE'), the real gate (this
  // is the same capability as DeliveriesPage's own gate, not a QC-style floor-only check),
  // so a Designation-access grant to some other role now actually unlocks the create-batch
  // controls here instead of only ever working for the 4 hardcoded roles.
  const { has } = useMyCapabilities();
  const [searchParams, setSearchParams] = useSearchParams();
  const warrantyStatus: WarrantyStatusValue = searchParams.get('warranty') === 'OOW' ? 'OOW' : 'IW';

  const canAct = has('DELIVERY_MANAGE');

  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [paymentTarget, setPaymentTarget] = useState<{ jobCardId: string; invoiceId?: string } | null>(null);
  const [createdResult, setCreatedResult] = useState<CreateDeliveryResult | null>(null);

  // Modification Request (2026-09-15, Delivery & Invoicing screen): date range + search
  // filters, and an internally-scrolling table (the list is meant to stay small, but a
  // batch left sitting uncollected can make it grow over time). Search mirrors the
  // "type 2 characters" threshold the rest of the app already uses (AsyncSearchPicker) -
  // debounced client-side, only sent to the backend once it clears that threshold.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const effectiveSearch = debouncedSearch.length >= 2 ? debouncedSearch : undefined;

  const readyQuery = useQuery({
    queryKey: ['ready-for-delivery', warrantyStatus, dateFrom, dateTo, effectiveSearch],
    queryFn: () => getReadyForDelivery(warrantyStatus, { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, q: effectiveSearch }),
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

  function setToday() {
    const today = todayIso();
    setDateFrom(today);
    setDateTo(today);
  }

  function clearDateRange() {
    setDateFrom('');
    setDateTo('');
  }

  // Takes the id list explicitly (rather than reading `selectedIds` from closure) so the
  // same mutation backs both the batch "Create Delivery" button below AND each row's
  // single-job pill without a setState-then-mutate race - a pill click never has to wait
  // for selectedIds to update first.
  const createMutation = useMutation({
    mutationFn: (jobCardIds: string[]) => createDelivery({ jobCardIds }),
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
          <p className="font-medium text-slate-800">
            {r.jobCard.jobCardNumber}{' '}
            <Link
              to={`/job-cards/journey?jobCardId=${r.jobCard.id}`}
              className="text-xs font-normal text-slate-400 underline"
            >
              Journey →
            </Link>
          </p>
          <p className="text-xs text-slate-400">S/N {r.jobCard.serialNumber}</p>
        </div>
      ),
    },
    {
      key: 'customerType',
      label: 'Customer Type',
      render: (r) => <span>{r.jobCard.appointment?.customerType ?? '—'}</span>,
    },
    {
      key: 'brand',
      label: 'Brand',
      render: (r) => <span>{r.jobCard.brand ?? 'Unknown'}</span>,
    },
    {
      key: 'model',
      label: 'Model',
      render: (r) => <span>{r.jobCard.appointment?.modelNumber ?? '—'}</span>,
    },
    {
      key: 'createdDate',
      label: 'Created Date',
      render: (r) => <span>{formatDateOnly(r.jobCard.createdAt)}</span>,
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
    ...(canAct
      ? [
          {
            key: 'createDelivery',
            label: '',
            render: (r: Row) => (
              <button
                type="button"
                aria-label={`Create delivery for ${r.jobCard.jobCardNumber}`}
                onClick={() => createMutation.mutate([r.jobCard.id])}
                disabled={createMutation.isPending}
                className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              >
                Create Delivery
              </button>
            ),
          } satisfies Column<Row>,
        ]
      : []),
  ];

  return (
    <div className="max-w-5xl space-y-4">
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

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <Field label="From date">
          <input type="date" className={`${inputClass} w-36`} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </Field>
        <Field label="To date">
          <input type="date" className={`${inputClass} w-36`} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </Field>
        <button type="button" onClick={setToday} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
          Today
        </button>
        {(dateFrom || dateTo) && (
          <button type="button" onClick={clearDateRange} className="text-xs text-slate-400 underline hover:text-slate-600">
            Clear dates
          </button>
        )}
        <div className="min-w-[16rem] flex-1">
          <Field label="Search" hint="Job #, appointment #, customer name or phone - type 2+ characters">
            <input
              type="text"
              className={inputClass}
              placeholder="Search…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {!canAct && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          You don't hold the DELIVERY_MANAGE capability, so you can't create or manage
          deliveries - this list is read-only for you.
        </p>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        isLoading={readyQuery.isLoading}
        error={readyQuery.error}
        emptyMessage="Nothing QC-passed and unclaimed right now."
        maxHeightClassName="max-h-[28rem] overflow-y-auto"
        dense
      />

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
              ? 'Select one or more job cards above to batch (or normal, N=1) them into a single delivery, or use the Create Delivery pill on any row for a quick single-job delivery.'
              : `${selectedIds.size} job card${selectedIds.size === 1 ? '' : 's'} selected.`}{' '}
            For Out of Warranty, every member must be fully paid (or B2B Credit) - the whole batch is blocked otherwise, not just the unpaid ones.
          </p>
          <button
            onClick={() => createMutation.mutate(Array.from(selectedIds))}
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
