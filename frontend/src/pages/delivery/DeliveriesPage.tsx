import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { SignaturePad } from '../../components/SignaturePad';
import { StatusBadge } from '../../components/StatusBadge';
import { NamePicker } from '../../components/pickers/NamePicker';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import {
  cancelDelivery,
  capturePod,
  dispatchDelivery,
  getDelivery,
  getDeliveryJobCards,
  listDeliveries,
  listDrivers,
} from '../../lib/deliveryApi';
import type { Delivery, DeliveryBlocker, DeliveryListRow, DeliveryStatusValue } from '../../lib/deliveryTypes';
import { DeliveryBlockersNotice } from './DeliveryBlockersNotice';
import { RecordPaymentModal } from './RecordPaymentModal';

const STATUS_FILTERS: { label: string; value: DeliveryStatusValue | '' }[] = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Dispatched', value: 'DISPATCHED' },
  { label: 'Delivered', value: 'DELIVERED' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

export function DeliveriesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = searchParams.get('deliveryId') ?? '';
  const [statusFilter, setStatusFilter] = useState<DeliveryStatusValue | ''>('');

  // Modification Request (2026-09-15, Delivery & Invoicing screen): same date range +
  // debounced 2-character search convention as ReadyForDeliveryPage.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const effectiveSearch = debouncedSearch.length >= 2 ? debouncedSearch : undefined;

  const listQuery = useQuery({
    queryKey: ['deliveries', statusFilter, dateFrom, dateTo, effectiveSearch],
    queryFn: () => listDeliveries(statusFilter || undefined, { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, q: effectiveSearch }),
  });

  function select(id: string) {
    setSearchParams({ deliveryId: id });
  }

  // Modification Request: View now opens a popup instead of an inline section the user had
  // to scroll down to - closing just clears the deliveryId param (statusFilter/date/search
  // above are local state, not URL params, so this can't disturb them).
  function closeDetail() {
    setSearchParams({});
  }

  function setToday() {
    const today = new Date().toISOString().slice(0, 10);
    setDateFrom(today);
    setDateTo(today);
  }

  const columns: Column<DeliveryListRow>[] = [
    { key: 'deliveryNumber', label: 'DLV #', render: (d) => <span className="font-medium text-slate-800">{d.deliveryNumber}</span> },
    { key: 'status', label: 'Status', render: (d) => <StatusBadge status={d.status} /> },
    { key: 'dispatcher', label: 'Dispatcher', render: (d) => <span className="text-slate-400">{d.dispatcherUserId.slice(0, 8)}…</span> },
    {
      key: 'driver',
      label: 'Driver',
      render: (d) => <span>{d.driverName ?? '—'}</span>,
    },
    {
      key: 'dispatched',
      label: 'Dispatched',
      render: (d) => <span className="text-slate-500">{d.dispatchedAt ? new Date(d.dispatchedAt).toLocaleString() : '—'}</span>,
    },
    {
      key: 'delivered',
      label: 'Delivered',
      render: (d) => <span className="text-slate-500">{d.deliveredAt ? new Date(d.deliveredAt).toLocaleString() : '—'}</span>,
    },
    {
      key: 'jobCards',
      label: 'Job Card',
      render: (d) =>
        d.jobCards.length === 0 ? (
          <span className="text-slate-400">—</span>
        ) : (
          <span>{d.jobCards.map((jc) => jc.jobCardNumber).join(', ')}</span>
        ),
    },
    {
      key: 'customerType',
      label: 'Customer Type',
      render: (d) => <span>{d.customerType ?? '—'}</span>,
    },
  ];

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap gap-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              statusFilter === f.value ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            {f.label}
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
          <button
            type="button"
            onClick={() => {
              setDateFrom('');
              setDateTo('');
            }}
            className="text-xs text-slate-400 underline hover:text-slate-600"
          >
            Clear dates
          </button>
        )}
        <div className="min-w-[16rem] flex-1">
          <Field label="Search" hint="DLV #, job #, customer name or phone - type 2+ characters">
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

      <DataTable
        columns={columns}
        rows={listQuery.data}
        isLoading={listQuery.isLoading}
        error={listQuery.error}
        emptyMessage="No deliveries yet."
        maxHeightClassName="max-h-[28rem] overflow-y-auto"
        dense
        rowActions={(d) => (
          <button onClick={() => select(d.id)} className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            View
          </button>
        )}
      />

      <Modal open={!!activeId} onClose={closeDetail} title="Delivery details" maxWidthClassName="max-w-2xl">
        {activeId && <DeliveryDetail id={activeId} />}
      </Modal>
    </div>
  );
}

