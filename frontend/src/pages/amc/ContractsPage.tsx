import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../lib/auth';
import {
  cancelAmcContract,
  createAmcContract,
  getAmcContract,
  getAmcSchedule,
  getAmcVisitCompletion,
  listAmcContracts,
  renewAmcContract,
  sendAmcRenewalReminder,
} from '../../lib/amcApi';
import {
  AMC_CONTRACT_STATUSES,
  AMC_PAYMENT_TERMS,
  COVERAGE_TYPES,
  MAX_GENERATED_VISITS,
  VISIT_FREQUENCIES,
  amcPermissions,
  estimateVisitCount,
  type AmcContract,
  type AmcContractStatusValue,
  type AmcScheduleVisit,
  type CoverageTypeValue,
  type CreateAmcContractInput,
  type VisitFrequencyValue,
} from '../../lib/amcTypes';
import { CUSTOMER_TYPES } from '../../lib/appointmentsTypes';
import { AmcBillingSection } from './AmcBillingSection';
import { CompleteVisitModal } from './CompleteVisitModal';

const STATUS_FILTERS: { label: string; value: AmcContractStatusValue | '' }[] = [
  { label: 'All', value: '' },
  ...AMC_CONTRACT_STATUSES.map((s) => ({ label: s.charAt(0) + s.slice(1).toLowerCase(), value: s })),
];

type CreateFormValues = {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  customerType: string;
  serviceCentreId: string;
  coveredSerialNumbers: string;
  brand: string;
  modelNumber: string;
  coverageType: CoverageTypeValue;
  serviceLevel: string;
  visitFrequency: VisitFrequencyValue;
  startDate: string;
  endDate: string;
  totalAmount: number | '';
  paymentTerms: string;
  assignedTechnicianId: string;
};

function emptyCreateForm(overrides: Partial<CreateFormValues> = {}): CreateFormValues {
  return {
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    customerAddress: '',
    customerType: 'B2C',
    serviceCentreId: '',
    coveredSerialNumbers: '',
    brand: '',
    modelNumber: '',
    coverageType: 'COMPREHENSIVE',
    serviceLevel: '',
    visitFrequency: 'QUARTERLY',
    startDate: '',
    endDate: '',
    totalAmount: '',
    paymentTerms: 'FULL_UPFRONT',
    assignedTechnicianId: '',
    ...overrides,
  };
}

