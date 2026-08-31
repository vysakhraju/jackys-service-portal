import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { ErrorNotice } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../lib/auth';
import { confirmReturn, getStaleReservations, getStock, grn, reviewReservation } from '../../lib/inventoryApi';
import { listSpareParts } from '../../lib/masterDataApi';
import type { InventoryReservation, InventoryReservationWithAge, StockLookupResult } from '../../lib/inventoryTypes';

// Same role sets as InventoryController's own @Roles() - shown here so buttons only
// appear for someone who could actually use them, not as a substitute for the server's
// own check.
const INVENTORY_STAFF_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'WAREHOUSE_CLERK'];
const REVIEW_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER'];

export function InventoryPage() {
  const { user } = useAuth();
  const canGrn = !!user && INVENTORY_STAFF_ROLES.includes(user.role.name);
  const canConfirmReturn = !!user && INVENTORY_STAFF_ROLES.includes(user.role.name);
  const canReview = !!user && REVIEW_ROLES.includes(user.role.name);

  const queryClient = useQueryClient();
  const staleQuery = useQuery({ queryKey: ['reservations', 'stale'], queryFn: getStaleReservations });
  function onReservationChanged() {
    queryClient.invalidateQueries({ queryKey: ['reservations', 'stale'] });
  }

  return (
    <div className="max-w-3xl space-y-8">
      <p className="max-w-2xl text-sm text-slate-500">
        Stock and GRN are scoped to one spare part at a time (paste its id, same
        convention as Spare Parts / Warranty Master) - the backend has no "list all
        stock" endpoint. Stale Reservations below is the one real list this module has.
      </p>

      {canGrn && <GrnCard />}

      <StockLookupCard />

      <div>
        <p className="mb-1 text-sm font-medium text-slate-800">
          Stale reservations, all jobs ({staleQuery.data?.length ?? 0})
        </p>
        <p className="mb-3 text-xs text-slate-400">
          Idle 24h+ since last request/review, or whose custodian was deactivated (surfaced
          first regardless of age) - oldest first. A reservation that's short of stock but
          under 24h old won't be here yet; check the requesting Job Card's Workshop screen
          for that.
        </p>
        {staleQuery.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
        {staleQuery.error && <ErrorNotice error={staleQuery.error} />}
        {staleQuery.data && staleQuery.data.length === 0 && (
          <p className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">
            Nothing idle right now.
          </p>
        )}
        {staleQuery.data && staleQuery.data.length > 0 && (
          <div className="space-y-2">
            {staleQuery.data.map((r) => (
              <ReservationRow key={r.id} reservation={r} canReview={canReview} onChanged={onReservationChanged} />
            ))}
          </div>
        )}
      </div>

      {canConfirmReturn && <ConfirmReturnCard />}
    </div>
  );
}

function GrnCard() {
  const sparePartsQuery = useQuery({ queryKey: ['spare-parts', 'active'], queryFn: () => listSpareParts({ active: true }) });
  const queryClient = useQueryClient();
  const { register, handleSubmit, reset, watch } = useForm<{ sparePartId: string; quantity: number; notes: string }>({
    defaultValues: { sparePartId: '', quantity: 1, notes: '' },
  });
  const sparePartId = watch('sparePartId');
  const mutation = useMutation({
    mutationFn: (data: { sparePartId: string; quantity: number; notes?: string }) => grn(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['stock', variables.sparePartId] });
    },
  });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="mb-1 text-sm font-medium text-slate-800">Goods Received Note (GRN)</p>
      <p className="mb-3 text-xs text-slate-400">
        Receive new stock into Main Store. Blocked (AC-17) if the spare part isn't linked
        to any model yet - link it first from Master Data → Spare Parts.
      </p>
      <ErrorNotice error={mutation.error} />
      {mutation.isSuccess && (
        <p className="mb-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700">
          Received. Main Store now has {mutation.data.quantityOnHand} on hand for this part.
        </p>
      )}
      <form
        onSubmit={handleSubmit((values) => {
          mutation.mutate(
            { sparePartId: values.sparePartId, quantity: Number(values.quantity), notes: values.notes || undefined },
            { onSuccess: () => reset({ sparePartId: values.sparePartId, quantity: 1, notes: '' }) },
          );
        })}
        className="space-y-2"
      >
        <Field label="Spare part">
          <select className={inputClass} {...register('sparePartId', { required: true })}>
            <option value="">Select…</option>
            {(sparePartsQuery.data ?? []).map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.code} — {sp.name}
                {!sp.models?.length ? ' (not linked to a model)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end gap-2">
          <div className="w-28">
            <Field label="Quantity">
              <input
                type="number"
                min="1"
                step="1"
                className={inputClass}
                {...register('quantity', { required: true, valueAsNumber: true, min: 1 })}
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Notes (optional)">
              <input className={inputClass} {...register('notes')} placeholder="e.g. GRN against PO-2044" />
            </Field>
          </div>
        </div>
        <button
          type="submit"
          disabled={mutation.isPending || !sparePartId}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Receive Stock
        </button>
      </form>
    </div>
  );
}

