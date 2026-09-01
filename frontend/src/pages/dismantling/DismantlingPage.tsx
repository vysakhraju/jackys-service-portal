import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../lib/auth';
import {
  cancelDismantlingRecord,
  createDismantlingRecord,
  getDismantlingRecord,
  listDismantlingRecords,
  verifyDismantlingRecord,
} from '../../lib/dismantlingApi';
import {
  DISMANTLING_STATUSES,
  canPriceAsUser,
  canVerifyAsUser,
  dismantlingPermissions,
  type CreateDismantlingRecordInput,
  type DismantlingRecord,
  type DismantlingStatusValue,
  type HarvestedComponent,
} from '../../lib/dismantlingTypes';
import { HarvestModal } from './HarvestModal';
import { PriceAndPostModal } from './PriceAndPostModal';

const STATUS_FILTERS: { label: string; value: DismantlingStatusValue | '' }[] = [
  { label: 'All', value: '' },
  ...DISMANTLING_STATUSES.map((s) => ({ label: s.replaceAll('_', ' '), value: s })),
];

type CreateFormValues = {
  applianceSerialNumber: string;
  modelId: string;
  damageLocationNotes: string;
};

function emptyCreateForm(): CreateFormValues {
  return { applianceSerialNumber: '', modelId: '', damageLocationNotes: '' };
}

