import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { SignaturePad } from '../../components/SignaturePad';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../lib/auth';
import {
  cancelDelivery,
  capturePod,
  dispatchDelivery,
  getDelivery,
  getDeliveryJobCards,
  listDeliveries,
} from '../../lib/deliveryApi';
import type { Delivery, DeliveryBlocker, DeliveryStatusValue } from '../../lib/deliveryTypes';
import { DeliveryBlockersNotice } from './DeliveryBlockersNotice';
import { RecordPaymentModal } from './RecordPaymentModal';

const DELIVERY_ROLES = ['LOGISTICS_DISPATCHER', 'DRIVER', 'SUPER_ADMIN', 'SERVICE_HEAD'];
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

  const listQuery = useQuery({
    queryKey: ['deliveries', statusFilter],
    queryFn: () => listDeliveries(statusFilter || undefined),
  });

  function select(id: string) {
    setSearchParams({ deliveryId: id });
  }

  const columns: Column<Delivery>[] = [
    { key: 'deliveryNumber', label: 'DLV #', render: (d) => <span className="font-medium text-slate-800">{d.deliveryNumber}</span> },
    { key: 'status', label: 'Status', render: (d) => <StatusBadge status={d.status} /> },
    { key: 'dispatcher', label: 'Dispatcher', render: (d) => <span className="text-xs text-slate-400">{d.dispatcherUserId.slice(0, 8)}…</span> },
    {
      key: 'driver',
      label: 'Driver',
      render: (d) => <span className="text-xs text-slate-400">{d.driverUserId ? `${d.driverUserId.slice(0, 8)}…` : '—'}</span>,
    },
    {
      key: 'timing',
      label: 'Dispatched / Delivered',
      render: (d) => (
        <span className="text-xs text-slate-500">
          {d.dispatchedAt ? new Date(d.dispatchedAt).toLocaleString() : '—'} /{' '}
          {d.deliveredAt ? new Date(d.deliveredAt).toLocaleString() : '—'}
        </span>
      ),
    },
  ];

  return (
    <div className="max-w-4xl space-y-4">
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

      <DataTable
        columns={columns}
        rows={listQuery.data}
        isLoading={listQuery.isLoading}
        error={listQuery.error}
        emptyMessage="No deliveries yet."
        rowActions={(d) => (
          <button onClick={() => select(d.id)} className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            View
          </button>
        )}
      />

      {activeId && <DeliveryDetail id={activeId} />}
    </div>
  );
}

function DeliveryDetail({ id }: { id: string }) {
  const { user } = useAuth();
  const canAct = !!user && DELIVERY_ROLES.includes(user.role.name);
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
                  {jc.jobCardNumber} · {jc.brand ?? 'Unknown brand'} · S/N {jc.serialNumber}
                </span>
                <span className="flex items-center gap-2">
                  <StatusBadge status={jc.warrantyStatus} />
                  <Link to={`/workshop-inventory/workshop?jobCardId=${jc.id}`} className="text-slate-500 underline">
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
  const { register, handleSubmit } = useForm<{ driverUserId: string }>({ defaultValues: { driverUserId: '' } });
  const { register: registerCancel, handleSubmit: handleCancelSubmit } = useForm<{ reason: string }>({ defaultValues: { reason: '' } });
  const dispatchMutation = useMutation({
    mutationFn: (driverUserId?: string) => dispatchDelivery(delivery.id, { driverUserId: driverUserId || undefined }),
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
        <p className="mb-2 text-xs text-slate-400">
          Driver is optional and can be recorded later - same "paste a user id" convention as
          Permissions grants (there's no user-picker anywhere in this app yet).
        </p>
        <form onSubmit={handleSubmit((v) => dispatchMutation.mutate(v.driverUserId.trim()))} className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="Driver user id (optional)">
              <input className={inputClass} {...register('driverUserId')} placeholder="Paste the driver's user id" />
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