export function ContractsPage() {
  const { user } = useAuth();
  const perms = amcPermissions(user?.role.name);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = searchParams.get('contractId') ?? '';
  const [statusFilter, setStatusFilter] = useState<AmcContractStatusValue | ''>('');

  const listQuery = useQuery({
    queryKey: ['amc-contracts', statusFilter],
    queryFn: () => listAmcContracts(statusFilter || undefined),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<CreateFormValues>({
    defaultValues: emptyCreateForm(),
  });
  const createMutation = useMutation({
    mutationFn: (data: CreateAmcContractInput) => createAmcContract(data),
    onSuccess: (contract) => {
      listQuery.refetch();
      setCreateOpen(false);
      setSearchParams({ contractId: contract.id });
    },
  });

  // the-fool pre-mortem finding #4: a "Create AMC Contract →" link from the Upsell
  // Candidates tab lands here with these two params pre-filled, rather than leaving the
  // candidate as a read-only dead end.
  useEffect(() => {
    const prefillName = searchParams.get('prefillName');
    const prefillPhone = searchParams.get('prefillPhone');
    if (prefillName || prefillPhone) {
      reset(emptyCreateForm({ customerName: prefillName ?? '', customerPhone: prefillPhone ?? '' }));
      setCreateOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('prefillName');
      next.delete('prefillPhone');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const watchStart = watch('startDate');
  const watchEnd = watch('endDate');
  const watchFrequency = watch('visitFrequency');
  const estimatedVisits = estimateVisitCount(watchStart, watchEnd, watchFrequency);
  const overCap = estimatedVisits !== null && estimatedVisits > MAX_GENERATED_VISITS;

  function openCreate() {
    reset(emptyCreateForm());
    setCreateOpen(true);
  }

  function onSubmit(values: CreateFormValues) {
    if (overCap) return;
    createMutation.mutate({
      customerName: values.customerName,
      customerPhone: values.customerPhone,
      customerEmail: values.customerEmail || undefined,
      customerAddress: values.customerAddress || undefined,
      customerType: values.customerType as CreateAmcContractInput['customerType'],
      serviceCentreId: values.serviceCentreId,
      coveredSerialNumbers: values.coveredSerialNumbers.split(',').map((s) => s.trim()).filter(Boolean),
      brand: values.brand || undefined,
      modelNumber: values.modelNumber || undefined,
      coverageType: values.coverageType,
      serviceLevel: values.serviceLevel || undefined,
      visitFrequency: values.visitFrequency,
      startDate: values.startDate ? new Date(values.startDate).toISOString() : '',
      endDate: values.endDate ? new Date(values.endDate).toISOString() : '',
      totalAmount: values.totalAmount === '' ? 0 : Number(values.totalAmount),
      paymentTerms: values.paymentTerms as CreateAmcContractInput['paymentTerms'],
      assignedTechnicianId: values.assignedTechnicianId || undefined,
    });
  }

  const columns: Column<AmcContract>[] = [
    { key: 'contractNumber', label: 'Contract #', render: (c) => <span className="font-medium text-slate-900">{c.contractNumber}</span> },
    { key: 'customer', label: 'Customer', render: (c) => (
      <div>
        <div className="text-slate-900">{c.customerName}</div>
        <div className="text-xs text-slate-400">{c.customerPhone}</div>
      </div>
    ) },
    { key: 'status', label: 'Status', render: (c) => <StatusBadge status={c.status} /> },
    { key: 'coverage', label: 'Coverage', render: (c) => `${c.coverageType.replaceAll('_', ' ')} · ${c.visitFrequency.replaceAll('_', ' ')}` },
    { key: 'amount', label: 'Total', render: (c) => `AED ${Number(c.totalAmount).toFixed(2)}` },
    { key: 'endDate', label: 'Ends', render: (c) => new Date(c.endDate).toLocaleDateString() },
  ];

  return (
    <div className="max-w-5xl space-y-4">
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
        {perms.canManage && (
          <button onClick={openCreate} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            + New Contract
          </button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={listQuery.data}
        isLoading={listQuery.isLoading}
        error={listQuery.error}
        emptyMessage="No AMC contracts match this filter."
        rowActions={(c) => (
          <button
            onClick={() => setSearchParams({ contractId: c.id })}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            View
          </button>
        )}
      />

      {activeId && (
        <ContractDetail id={activeId} perms={perms} onNavigateToContract={(newId) => setSearchParams({ contractId: newId })} />
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New AMC Contract">
        <form onSubmit={handleSubmit(onSubmit)} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <ErrorNotice error={createMutation.error} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Customer name" error={errors.customerName?.message}>
              <input className={inputClass} {...register('customerName', { required: 'Required' })} />
            </Field>
            <Field label="Customer phone" error={errors.customerPhone?.message} hint="e.g. +971501234567">
              <input className={inputClass} {...register('customerPhone', { required: 'Required' })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Email (optional)">
              <input type="email" className={inputClass} {...register('customerEmail')} />
            </Field>
            <Field label="Customer type">
              <select className={inputClass} {...register('customerType', { required: true })}>
                {CUSTOMER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Address (optional)">
            <input className={inputClass} {...register('customerAddress')} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Service centre id" error={errors.serviceCentreId?.message} hint="paste uuid from Master Data">
              <input className={inputClass} {...register('serviceCentreId', { required: 'Required' })} />
            </Field>
            <Field label="Assigned technician id (optional)">
              <input className={inputClass} {...register('assignedTechnicianId')} />
            </Field>
          </div>
          <Field label="Covered serial numbers" hint="Comma-separated - a contract can cover more than one unit (e.g. a fleet/site AMC)" error={errors.coveredSerialNumbers?.message}>
            <input className={inputClass} placeholder="SN-000123, SN-000124" {...register('coveredSerialNumbers', { required: 'Required' })} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Brand (optional)">
              <input className={inputClass} {...register('brand')} />
            </Field>
            <Field label="Model number (optional)">
              <input className={inputClass} {...register('modelNumber')} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Coverage type">
              <select className={inputClass} {...register('coverageType', { required: true })}>
                {COVERAGE_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}
              </select>
            </Field>
            <Field label="Service level (optional)">
              <input className={inputClass} placeholder="Standard" {...register('serviceLevel')} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start date" error={errors.startDate?.message}>
              <input type="date" className={inputClass} {...register('startDate', { required: 'Required' })} />
            </Field>
            <Field label="End date" error={errors.endDate?.message}>
              <input type="date" className={inputClass} {...register('endDate', { required: 'Required' })} />
            </Field>
          </div>
          <Field label="Visit frequency">
            <select className={inputClass} {...register('visitFrequency', { required: true })}>
              {VISIT_FREQUENCIES.map((f) => <option key={f} value={f}>{f.replaceAll('_', ' ')}</option>)}
            </select>
          </Field>
          {/* the-fool pre-mortem finding #5: a live client-side estimate, mirroring the
              backend's own date-math, so a long form doesn't get filled out and submitted
              only to be rejected by the 60-visit safety cap. */}
          {estimatedVisits !== null && (
            <p className={`text-xs ${overCap ? 'font-medium text-red-600' : 'text-slate-500'}`}>
              This will generate <b>{estimatedVisits}</b> PM visit{estimatedVisits === 1 ? '' : 's'}
              {overCap
                ? ` — above the ${MAX_GENERATED_VISITS}-visit safety cap. Shorten the term or use a lower-frequency schedule.`
                : '.'}
            </p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Total amount (AED)" error={errors.totalAmount?.message}>
              <input type="number" min="0.01" step="0.01" className={inputClass} {...register('totalAmount', { required: 'Required', valueAsNumber: true, min: 0.01 })} />
            </Field>
            <Field label="Payment terms">
              <select className={inputClass} {...register('paymentTerms', { required: true })}>
                {AMC_PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}
              </select>
            </Field>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setCreateOpen(false)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || overCap}
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

function ContractDetail({
  id,
  perms,
  onNavigateToContract,
}: {
  id: string;
  perms: ReturnType<typeof amcPermissions>;
  onNavigateToContract: (newId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [renewOpen, setRenewOpen] = useState(false);
  const [reminderResult, setReminderResult] = useState<{ attempted: string[]; delivered: string[] } | null>(null);
  const [completingAppointment, setCompletingAppointment] = useState<AmcScheduleVisit | null>(null);
  const [viewingCompletionFor, setViewingCompletionFor] = useState<AmcScheduleVisit | null>(null);

  const contractQuery = useQuery({ queryKey: ['amc-contract', id], queryFn: () => getAmcContract(id) });
  const scheduleQuery = useQuery({ queryKey: ['amc-schedule', id], queryFn: () => getAmcSchedule(id) });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['amc-contract', id] });
    queryClient.invalidateQueries({ queryKey: ['amc-schedule', id] });
    queryClient.invalidateQueries({ queryKey: ['amc-contracts'] });
  }

  const cancelMutation = useMutation({
    mutationFn: (reason: string) => cancelAmcContract(id, reason),
    onSuccess: () => {
      invalidateAll();
      setCancelOpen(false);
      setCancelReason('');
    },
  });

  const reminderMutation = useMutation({
    mutationFn: () => sendAmcRenewalReminder(id),
    onSuccess: (result) => {
      invalidateAll();
      setReminderResult(result);
    },
  });

  if (contractQuery.isLoading) return <p className="text-sm text-slate-400">Loading contract…</p>;
  if (contractQuery.error) return <ErrorNotice error={contractQuery.error} />;
  if (!contractQuery.data) return null;
  const contract = contractQuery.data;
  const canAct = perms.canManage && contract.status === 'ACTIVE';

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-slate-900">{contract.contractNumber}</p>
          <p className="text-xs text-slate-400">{contract.customerName} · {contract.customerPhone}</p>
        </div>
        <StatusBadge status={contract.status} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-600">
        <p>Service centre <span className="font-medium text-slate-800">{contract.serviceCentre?.name ?? contract.serviceCentreId}</span></p>
        <p>Coverage <span className="font-medium text-slate-800">{contract.coverageType.replaceAll('_', ' ')}</span></p>
        <p>Covered units <span className="font-medium text-slate-800">{contract.coveredSerialNumbers.join(', ') || '—'}</span></p>
        <p>Visit frequency <span className="font-medium text-slate-800">{contract.visitFrequency.replaceAll('_', ' ')}</span></p>
        <p>Term <span className="font-medium text-slate-800">{new Date(contract.startDate).toLocaleDateString()} – {new Date(contract.endDate).toLocaleDateString()}</span></p>
        <p>Total / terms <span className="font-medium text-slate-800">AED {Number(contract.totalAmount).toFixed(2)} · {contract.paymentTerms.replaceAll('_', ' ')}</span></p>
        {contract.cancellationReason && <p className="col-span-2">Cancellation reason <span className="font-medium text-slate-800">{contract.cancellationReason}</span></p>}
        {contract.renewalReminderSentAt && (
          <p className="col-span-2">Last reminder sent <span className="font-medium text-slate-800">{new Date(contract.renewalReminderSentAt).toLocaleString()}</span> ({contract.renewalReminderChannelsDelivered.join(', ') || 'none delivered'})</p>
        )}
      </div>

      {perms.canManage && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {canAct && (
            <button onClick={() => setRenewOpen(true)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
              Renew
            </button>
          )}
          {canAct && (
            <button onClick={() => setCancelOpen(true)} className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
              Cancel
            </button>
          )}
          {canAct && (
            <button
              onClick={() => reminderMutation.mutate()}
              disabled={reminderMutation.isPending}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Send renewal reminder
            </button>
          )}
        </div>
      )}
      {reminderResult && (
        <p className="text-xs text-emerald-700">
          Reminder attempted via {reminderResult.attempted.join(', ') || 'no channels'}; delivered via {reminderResult.delivered.join(', ') || 'none'}.
        </p>
      )}
      <ErrorNotice error={cancelMutation.error || reminderMutation.error} />

      <div className="border-t border-slate-100 pt-3">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
          PM visit schedule ({scheduleQuery.data?.length ?? '…'})
        </p>
        {scheduleQuery.isLoading && <p className="text-xs text-slate-400">Loading…</p>}
        {scheduleQuery.error && <ErrorNotice error={scheduleQuery.error} />}
        {scheduleQuery.data && scheduleQuery.data.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {scheduleQuery.data.map((visit, idx) => (
              <li key={visit.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                <span className="text-slate-700">
                  Visit {idx + 1} · {visit.appointmentNumber} · {new Date(visit.scheduledAt).toLocaleDateString()}
                </span>
                <div className="flex items-center gap-2">
                  <StatusBadge status={visit.status} />
                  {perms.canCompleteVisits && visit.status === 'SCHEDULED' && (
                    <button
                      onClick={() => setCompletingAppointment(visit)}
                      className="rounded border border-slate-300 px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Complete
                    </button>
                  )}
                  {visit.status === 'COMPLETED' && (
                    <button
                      onClick={() => setViewingCompletionFor(visit)}
                      className="rounded border border-slate-300 px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
                    >
                      View completion
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-slate-100 pt-3">
        <AmcBillingSection contractId={id} canBill={perms.canBill} />
      </div>

      <CompleteVisitModal
        open={!!completingAppointment}
        onClose={() => setCompletingAppointment(null)}
        appointmentId={completingAppointment?.id ?? null}
        appointmentNumber={completingAppointment?.appointmentNumber}
        onCompleted={invalidateAll}
      />
      <VisitCompletionModal visit={viewingCompletionFor} onClose={() => setViewingCompletionFor(null)} />

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title={`Cancel contract — ${contract.contractNumber}`}>
        <div className="space-y-4">
          <ErrorNotice error={cancelMutation.error} />
          <p className="text-xs text-slate-500">Any still-SCHEDULED future PM visits on this contract will also be cancelled.</p>
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
              Cancel contract
            </button>
          </div>
        </div>
      </Modal>

      <RenewModal
        open={renewOpen}
        onClose={() => setRenewOpen(false)}
        contract={contract}
        onRenewed={(newId) => {
          invalidateAll();
          setRenewOpen(false);
          onNavigateToContract(newId);
        }}
      />
    </div>
  );
}

function VisitCompletionModal({ visit, onClose }: { visit: AmcScheduleVisit | null; onClose: () => void }) {
  const completionQuery = useQuery({
    queryKey: ['amc-visit-completion', visit?.id],
    queryFn: () => getAmcVisitCompletion(visit!.id),
    enabled: !!visit,
  });

  if (!visit) return null;

  return (
    <Modal open={!!visit} onClose={onClose} title={`Visit completion — ${visit.appointmentNumber}`}>
      {completionQuery.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {completionQuery.error && <ErrorNotice error={completionQuery.error} />}
      {completionQuery.data && (
        <div className="space-y-2 text-sm">
          <p className="text-slate-700">{completionQuery.data.checklistNotes || 'No checklist notes recorded.'}</p>
          <p className="text-xs text-slate-400">
            Completed {new Date(completionQuery.data.completedAt).toLocaleString()}
            {completionQuery.data.customerSignatureBase64 ? ' · signature captured' : ' · no signature captured'}
          </p>
          {completionQuery.data.extraChargeAmount ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
              Extra charge: AED {Number(completionQuery.data.extraChargeAmount).toFixed(2)}
              {completionQuery.data.extraChargeDescription ? ` — ${completionQuery.data.extraChargeDescription}` : ''}
              {' '}(customer approved)
            </p>
          ) : (
            <p className="text-xs text-slate-400">No extra charge raised.</p>
          )}
        </div>
      )}
    </Modal>
  );
}

type RenewFormValues = {
  startDate: string;
  endDate: string;
  totalAmount: number | '';
  visitFrequency: VisitFrequencyValue;
  paymentTerms: string;
  coveredSerialNumbers: string;
};

function RenewModal({
  open,
  onClose,
  contract,
  onRenewed,
}: {
  open: boolean;
  onClose: () => void;
  contract: AmcContract;
  onRenewed: (newContractId: string) => void;
}) {
  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<RenewFormValues>({
    defaultValues: {
      startDate: '',
      endDate: '',
      totalAmount: contract.totalAmount,
      visitFrequency: contract.visitFrequency,
      paymentTerms: contract.paymentTerms,
      coveredSerialNumbers: contract.coveredSerialNumbers.join(', '),
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        startDate: '',
        endDate: '',
        totalAmount: contract.totalAmount,
        visitFrequency: contract.visitFrequency,
        paymentTerms: contract.paymentTerms,
        coveredSerialNumbers: contract.coveredSerialNumbers.join(', '),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const mutation = useMutation({
    mutationFn: (data: Parameters<typeof renewAmcContract>[1]) => renewAmcContract(contract.id, data),
    onSuccess: (newContract) => onRenewed(newContract.id),
  });

  const watchStart = watch('startDate');
  const watchEnd = watch('endDate');
  const watchFrequency = watch('visitFrequency');
  const estimatedVisits = estimateVisitCount(watchStart, watchEnd, watchFrequency);
  const overCap = estimatedVisits !== null && estimatedVisits > MAX_GENERATED_VISITS;

  function onSubmit(values: RenewFormValues) {
    if (overCap) return;
    mutation.mutate({
      startDate: values.startDate ? new Date(values.startDate).toISOString() : '',
      endDate: values.endDate ? new Date(values.endDate).toISOString() : '',
      totalAmount: values.totalAmount === '' ? 0 : Number(values.totalAmount),
      visitFrequency: values.visitFrequency,
      paymentTerms: values.paymentTerms as CreateAmcContractInput['paymentTerms'],
      coveredSerialNumbers: values.coveredSerialNumbers.split(',').map((s) => s.trim()).filter(Boolean),
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={`Renew contract — ${contract.contractNumber}`}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <ErrorNotice error={mutation.error} />
        <p className="text-xs text-slate-500">
          Everything below defaults to this contract's current terms — a renewal is usually
          "same terms, new dates/amount". The original contract is marked RENEWED (never
          mutated) and this creates a brand-new contract with its own fresh PM schedule.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="New start date" error={errors.startDate?.message}>
            <input type="date" className={inputClass} {...register('startDate', { required: 'Required' })} />
          </Field>
          <Field label="New end date" error={errors.endDate?.message}>
            <input type="date" className={inputClass} {...register('endDate', { required: 'Required' })} />
          </Field>
        </div>
        <Field label="Visit frequency">
          <select className={inputClass} {...register('visitFrequency', { required: true })}>
            {VISIT_FREQUENCIES.map((f) => <option key={f} value={f}>{f.replaceAll('_', ' ')}</option>)}
          </select>
        </Field>
        {estimatedVisits !== null && (
          <p className={`text-xs ${overCap ? 'font-medium text-red-600' : 'text-slate-500'}`}>
            This will generate <b>{estimatedVisits}</b> PM visit{estimatedVisits === 1 ? '' : 's'}
            {overCap ? ` — above the ${MAX_GENERATED_VISITS}-visit safety cap.` : '.'}
          </p>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="New total amount (AED)" error={errors.totalAmount?.message}>
            <input type="number" min="0.01" step="0.01" className={inputClass} {...register('totalAmount', { required: 'Required', valueAsNumber: true, min: 0.01 })} />
          </Field>
          <Field label="Payment terms">
            <select className={inputClass} {...register('paymentTerms', { required: true })}>
              {AMC_PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Covered serial numbers" hint="Comma-separated">
          <input className={inputClass} {...register('coveredSerialNumbers')} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending || overCap}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Renew
          </button>
        </div>
      </form>
    </Modal>
  );
}