function DeliveryDetail({ id }: { id: string }) {
  // 2026-09-14: was a hardcoded DELIVERY_ROLES role array - now reads the real capability
  // the backend's own dispatch/capture-pod/cancel actions require, so a Designation-access
  // grant to some other role actually shows this screen's action forms.
  const { has } = useMyCapabilities();
  const canAct = has('DELIVERY_MANAGE');
  const queryClient = useQueryClient();

  const deliveryQuery = useQuery({ queryKey: ['delivery', id], queryFn: () => getDelivery(id) });
  const jobCardsQuery = useQuery({ queryKey: ['delivery', id, 'job-cards'], queryFn: () => getDeliveryJobCards(id) });

  function onChanged() {
    queryClient.invalidateQueries({ queryKey: ['delivery', id] });
    queryClient.invalidateQueries({ queryKey: ['delivery', id, 'job-cards'] });
    queryClient.invalidateQueries({ queryKey: ['deliveries'] });
  }

  if (deliveryQuery.isLoading) return <p className="text-sm text-slate-400">Loading delivery…</p>;
  if (deliveryQuery.error) return <ErrorNotice error={deliveryQuery.error} />;
  if (!deliveryQuery.data) return null;
  const delivery = deliveryQuery.data;

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-slate-900">{delivery.deliveryNumber}</p>
          <p className="text-xs text-slate-400">
            Dispatcher {delivery.dispatcherUserId.slice(0, 8)}…
            {delivery.driverUserId && <> · Driver {delivery.driverUserId.slice(0, 8)}…</>}
          </p>
        </div>
        <StatusBadge status={delivery.status} />
      </div>

      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
          Job cards in this delivery ({jobCardsQuery.data?.length ?? '…'})
        </p>
        {jobCardsQuery.isLoading && <p className="text-xs text-slate-400">Loading…</p>}
        {jobCardsQuery.error && <ErrorNotice error={jobCardsQuery.error} />}
        {jobCardsQuery.data && (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {jobCardsQuery.data.map((jc) => (
              <li key={jc.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                <span className="text-slate-700">
                  {jc.jobCardNumber} · {jc.brand ?? 'Unknown brand'} · S/N {jc.serialNumber ?? '—'}
                </span>
                <span className="flex items-center gap-2">
                  {jc.warrantyStatus && <StatusBadge status={jc.warrantyStatus} />}
                  <Link to={`/job-cards/journey?jobCardId=${jc.id}`} className="text-slate-500 underline">
                    Journey →
                  </Link>
                  <Link to={`/workshop?jobCardId=${jc.id}`} className="text-slate-500 underline">
                    Details →
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {delivery.status === 'PENDING' && canAct && <DispatchAndCancel delivery={delivery} onChanged={onChanged} />}
      {delivery.status === 'DISPATCHED' && canAct && <CapturePodForm delivery={delivery} onChanged={onChanged} />}
      {delivery.status === 'DELIVERED' && <PodSummary delivery={delivery} />}
      {delivery.status === 'CANCELLED' && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Cancelled: {delivery.cancellationReason}
        </p>
      )}
    </div>
  );
}

function DispatchAndCancel({ delivery, onChanged }: { delivery: Delivery; onChanged: () => void }) {
  const { register: registerCancel, handleSubmit: handleCancelSubmit } = useForm<{ reason: string }>({ defaultValues: { reason: '' } });
  const [driverUserId, setDriverUserId] = useState<string | null>(null);
  // #218: DELIVERY_MANAGE-gated, same capability as the dispatch action itself, so this
  // resolves for every caller who can even reach this form - no raw-paste fallback needed.
  const { data: drivers, isLoading: driversLoading } = useQuery({ queryKey: ['delivery', 'drivers'], queryFn: listDrivers });
  const driverOptions = drivers ?? [];
  const dispatchMutation = useMutation({
    mutationFn: (id: string | null) => dispatchDelivery(delivery.id, { driverUserId: id ?? undefined }),
    onSuccess: onChanged,
  });
  const cancelMutation = useMutation({
    mutationFn: (reason: string) => cancelDelivery(delivery.id, { reason }),
    onSuccess: onChanged,
  });

  return (
    <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Dispatch</p>
        <ErrorNotice error={dispatchMutation.error} />
        <p className="mb-2 text-xs text-slate-400">Driver is optional and can be recorded later.</p>
        <form
          onSubmit={(e) => { e.preventDefault(); dispatchMutation.mutate(driverUserId); }}
          className="flex items-end gap-2"
        >
          <div className="flex-1">
            <Field label="Driver (optional)">
              <NamePicker value={driverUserId} onChange={setDriverUserId} options={driverOptions} loading={driversLoading} />
            </Field>
          </div>
          <button
            type="submit"
            disabled={dispatchMutation.isPending}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Dispatch
          </button>
        </form>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Cancel</p>
        <ErrorNotice error={cancelMutation.error} />
        <p className="mb-2 text-xs text-slate-400">Releases every job card back to the ready-for-delivery pool. Only possible before dispatch.</p>
        <form
          onSubmit={handleCancelSubmit((v) => cancelMutation.mutate(v.reason))}
          className="flex items-end gap-2"
        >
          <div className="flex-1">
            <Field label="Reason">
              <input className={inputClass} {...registerCancel('reason', { required: true, minLength: 3 })} />
            </Field>
          </div>
          <button
            type="submit"
            disabled={cancelMutation.isPending}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Cancel Delivery
          </button>
        </form>
      </div>
    </div>
  );
}

// AC-12: POD mandatory (signature OR photo). Signature capture uses a real canvas-based
// SignaturePad (components/SignaturePad.tsx) - previously a known UX gap in STATUS_TRACKER's
// deferred-follow-ups list ("no signature-pad library... plain file upload only"), fixed as
// a small polish item. Photo capture stays a plain file upload (camera-capture wasn't part
// of this round). Both still end up as the same base64 data URI string the backend has
// always stored as-is (capped ~2.8M chars, format-agnostic) - SignaturePad's onChange and
// the photo input's FileReader both just call setSignatureBase64/setPhotoBase64, so nothing
// downstream of this form changed.
function CapturePodForm({ delivery, onChanged }: { delivery: Delivery; onChanged: () => void }) {
  const { register, handleSubmit, watch } = useForm<{ recipientName: string; notes: string }>({
    defaultValues: { recipientName: '', notes: '' },
  });
  const [signatureBase64, setSignatureBase64] = useState<string | undefined>();
  const [photoBase64, setPhotoBase64] = useState<string | undefined>();
  const [paymentTarget, setPaymentTarget] = useState<{ jobCardId: string; invoiceId?: string } | null>(null);

  const mutation = useMutation({
    mutationFn: (data: { recipientName: string; notes?: string }) =>
      capturePod(delivery.id, { ...data, signatureBase64, photoBase64 }),
    onSuccess: onChanged,
  });

  const blockers = (mutation.error as AxiosError<{ message?: string; blockers?: DeliveryBlocker[] }> | null)?.response?.data?.blockers;

  function readAsDataUrl(file: File, onDone: (dataUrl: string) => void) {
    const reader = new FileReader();
    reader.onload = () => onDone(reader.result as string);
    reader.readAsDataURL(file);
  }

  const recipientName = watch('recipientName');

  return (
    <div className="border-t border-slate-100 pt-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Capture Proof of Delivery</p>
      {mutation.error && !blockers?.length && <ErrorNotice error={mutation.error} />}
      {!!blockers?.length && (
        <div className="mb-3">
          <DeliveryBlockersNotice blockers={blockers} onRecordPayment={(jobCardId, invoiceId) => setPaymentTarget({ jobCardId, invoiceId })} />
          <p className="mt-1 text-xs text-slate-400">
            Re-checked at hand-back time (AC-11) even though this batch was payable when created - resolve payment above, then try again.
          </p>
        </div>
      )}
      <form
        onSubmit={handleSubmit((v) => mutation.mutate({ recipientName: v.recipientName, notes: v.notes || undefined }))}
        className="space-y-2"
      >
        <Field label="Recipient name">
          <input className={inputClass} {...register('recipientName', { required: true })} />
        </Field>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Signature" hint={signatureBase64 ? 'Attached' : 'Signature OR photo is required'}>
            <SignaturePad onChange={setSignatureBase64} />
          </Field>
          <Field label="Photo (image file)" hint={photoBase64 ? 'Attached' : 'Signature OR photo is required'}>
            <input
              type="file"
              accept="image/*"
              className={inputClass}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readAsDataUrl(file, setPhotoBase64);
              }}
            />
          </Field>
        </div>
        <Field label="Notes (optional)">
          <input className={inputClass} {...register('notes')} />
        </Field>
        <button
          type="submit"
          disabled={mutation.isPending || !recipientName.trim() || (!signatureBase64 && !photoBase64)}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Mark Delivered
        </button>
      </form>

      {paymentTarget && (
        <RecordPaymentModal
          open={!!paymentTarget}
          onClose={() => setPaymentTarget(null)}
          jobCardId={paymentTarget.jobCardId}
          invoiceId={paymentTarget.invoiceId}
        />
      )}
    </div>
  );
}

function PodSummary({ delivery }: { delivery: Delivery }) {
  return (
    <div className="border-t border-slate-100 pt-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Proof of Delivery</p>
      <p className="mb-2 text-xs text-slate-500">
        Received by <span className="font-medium text-slate-700">{delivery.podRecipientName}</span>
        {delivery.deliveredAt && <> on {new Date(delivery.deliveredAt).toLocaleString()}</>}
        {delivery.podNotes && <> — {delivery.podNotes}</>}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {delivery.podSignatureBase64 && (
          <div>
            <p className="mb-1 text-xs text-slate-400">Signature</p>
            <img src={delivery.podSignatureBase64} alt="Signature" className="max-h-32 rounded border border-slate-200 bg-white" />
          </div>
        )}
        {delivery.podPhotoBase64 && (
          <div>
            <p className="mb-1 text-xs text-slate-400">Photo</p>
            <img src={delivery.podPhotoBase64} alt="Delivery proof" className="max-h-32 rounded border border-slate-200 bg-white" />
          </div>
        )}
      </div>
    </div>
  );
}
