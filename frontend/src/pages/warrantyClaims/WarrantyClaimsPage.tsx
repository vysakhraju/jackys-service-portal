import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../lib/auth';
import {
  aggregateWarrantyClaim,
  cancelWarrantyClaim,
  getWarrantyClaim,
  getWarrantyClaimRecoveryRate,
  listWarrantyClaims,
  recordWarrantyClaimCreditNote,
  submitWarrantyClaim,
} from '../../lib/warrantyClaimsApi';
import {
  WARRANTY_CLAIM_STATUSES,
  warrantyClaimsPermissions,
  type WarrantyClaim,
  type WarrantyClaimStatusValue,
} from '../../lib/warrantyClaimsTypes';

// BRD Workflow 12 "[Optional]" (EPIC-007 partial): Warranty Claims & Vendor Management.
// The backend (12.1-12.5) was already built and live-verified (70/70 checks) before this
// phase - this is its first UI. Lifecycle mirrors Dismantling's own page structure
// (list + filters + a searchParams-driven detail panel with status-gated action buttons)
// rather than inventing a new shape, since the two workflows are structurally identical:
// a header record that moves through a small linear status chain, gated by different role
// lists at different steps.
const STATUS_FILTERS: { label: string; value: WarrantyClaimStatusValue | '' }[] = [
  { label: 'All', value: '' },
  ...WARRANTY_CLAIM_STATUSES.map((s) => ({ label: s.replaceAll('_', ' '), value: s })),
];