function StockLookupCard() {
  const sparePartsQuery = useQuery({ queryKey: ['spare-parts', 'active'], queryFn: () => listSpareParts({ active: true }) });
  const [sparePartId, setSparePartId] = useState('');
  const [location, setLocation] = useState<'MAIN_STORE' | 'DAMAGE_LOCATION'>('MAIN_STORE');
  const [activeId, setActiveId] = useState('');
  const stockQuery = useQuery({
    queryKey: ['stock', activeId, location],
    queryFn: () => getStock(activeId, location),
    enabled: !!activeId,
    retry: false,
  });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="mb-1 text-sm font-medium text-slate-800">Stock lookup</p>
      <p className="mb-3 text-xs text-slate-400">
        Main Store is what's available to reserve. Damage Location is Phase 6's
        consumption total - stock that's permanently moved there on QC approval.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setActiveId(sparePartId);
        }}
        className="flex items-end gap-2"
      >
        <div className="flex-1">
          <Field label="Spare part">
            <select className={inputClass} value={sparePartId} onChange={(e) => setSparePartId(e.target.value)}>
              <option value="">Select…</option>
              {(sparePartsQuery.data ?? []).map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.code} — {sp.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="w-40">
          <Field label="Location">
            <select className={inputClass} value={location} onChange={(e) => setLocation(e.target.value as typeof location)}>
              <option value="MAIN_STORE">Main Store</option>
              <option value="DAMAGE_LOCATION">Damage Location</option>
            </select>
          </Field>
        </div>
        <button
          type="submit"
          disabled={!sparePartId}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Look up
        </button>
      </form>

      {activeId && (
        <div className="mt-3">
          {stockQuery.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
          {stockQuery.error && <ErrorNotice error={stockQuery.error} />}
          {stockQuery.data && <StockSummary stock={stockQuery.data} />}
        </div>
      )}
    </div>
  );
}

function StockSummary({ stock }: { stock: StockLookupResult }) {
  const neverReceived = !stock.id;
  const available = stock.quantityOnHand - stock.quantityReserved;
  return (
    <div className="grid grid-cols-3 gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
      <div>
        <p className="text-xs text-slate-400">On hand</p>
        <p className="font-medium text-slate-800">{stock.quantityOnHand}</p>
      </div>
      <div>
        <p className="text-xs text-slate-400">Reserved</p>
        <p className="font-medium text-slate-800">{stock.quantityReserved}</p>
      </div>
      <div>
        <p className="text-xs text-slate-400">Available</p>
        <p className="font-medium text-slate-800">{available}</p>
      </div>
      {neverReceived && (
        <p className="col-span-3 mt-1 text-xs text-amber-700">
          No stock row exists yet for this part/location - it's never been received via GRN
          (or, for Damage Location, never had anything consumed into it), not necessarily a
          real zero.
        </p>
      )}
    </div>
  );
}