export function DismantlingPage() {
  const { user } = useAuth();
  const perms = dismantlingPermissions(user?.role.name);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = searchParams.get('recordId') ?? '';
  const [statusFilter, setStatusFilter] = useState<DismantlingStatusValue | ''>('');

  const listQuery = useQuery({
    queryKey: ['dismantling-records', statusFilter],
    queryFn: () => listDismantlingRecords(statusFilter || undefined),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateFormValues>({
    defaultValues: emptyCreateForm(),
  });
  const createMutation = useMutation({
    mutationFn: (data: CreateDismantlingRecordInput) => createDismantlingRecord(data),
    onSuccess: (record) => {
      listQuery.refetch();
      setCreateOpen(false);
      setSearchParams({ recordId: record.id });
    },
  });

  function openCreate() {
    reset(emptyCreateForm());
    setCreateOpen(true);
  }

  function onSubmit(values: CreateFormValues) {
    createMutation.mutate({
      applianceSerialNumber: values.applianceSerialNumber,
      modelId: values.modelId,
      damageLocationNotes: values.damageLocationNotes || undefined,
    });
  }

  const columns: Column<DismantlingRecord>[] = [
    { key: 'recordNumber', label: 'Record #', render: (r) => <span className="font-medium text-slate-900">{r.recordNumber}</span> },
    { key: 'serial', label: 'Appliance serial', render: (r) => r.applianceSerialNumber },
    { key: 'model', label: 'Model', render: (r) => r.modelId },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'components', label: 'Components', render: (r) => `${r.harvestedComponents.length} logged` },
    { key: 'recovered', label: 'Recovered value', render: (r) => (r.status === 'POSTED' ? `AED ${Number(r.totalRecoveredValue).toFixed(2)}` : '—') },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-8 py-10">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Dismantling</h1>
        <p className="mt-1 text-sm text-slate-500">
          Component recovery from write-off appliances already in Damage Location (BRD Workflow 15).
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
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
        {perms.canHarvest && (
          <button onClick={openCreate} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            + New Record
          </button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={listQuery.data}
        isLoading={listQuery.isLoading}
        error={listQuery.error}
        emptyMessage="No dismantling records match this filter."
        rowActions={(r) => (
          <button
            onClick={() => setSearchParams({ recordId: r.id })}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            View
          </button>
        )}
      />

      {activeId && <DismantlingDetail id={activeId} perms={perms} currentUserId={user?.id} />}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Dismantling Record">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <ErrorNotice error={createMutation.error} />
          <Field label="Appliance serial number" error={errors.applianceSerialNumber?.message}>
            <input className={inputClass} placeholder="SN-000987" {...register('applianceSerialNumber', { required: 'Required' })} />
          </Field>
          <Field label="Model ID" error={errors.modelId?.message} hint="Used to look up the original BOM via the yield matrix at harvest time">
            <input className={inputClass} placeholder="M100" {...register('modelId', { required: 'Required' })} />
          </Field>
          <Field label="Damage location notes (optional)">
            <textarea className={inputClass} rows={2} {...register('damageLocationNotes')} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setCreateOpen(false)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function ComponentCategoryCell({ component }: { component: HarvestedComponent }) {
  if (component.category === null) {
    return (
      <span
        className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
        title="No matching yield-matrix row for this model + code — check for a typo in the BOM item code."
      >
        ⚠ not in yield matrix
      </span>
    );
  }
  return <span className="text-slate-600">{component.category.replaceAll('_', ' ')}</span>;
}

function DismantlingDetail({
  id,
  perms,
  currentUserId,
}: {
  id: string;
  perms: ReturnType<typeof dismantlingPermissions>;
  currentUserId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const [harvestOpen, setHarvestOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyNotes, setVerifyNotes] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const recordQuery = useQuery({ queryKey: ['dismantling-record', id], queryFn: () => getDismantlingRecord(id) });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['dismantling-record', id] });
    queryClient.invalidateQueries({ queryKey: ['dismantling-records'] });
  }

  const verifyMutation = useMutation({
    mutationFn: (notes: string) => verifyDismantlingRecord(id, notes || undefined),
    onSuccess: () => {
      invalidateAll();
      setVerifyOpen(false);
      setVerifyNotes('');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (reason: string) => cancelDismantlingRecord(id, reason),
    onSuccess: () => {
      invalidateAll();
      setCancelOpen(false);
      setCancelReason('');
    },
  });

  if (recordQuery.isLoading) return <p className="text-sm text-slate-400">Loading record…</p>;
  if (recordQuery.error) return <ErrorNotice error={recordQuery.error} />;
  if (!recordQuery.data) return null;
  const record = recordQuery.data;

  const canHarvestNow = perms.canHarvest && record.status === 'PENDING_HARVEST';
  const canCancelNow = perms.canHarvest && (record.status === 'PENDING_HARVEST' || record.status === 'COMPONENTS_LOGGED');
  const verifyEligibleStatus = record.status === 'COMPONENTS_LOGGED';
  const verifyAllowedForUser = canVerifyAsUser(record, currentUserId);
  const priceEligibleStatus = record.status === 'VERIFIED';
  const priceAllowedForUser = canPriceAsUser(record, currentUserId);

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-slate-900">{record.recordNumber}</p>
          <p className="text-xs text-slate-400">
            {record.applianceSerialNumber} · Model {record.modelId}
          </p>
        </div>
        <StatusBadge status={record.status} />
      </div>

      {record.damageLocationNotes && <p className="text-sm text-slate-600">{record.damageLocationNotes}</p>}

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500">
        <p>
          Harvested by <span className="font-medium text-slate-700">{record.harvestedByUserId ?? '—'}</span>
          {record.harvestedAt ? ` · ${new Date(record.harvestedAt).toLocaleString()}` : ''}
        </p>
        <p>
          Verified by <span className="font-medium text-slate-700">{record.verifiedByUserId ?? '—'}</span>
          {record.verifiedAt ? ` · ${new Date(record.verifiedAt).toLocaleString()}` : ''}
        </p>
        <p>
          Priced by <span className="font-medium text-slate-700">{record.pricedByUserId ?? '—'}</span>
          {record.postedAt ? ` · ${new Date(record.postedAt).toLocaleString()}` : ''}
        </p>
        <p>
          Recovered value <span className="font-medium text-slate-700">AED {Number(record.totalRecoveredValue).toFixed(2)}</span>
        </p>
        {record.verificationNotes && <p className="col-span-2">Verification notes: {record.verificationNotes}</p>}
        {record.cancellationReason && <p className="col-span-2">Cancellation reason: {record.cancellationReason}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        {canHarvestNow && (
          <button onClick={() => setHarvestOpen(true)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            Log Harvest
          </button>
        )}
        {perms.canVerify && verifyEligibleStatus && (
          <button
            onClick={() => verifyAllowedForUser && setVerifyOpen(true)}
            disabled={!verifyAllowedForUser}
            title={!verifyAllowedForUser ? 'You harvested this record — a different person must verify it (AC-31).' : undefined}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Verify
          </button>
        )}
        {perms.canPrice && priceEligibleStatus && (
          <button
            onClick={() => priceAllowedForUser && setPriceOpen(true)}
            disabled={!priceAllowedForUser}
            title={!priceAllowedForUser ? 'You harvested or verified this record — a third, different person must price and post it (AC-31).' : undefined}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Price &amp; Post
          </button>
        )}
        {canCancelNow && (
          <button onClick={() => setCancelOpen(true)} className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
            Cancel
          </button>
        )}
      </div>
      {perms.canVerify && verifyEligibleStatus && !verifyAllowedForUser && (
        <p className="text-xs text-amber-700">You harvested this record — a different person must verify it (AC-31).</p>
      )}
      {perms.canPrice && priceEligibleStatus && !priceAllowedForUser && (
        <p className="text-xs text-amber-700">
          You harvested or verified this record — a third, different person must price and post it (AC-31).
        </p>
      )}

      <div className="border-t border-slate-100 pt-3">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
          Harvested components ({record.harvestedComponents.length})
        </p>
        {record.harvestedComponents.length === 0 ? (
          <p className="text-xs text-slate-400">Nothing logged yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium text-slate-500">Code</th>
                  <th className="px-3 py-1.5 text-left font-medium text-slate-500">Item</th>
                  <th className="px-3 py-1.5 text-left font-medium text-slate-500">Category</th>
                  <th className="px-3 py-1.5 text-left font-medium text-slate-500">Condition</th>
                  <th className="px-3 py-1.5 text-left font-medium text-slate-500">Qty</th>
                  <th className="px-3 py-1.5 text-left font-medium text-slate-500">Eligible</th>
                  <th className="px-3 py-1.5 text-left font-medium text-slate-500">Converted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {record.harvestedComponents.map((c) => (
                  <tr key={c.originalBomItemCode}>
                    <td className="px-3 py-1.5 font-medium text-slate-800">{c.originalBomItemCode}</td>
                    <td className="px-3 py-1.5 text-slate-600">{c.itemName ?? '—'}</td>
                    <td className="px-3 py-1.5">
                      <ComponentCategoryCell component={c} />
                    </td>
                    <td className="px-3 py-1.5 text-slate-600">{c.testedCondition.replaceAll('_', ' ')}</td>
                    <td className="px-3 py-1.5 text-slate-600">{c.quantity}</td>
                    <td className="px-3 py-1.5">
                      {c.eligibleForConversion ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">Eligible</span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500">Not eligible</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-slate-600">
                      {c.selectedForConversion
                        ? `${c.quantityConverted} @ AED ${Number(c.recoveryUnitPrice).toFixed(2)}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <HarvestModal open={harvestOpen} onClose={() => setHarvestOpen(false)} record={record} onHarvested={invalidateAll} />
      <PriceAndPostModal open={priceOpen} onClose={() => setPriceOpen(false)} record={record} onPosted={invalidateAll} />

      <Modal open={verifyOpen} onClose={() => setVerifyOpen(false)} title={`Verify — ${record.recordNumber}`}>
        <div className="space-y-4">
          <ErrorNotice error={verifyMutation.error} />
          <p className="text-xs text-slate-500">Confirm the harvested component log matches physical inspection.</p>
          <Field label="Notes (optional)">
            <textarea className={inputClass} rows={2} value={verifyNotes} onChange={(e) => setVerifyNotes(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <button onClick={() => setVerifyOpen(false)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
              Back
            </button>
            <button
              disabled={verifyMutation.isPending}
              onClick={() => verifyMutation.mutate(verifyNotes)}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Verify
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title={`Cancel record — ${record.recordNumber}`}>
        <div className="space-y-4">
          <ErrorNotice error={cancelMutation.error} />
          <Field label="Reason" hint="At least 3 characters — required by the backend">
            <textarea className={inputClass} rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <button onClick={() => setCancelOpen(false)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
              Back
            </button>
            <button
              disabled={cancelReason.trim().length < 3 || cancelMutation.isPending}
              onClick={() => cancelMutation.mutate(cancelReason)}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Cancel record
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