export function WarrantyClaimsPage() {
  const { user } = useAuth();
  const perms = warrantyClaimsPermissions(user?.role.name);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = searchParams.get('claimId') ?? '';
  const [statusFilter, setStatusFilter] = useState<WarrantyClaimStatusValue | ''>('');
  const [supplierFilter, setSupplierFilter] = useState('');

  const listQuery = useQuery({
    queryKey: ['warranty-claims', statusFilter, supplierFilter],
    queryFn: () => listWarrantyClaims({ status: statusFilter || undefined, supplier: supplierFilter || undefined }),
    enabled: perms.canView,
  });

  const recoveryQuery = useQuery({
    queryKey: ['warranty-claims', 'recovery-rate', supplierFilter],
    queryFn: () => getWarrantyClaimRecoveryRate(supplierFilter || undefined),
    enabled: perms.canView,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [createSupplier, setCreateSupplier] = useState('');
  const [createPeriodStart, setCreatePeriodStart] = useState('');
  const [createPeriodEnd, setCreatePeriodEnd] = useState('');

  const createMutation = useMutation({
    mutationFn: () => aggregateWarrantyClaim({ supplier: createSupplier, periodStart: createPeriodStart, periodEnd: createPeriodEnd }),
    onSuccess: (claim) => {
      listQuery.refetch();
      setCreateOpen(false);
      setSearchParams({ claimId: claim.id });
    },
  });

  function openCreate() {
    setCreateSupplier(supplierFilter);
    setCreatePeriodStart('');
    setCreatePeriodEnd('');
    createMutation.reset();
    setCreateOpen(true);
  }

  if (!perms.canView) {
    return (
      <div className="px-8 py-6">
        <p className="max-w-2xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Warranty Claims is restricted to Warranty Clerk / Accountant / Finance Manager /
          Service Head / Super Admin - every endpoint here is role-gated server-side too.
        </p>
      </div>
    );
  }

  const columns: Column<WarrantyClaim>[] = [
    { key: 'claimNumber', label: 'Claim #', render: (c) => <span className="font-medium text-slate-900">{c.claimNumber}</span> },
    { key: 'supplier', label: 'Supplier', render: (c) => c.supplier },
    {
      key: 'period',
      label: 'Period',
      render: (c) => `${new Date(c.periodStart).toLocaleDateString()} – ${new Date(c.periodEnd).toLocaleDateString()}`,
    },
    { key: 'status', label: 'Status', render: (c) => <StatusBadge status={c.status} /> },
    { key: 'lines', label: 'Lines', render: (c) => c.lines?.length ?? '—' },
    { key: 'amount', label: 'Claimed', render: (c) => `AED ${Number(c.totalClaimedAmount).toFixed(2)}` },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-8 py-10">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Warranty Claims</h1>
        <p className="mt-1 text-sm text-slate-500">
          Group consumed warranty spares by vendor/period into a claim (BRD 12.1), submit
          it once it's been uploaded to the vendor's own portal (12.3), and record the
          vendor's credit note when it arrives (12.4).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Total claimed</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
            {recoveryQuery.data ? `AED ${recoveryQuery.data.totalClaimed.toFixed(2)}` : '—'}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Total recovered</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
            {recoveryQuery.data ? `AED ${recoveryQuery.data.totalRecovered.toFixed(2)}` : '—'}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Recovery rate {supplierFilter ? `(${supplierFilter})` : '(all vendors)'}
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
            {recoveryQuery.data?.rate === null || recoveryQuery.data?.rate === undefined ? '—' : `${recoveryQuery.data.rate.toFixed(1)}%`}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
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
          <Field label="Supplier">
            <input
              className={`${inputClass} w-48`}
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              placeholder="Any"
            />
          </Field>
        </div>
        {perms.canAggregate && (
          <button onClick={openCreate} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            + New Claim
          </button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={listQuery.data}
        isLoading={listQuery.isLoading}
        error={listQuery.error}
        emptyMessage="No warranty claims match this filter."
        rowActions={(c) => (
          <button
            onClick={() => setSearchParams({ claimId: c.id })}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            View
          </button>
        )}
      />

      {activeId && <WarrantyClaimDetail id={activeId} perms={perms} />}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Warranty Claim">
        <div className="space-y-4">
          <ErrorNotice error={createMutation.error} />
          <Field label="Supplier" hint="Must match JobCard.warrantySupplier exactly">
            <input className={inputClass} value={createSupplier} onChange={(e) => setCreateSupplier(e.target.value)} placeholder="Samsung Gulf FZE" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Period start">
              <input type="date" className={inputClass} value={createPeriodStart} onChange={(e) => setCreatePeriodStart(e.target.value)} />
            </Field>
            <Field label="Period end">
              <input type="date" className={inputClass} value={createPeriodEnd} onChange={(e) => setCreatePeriodEnd(e.target.value)} />
            </Field>
          </div>
          <p className="text-xs text-slate-400">
            Groups every unclaimed CONSUMED warranty spare for this vendor, consumed within
            this period, into one new DRAFT claim.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setCreateOpen(false)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
              Cancel
            </button>
            <button
              type="button"
              disabled={createSupplier.trim().length < 2 || !createPeriodStart || !createPeriodEnd || createMutation.isPending}
              onClick={() => createMutation.mutate()}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Generate Claim
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function WarrantyClaimDetail({ id, perms }: { id: string; perms: ReturnType<typeof warrantyClaimsPermissions> }) {
  const queryClient = useQueryClient();
  const [submitOpen, setSubmitOpen] = useState(false);
  const [claimReferenceNumber, setClaimReferenceNumber] = useState('');
  const [submitNotes, setSubmitNotes] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditNoteNumber, setCreditNoteNumber] = useState('');
  const [creditNoteAmount, setCreditNoteAmount] = useState('');

  const claimQuery = useQuery({ queryKey: ['warranty-claim', id], queryFn: () => getWarrantyClaim(id) });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['warranty-claim', id] });
    queryClient.invalidateQueries({ queryKey: ['warranty-claims'] });
  }

  const submitMutation = useMutation({
    mutationFn: () => submitWarrantyClaim(id, { claimReferenceNumber, notes: submitNotes || undefined }),
    onSuccess: () => {
      invalidateAll();
      setSubmitOpen(false);
      setClaimReferenceNumber('');
      setSubmitNotes('');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelWarrantyClaim(id, cancelReason),
    onSuccess: () => {
      invalidateAll();
      setCancelOpen(false);
      setCancelReason('');
    },
  });

  const creditMutation = useMutation({
    mutationFn: () => recordWarrantyClaimCreditNote(id, { creditNoteNumber, creditNoteAmount: Number(creditNoteAmount) }),
    onSuccess: () => {
      invalidateAll();
      setCreditOpen(false);
      setCreditNoteNumber('');
      setCreditNoteAmount('');
    },
  });

  if (claimQuery.isLoading) return <p className="text-sm text-slate-400">Loading claim…</p>;
  if (claimQuery.error) return <ErrorNotice error={claimQuery.error} />;
  if (!claimQuery.data) return null;
  const claim = claimQuery.data;

  const canSubmitNow = perms.canSubmit && claim.status === 'DRAFT';
  const canCancelNow = perms.canCancel && claim.status === 'DRAFT';
  const canRecordCreditNow = perms.canRecordCreditNote && claim.status === 'SUBMITTED';
  const parsedAmount = Number(creditNoteAmount);
  const creditAmountValid = creditNoteAmount.trim().length > 0 && Number.isFinite(parsedAmount) && parsedAmount > 0;

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-slate-900">{claim.claimNumber}</p>
          <p className="text-xs text-slate-400">
            {claim.supplier} · {new Date(claim.periodStart).toLocaleDateString()} – {new Date(claim.periodEnd).toLocaleDateString()}
          </p>
        </div>
        <StatusBadge status={claim.status} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500">
        <p>
          Claimed amount <span className="font-medium text-slate-700">AED {Number(claim.totalClaimedAmount).toFixed(2)}</span>
        </p>
        <p>
          Claim reference <span className="font-medium text-slate-700">{claim.claimReferenceNumber ?? '—'}</span>
          {claim.submittedAt ? ` · ${new Date(claim.submittedAt).toLocaleString()}` : ''}
        </p>
        <p>
          Credit note <span className="font-medium text-slate-700">{claim.creditNoteNumber ?? '—'}</span>
          {claim.creditNoteAmount !== null ? ` · AED ${Number(claim.creditNoteAmount).toFixed(2)}` : ''}
        </p>
        <p>
          Credit received {claim.creditReceivedAt ? new Date(claim.creditReceivedAt).toLocaleString() : '—'}
        </p>
        {claim.notes && <p className="col-span-2">Notes: {claim.notes}</p>}
        {claim.cancellationReason && <p className="col-span-2">Cancellation reason: {claim.cancellationReason}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        {canSubmitNow && (
          <button onClick={() => setSubmitOpen(true)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            Mark Submitted
          </button>
        )}
        {canRecordCreditNow && (
          <button onClick={() => setCreditOpen(true)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            Record Credit Note
          </button>
        )}
        {canCancelNow && (
          <button onClick={() => setCancelOpen(true)} className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
            Cancel
          </button>
        )}
      </div>

      <div className="border-t border-slate-100 pt-3">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Lines ({claim.lines.length})</p>
        {claim.lines.length === 0 ? (
          <p className="text-xs text-slate-400">No lines on this claim.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50">
                <tr>
                  {['Job Card', 'Serial', 'Spare Part', 'Qty', 'Unit Cost', 'Line Amount'].map((h) => (
                    <th key={h} className="px-3 py-1.5 text-left font-medium text-slate-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {claim.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="px-3 py-1.5 font-medium text-slate-800">{line.jobCardNumber}</td>
                    <td className="px-3 py-1.5 text-slate-600">{line.serialNumber}</td>
                    <td className="px-3 py-1.5 text-slate-600">
                      {line.sparePartCode} <span className="text-slate-400">{line.sparePartName}</span>
                    </td>
                    <td className="px-3 py-1.5 tabular-nums text-slate-600">{line.quantity}</td>
                    <td className="px-3 py-1.5 tabular-nums text-slate-600">AED {Number(line.unitCost).toFixed(2)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-slate-600">AED {Number(line.lineAmount).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={submitOpen} onClose={() => setSubmitOpen(false)} title={`Mark Submitted — ${claim.claimNumber}`}>
        <div className="space-y-4">
          <ErrorNotice error={submitMutation.error} />
          <p className="text-xs text-slate-500">
            Records that this claim was uploaded to {claim.supplier}'s own vendor portal.
            No real portal integration exists here - this just flips the status.
          </p>
          <Field label="Vendor claim reference number">
            <input className={inputClass} value={claimReferenceNumber} onChange={(e) => setClaimReferenceNumber(e.target.value)} placeholder="VENDOR-CLM-2026-0912" />
          </Field>
          <Field label="Notes (optional)">
            <textarea className={inputClass} rows={2} value={submitNotes} onChange={(e) => setSubmitNotes(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <button onClick={() => setSubmitOpen(false)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
              Back
            </button>
            <button
              disabled={claimReferenceNumber.trim().length < 1 || submitMutation.isPending}
              onClick={() => submitMutation.mutate()}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Mark Submitted
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={creditOpen} onClose={() => setCreditOpen(false)} title={`Record Credit Note — ${claim.claimNumber}`}>
        <div className="space-y-4">
          <ErrorNotice error={creditMutation.error} />
          <p className="text-xs text-slate-500">
            Posts to the GL: Debit Vendor Payable, Credit Warranty Recovery Account. Amount
            may be less than the claimed total (a partial recovery).
          </p>
          <Field label="Vendor credit note number">
            <input className={inputClass} value={creditNoteNumber} onChange={(e) => setCreditNoteNumber(e.target.value)} placeholder="CN-2026-4471" />
          </Field>
          <Field label="Amount credited (AED)">
            <input type="number" min="0" step="0.01" className={inputClass} value={creditNoteAmount} onChange={(e) => setCreditNoteAmount(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreditOpen(false)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
              Back
            </button>
            <button
              disabled={creditNoteNumber.trim().length < 1 || !creditAmountValid || creditMutation.isPending}
              onClick={() => creditMutation.mutate()}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Record Credit Note
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title={`Cancel claim — ${claim.claimNumber}`}>
        <div className="space-y-4">
          <ErrorNotice error={cancelMutation.error} />
          <p className="text-xs text-slate-500">
            Deletes this claim's lines so their reservations become claimable again in a
            future aggregation run. Only possible while still DRAFT.
          </p>
          <Field label="Reason" hint="At least 2 characters — required by the backend">
            <textarea className={inputClass} rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <button onClick={() => setCancelOpen(false)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
              Back
            </button>
            <button
              disabled={cancelReason.trim().length < 2 || cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Cancel claim
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