function ReservationRow({
  reservation,
  canReview,
  onChanged,
}: {
  reservation: InventoryReservationWithAge;
  canReview: boolean;
  onChanged: () => void;
}) {
  const [reviewed, setReviewed] = useState<InventoryReservation | null>(null);
  const reviewMutation = useMutation({
    mutationFn: (decision: 'APPROVE_REALLOCATION' | 'REJECT') => reviewReservation(reservation.id, { decision }),
    onSuccess: (r) => {
      setReviewed(r);
      onChanged();
    },
  });

  return (
    <div className="rounded-md border border-slate-200 bg-white p-2.5 text-xs">
      <div className="flex items-center justify-between">
        <p className="font-medium text-slate-700">
          {reservation.quantityReserved} unit(s) · held {reservation.ageHours.toFixed(0)}h
          {!reservation.custodianActive && <span className="ml-1 text-red-600">· custodian inactive</span>}
        </p>
        <StatusBadge status={reservation.status} />
      </div>
      <p className="mt-0.5 text-slate-400">
        Reservation id: {reservation.id} ·{' '}
        <Link to={`/workshop-inventory/workshop?jobCardId=${reservation.jobCardId}`} className="underline">
          Go to Job Card's Workshop screen →
        </Link>
      </p>
      {canReview && !reviewed && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => reviewMutation.mutate('APPROVE_REALLOCATION')}
            disabled={reviewMutation.isPending}
            className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Approve reallocation
          </button>
          <button
            onClick={() => reviewMutation.mutate('REJECT')}
            disabled={reviewMutation.isPending}
            className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Reject (snooze 24h)
          </button>
        </div>
      )}
      <ErrorNotice error={reviewMutation.error} />
      {reviewed && (
        <p className="mt-2 rounded bg-slate-50 px-2 py-1 text-slate-600">
          {reviewed.status === 'RETURN_PENDING'
            ? 'Approved - now RETURN_PENDING. Confirm the physical return below once it arrives.'
            : 'Rejected - will resurface again after 24h if still untouched.'}
        </p>
      )}
    </div>
  );
}

function ConfirmReturnCard() {
  const queryClient = useQueryClient();
  const { register, handleSubmit, reset } = useForm<{ reservationId: string; quantityReturned: number }>({
    defaultValues: { reservationId: '', quantityReturned: 1 },
  });
  const mutation: UseMutationResult<InventoryReservation, unknown, { reservationId: string; quantityReturned: number }> =
    useMutation({
      mutationFn: ({ reservationId, quantityReturned }) => confirmReturn(reservationId, { quantityReturned }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reservations', 'stale'] }),
    });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="mb-1 text-sm font-medium text-slate-800">Confirm a physical return</p>
      <p className="mb-3 text-xs text-slate-400">
        The only action that increments stock back onto Main Store - use it once a
        RETURN_PENDING reservation's part has actually arrived back. Paste the reservation
        id (from "Approve reallocation" above, a technician's own return request, or the
        Workshop screen).
      </p>
      <ErrorNotice error={mutation.error} />
      {mutation.isSuccess && (
        <p className="mb-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700">
          Confirmed - {mutation.data.quantityReturned} unit(s) back on Main Store.
        </p>
      )}
      <form
        onSubmit={handleSubmit((values) => {
          mutation.mutate(
            { reservationId: values.reservationId.trim(), quantityReturned: Number(values.quantityReturned) },
            { onSuccess: () => reset() },
          );
        })}
        className="flex items-end gap-2"
      >
        <div className="flex-1">
          <Field label="Reservation id">
            <input className={inputClass} {...register('reservationId', { required: true })} />
          </Field>
        </div>
        <div className="w-28">
          <Field label="Qty returned">
            <input
              type="number"
              min="1"
              step="1"
              className={inputClass}
              {...register('quantityReturned', { required: true, valueAsNumber: true, min: 1 })}
            />
          </Field>
        </div>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Confirm Return
        </button>
      </form>
    </div>
  );
}
