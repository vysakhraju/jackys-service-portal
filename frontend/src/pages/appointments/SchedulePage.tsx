import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import type { AxiosError } from 'axios';
import { DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import {
  assignTechnician,
  cancelAppointment,
  completeAppointment,
  confirmAppointment,
  createAppointment,
  deleteAppointment,
  getVisit,
  listAppointments,
  markAppointmentOnSite,
} from '../../lib/appointmentsApi';
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  CUSTOMER_TYPES,
  type Appointment,
  type AppointmentStatusValue,
  type CreateAppointmentInput,
} from '../../lib/appointmentsTypes';

type FormValues = {
  type: string;
  customerType: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  customerCity: string;
  customerCountry: string;
  customerVatNumber: string;
  brand: string;
  modelNumber: string;
  serialNumber: string;
  purchaseDate: string;
  invoiceNumber: string;
  problemDescription: string;
  scheduledAt: string;
  estimatedDurationMinutes: number | '';
  serviceCentreId: string;
  technicianId: string;
  notes: string;
};

const EMPTY_FORM: FormValues = {
  type: 'WARRANTY',
  customerType: 'B2C',
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  customerAddress: '',
  customerCity: '',
  customerCountry: '',
  customerVatNumber: '',
  brand: '',
  modelNumber: '',
  serialNumber: '',
  purchaseDate: '',
  invoiceNumber: '',
  problemDescription: '',
  scheduledAt: '',
  estimatedDurationMinutes: '',
  serviceCentreId: '',
  technicianId: '',
  notes: '',
};

// Mirrors the exact status-transition guards in AppointmentsService, so we don't render a
// button that the backend will just 400 - see confirmAppointment/markOnSite/
// completeAppointment/assignTechnician for the source of these checks.
//
// Frontend Phase 10 (AMC Management) pre-mortem finding #1: an AMC-type appointment (a
// generated PM visit) used to show this same generic "Complete" button, which calls PUT
// /appointments/:id/complete - NOT AmcService.completeVisit() - and never creates the
// AmcVisitCompletion record (checklist/signature/extra-charge). Since that endpoint
// unconditionally refuses to run once status is already COMPLETED, clicking the generic
// button here would permanently and silently lose that visit's ability to ever be
// documented. The backend now rejects this combination outright (see
// appointments.service.ts's own guard), and this button is replaced with a link into the
// AMC module's own completion flow for AMC rows, so a technician never hits that 400 in
// the first place.
function availableActions(status: AppointmentStatusValue, type: string) {
  const isAmc = type === 'AMC';
  return {
    canAssign: status === 'SCHEDULED' || status === 'CONFIRMED',
    canConfirm: status === 'SCHEDULED',
    canMarkOnSite: status === 'CONFIRMED' || status === 'TECHNICIAN_ASSIGNED',
    canComplete: status === 'ON_SITE' && !isAmc,
    canCompleteAmcVisit: status === 'ON_SITE' && isAmc,
    canCancel: status !== 'COMPLETED' && status !== 'CANCELLED',
  };
}

export function SchedulePage() {
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState({
    serviceCentreId: '',
    technicianId: '',
    status: '',
    type: '',
    dateFrom: '',
    dateTo: '',
  });
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading, error } = useQuery({
    queryKey: ['appointments', filters, page],
    queryFn: () =>
      listAppointments({
        serviceCentreId: filters.serviceCentreId || undefined,
        technicianId: filters.technicianId || undefined,
        status: (filters.status || undefined) as AppointmentStatusValue | undefined,
        type: (filters.type || undefined) as CreateAppointmentInput['type'] | undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        page,
        limit,
      }),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [mutationError, setMutationError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const [assignTarget, setAssignTarget] = useState<Appointment | null>(null);
  const [assignTechId, setAssignTechId] = useState('');
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [viewTarget, setViewTarget] = useState<Appointment | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: EMPTY_FORM });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['appointments'] });
  }

  const createMutation = useMutation({
    mutationFn: (data: CreateAppointmentInput) => createAppointment(data),
    onSuccess: () => {
      invalidate();
      setCreateOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, technicianId }: { id: string; technicianId: string }) => assignTechnician(id, technicianId),
    onSuccess: () => {
      invalidate();
      setAssignTarget(null);
      setAssignTechId('');
    },
    onError: (err) => setActionError(err),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => cancelAppointment(id, reason),
    onSuccess: () => {
      invalidate();
      setCancelTarget(null);
      setCancelReason('');
    },
    onError: (err) => setActionError(err),
  });

  const confirmMutation = useMutation({
    mutationFn: (id: string) => confirmAppointment(id),
    onSuccess: invalidate,
    onError: (err) => setActionError(err),
  });
  const onSiteMutation = useMutation({
    mutationFn: (id: string) => markAppointmentOnSite(id),
    onSuccess: invalidate,
    onError: (err) => setActionError(err),
  });
  const completeMutation = useMutation({
    mutationFn: (id: string) => completeAppointment(id),
    onSuccess: invalidate,
    onError: (err) => setActionError(err),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAppointment(id),
    onSuccess: invalidate,
    onError: (err) => setActionError(err),
  });

  function openCreate() {
    setMutationError(null);
    reset(EMPTY_FORM);
    setCreateOpen(true);
  }

  function onSubmit(values: FormValues) {
    const payload: CreateAppointmentInput = {
      type: values.type as CreateAppointmentInput['type'],
      customerType: values.customerType as CreateAppointmentInput['customerType'],
      customerName: values.customerName,
      customerPhone: values.customerPhone,
      customerEmail: values.customerEmail || undefined,
      customerAddress: values.customerAddress || undefined,
      customerCity: values.customerCity || undefined,
      customerCountry: values.customerCountry || undefined,
      customerVatNumber: values.customerVatNumber || undefined,
      brand: values.brand || undefined,
      modelNumber: values.modelNumber || undefined,
      serialNumber: values.serialNumber || undefined,
      purchaseDate: values.purchaseDate || undefined,
      invoiceNumber: values.invoiceNumber || undefined,
      problemDescription: values.problemDescription || undefined,
      scheduledAt: values.scheduledAt ? new Date(values.scheduledAt).toISOString() : '',
      estimatedDurationMinutes: values.estimatedDurationMinutes === '' ? undefined : Number(values.estimatedDurationMinutes),
      serviceCentreId: values.serviceCentreId,
      technicianId: values.technicianId || undefined,
      notes: values.notes || undefined,
    };
    createMutation.mutate(payload);
  }

  const columns: Column<Appointment>[] = [
    { key: 'number', label: 'Appointment #', render: (r) => <span className="font-medium text-slate-900">{r.appointmentNumber}</span> },
    { key: 'customer', label: 'Customer', render: (r) => (
      <div>
        <div className="text-slate-900">{r.customerName}</div>
        <div className="text-xs text-slate-400">{r.customerPhone}</div>
      </div>
    ) },
    { key: 'type', label: 'Type', render: (r) => r.type.replaceAll('_', ' ') },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'centre', label: 'Service Centre', render: (r) => r.serviceCentre?.name ?? r.serviceCentreId },
    { key: 'technician', label: 'Technician', render: (r) => (r.technician ? `${r.technician.firstName} ${r.technician.lastName}` : '—') },
    { key: 'scheduledAt', label: 'Scheduled', render: (r) => new Date(r.scheduledAt).toLocaleString() },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-2xl text-sm text-slate-500">
          Every filter below maps directly to a real <code>GET /appointments</code> query
          param - there's no client-side search, only what the backend actually accepts.
        </p>
        <button
          onClick={openCreate}
          className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          + New Appointment
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <Field label="Service centre id">
          <input
            className={`${inputClass} w-48`}
            placeholder="paste uuid"
            value={filters.serviceCentreId}
            onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, serviceCentreId: e.target.value })); }}
          />
        </Field>
        <Field label="Technician id">
          <input
            className={`${inputClass} w-48`}
            placeholder="paste uuid"
            value={filters.technicianId}
            onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, technicianId: e.target.value })); }}
          />
        </Field>
        <Field label="Status">
          <select
            className={`${inputClass} w-40`}
            value={filters.status}
            onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, status: e.target.value })); }}
          >
            <option value="">All</option>
            {APPOINTMENT_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>
            ))}
          </select>
        </Field>
        <Field label="Type">
          <select
            className={`${inputClass} w-36`}
            value={filters.type}
            onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, type: e.target.value })); }}
          >
            <option value="">All</option>
            {APPOINTMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input
            type="date"
            className={`${inputClass} w-36`}
            value={filters.dateFrom}
            onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, dateFrom: e.target.value })); }}
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            className={`${inputClass} w-36`}
            value={filters.dateTo}
            onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, dateTo: e.target.value })); }}
          />
        </Field>
      </div>

      {actionError ? <ErrorNotice error={actionError} /> : null}

      <DataTable
        columns={columns}
        rows={data?.data}
        isLoading={isLoading}
        error={error}
        emptyMessage="No appointments match these filters yet."
        rowActions={(row) => {
          const a = availableActions(row.status, row.type);
          return (
            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={() => setViewTarget(row)} className="text-xs font-medium text-slate-600 hover:text-slate-900">
                View
              </button>
              {a.canAssign && (
                <button onClick={() => { setActionError(null); setAssignTarget(row); setAssignTechId(row.technicianId ?? ''); }} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
                  Assign
                </button>
              )}
              {a.canConfirm && (
                <button onClick={() => { setActionError(null); confirmMutation.mutate(row.id); }} className="text-xs font-medium text-sky-600 hover:text-sky-800">
                  Confirm
                </button>
              )}
              {a.canMarkOnSite && (
                <button onClick={() => { setActionError(null); onSiteMutation.mutate(row.id); }} className="text-xs font-medium text-amber-600 hover:text-amber-800">
                  Mark on-site
                </button>
              )}
              {a.canComplete && (
                <button onClick={() => { setActionError(null); completeMutation.mutate(row.id); }} className="text-xs font-medium text-emerald-600 hover:text-emerald-800">
                  Complete
                </button>
              )}
              {a.canCompleteAmcVisit && (
                <Link
                  to={`/amc/contracts?contractId=${row.amcContractId ?? ''}`}
                  className="text-xs font-medium text-emerald-600 hover:text-emerald-800"
                  title="AMC PM visits have their own completion flow - checklist, signature, and extra-charge approval - not this generic action"
                >
                  Complete PM Visit →
                </Link>
              )}
              {a.canCancel && (
                <button onClick={() => { setActionError(null); setCancelTarget(row); setCancelReason(''); }} className="text-xs font-medium text-red-500 hover:text-red-700">
                  Cancel
                </button>
              )}
              <button
                onClick={() => {
                  setActionError(null);
                  if (confirm(`Hard-delete appointment ${row.appointmentNumber}? This cannot be undone and is Super Admin only.`)) {
                    deleteMutation.mutate(row.id);
                  }
                }}
                className="text-xs font-medium text-red-500 hover:text-red-700"
              >
                Delete
              </button>
            </div>
          );
        }}
      />

      {data && data.total > limit && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {data.page} of {Math.max(1, Math.ceil(data.total / data.limit))} ({data.total} total)
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-slate-200 px-3 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              disabled={page * limit >= data.total}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-slate-200 px-3 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* --- Create --- */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Appointment">
        <form onSubmit={handleSubmit(onSubmit)} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <ErrorNotice error={mutationError} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Type">
              <select className={inputClass} {...register('type', { required: true })}>
                {APPOINTMENT_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}
              </select>
            </Field>
            <Field label="Customer type">
              <select className={inputClass} {...register('customerType', { required: true })}>
                {CUSTOMER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
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
            <Field label="Address (optional)">
              <input className={inputClass} {...register('customerAddress')} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="City (optional)">
              <input className={inputClass} {...register('customerCity')} />
            </Field>
            <Field label="Country (optional)">
              <input className={inputClass} {...register('customerCountry')} />
            </Field>
            <Field label="VAT number (optional)" hint="B2B only">
              <input className={inputClass} {...register('customerVatNumber')} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Brand (optional)">
              <input className={inputClass} placeholder="Samsung" {...register('brand')} />
            </Field>
            <Field label="Model number (optional)">
              <input className={inputClass} placeholder="WA80J5710" {...register('modelNumber')} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Serial number (optional)">
              <input className={inputClass} {...register('serialNumber')} />
            </Field>
            <Field
              label="Invoice number (optional)"
              hint="Needed later to create a Job Card for this appointment (FR-05)"
            >
              <input className={inputClass} {...register('invoiceNumber')} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Purchase date (optional)">
              <input type="date" className={inputClass} {...register('purchaseDate')} />
            </Field>
            <Field label="Estimated duration (minutes, optional)" hint="Minimum 15">
              <input type="number" min={15} className={inputClass} {...register('estimatedDurationMinutes', { valueAsNumber: true })} />
            </Field>
          </div>
          <Field label="Problem description (optional)">
            <textarea className={inputClass} rows={2} {...register('problemDescription')} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Scheduled at" error={errors.scheduledAt?.message}>
              <input type="datetime-local" className={inputClass} {...register('scheduledAt', { required: 'Required' })} />
            </Field>
            <Field label="Service centre id" error={errors.serviceCentreId?.message} hint="paste uuid from Master Data">
              <input className={inputClass} {...register('serviceCentreId', { required: 'Required' })} />
            </Field>
          </div>
          <Field label="Technician id (optional)" hint="Assign now, or leave blank and use Assign later">
            <input className={inputClass} {...register('technicianId')} />
          </Field>
          <Field label="Notes (optional)">
            <textarea className={inputClass} rows={2} {...register('notes')} />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setCreateOpen(false)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || createMutation.isPending}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
      </Modal>

      {/* --- Assign technician --- */}
      <Modal open={!!assignTarget} onClose={() => setAssignTarget(null)} title={`Assign technician — ${assignTarget?.appointmentNumber ?? ''}`}>
        {assignTarget && (
          <div className="space-y-4">
            <ErrorNotice error={actionError} />
            <p className="text-sm text-slate-500">
              There's no "list technicians" endpoint in this app yet - paste the technician's
              user id (from the seed script output, Section 4 of TESTING_GUIDE.md). The
              backend rejects anyone whose role isn't Technician Field/Workshop.
            </p>
            <Field label="Technician user id">
              <input className={inputClass} value={assignTechId} onChange={(e) => setAssignTechId(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <button onClick={() => setAssignTarget(null)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
                Cancel
              </button>
              <button
                disabled={!assignTechId || assignMutation.isPending}
                onClick={() => assignMutation.mutate({ id: assignTarget.id, technicianId: assignTechId })}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Assign
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* --- Cancel --- */}
      <Modal open={!!cancelTarget} onClose={() => setCancelTarget(null)} title={`Cancel appointment — ${cancelTarget?.appointmentNumber ?? ''}`}>
        {cancelTarget && (
          <div className="space-y-4">
            <ErrorNotice error={actionError} />
            <Field label="Reason" hint="3-255 characters — required by the backend">
              <textarea className={inputClass} rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <button onClick={() => setCancelTarget(null)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
                Back
              </button>
              <button
                disabled={cancelReason.trim().length < 3 || cancelMutation.isPending}
                onClick={() => cancelMutation.mutate({ id: cancelTarget.id, reason: cancelReason })}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Cancel appointment
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* --- View detail --- */}
      <ViewAppointmentModal appointment={viewTarget} onClose={() => setViewTarget(null)} />
    </div>
  );
}

function ViewAppointmentModal({ appointment, onClose }: { appointment: Appointment | null; onClose: () => void }) {
  const { data: visit, error: visitError, isLoading: visitLoading } = useQuery({
    queryKey: ['technician-visit', appointment?.id],
    queryFn: () => getVisit(appointment!.id),
    enabled: !!appointment,
    retry: false,
  });

  if (!appointment) return null;
  const notFound = (visitError as AxiosError)?.response?.status === 404;

  return (
    <Modal open={!!appointment} onClose={onClose} title={`${appointment.appointmentNumber} — ${appointment.customerName}`}>
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <DetailRow label="Status"><StatusBadge status={appointment.status} /></DetailRow>
          <DetailRow label="Type">{appointment.type.replaceAll('_', ' ')}</DetailRow>
          <DetailRow label="Customer">{appointment.customerName} · {appointment.customerPhone}</DetailRow>
          <DetailRow label="Customer type">{appointment.customerType}</DetailRow>
          <DetailRow label="Service centre">{appointment.serviceCentre?.name ?? appointment.serviceCentreId}</DetailRow>
          <DetailRow label="Technician">{appointment.technician ? `${appointment.technician.firstName} ${appointment.technician.lastName}` : 'Unassigned'}</DetailRow>
          <DetailRow label="Scheduled">{new Date(appointment.scheduledAt).toLocaleString()}</DetailRow>
          <DetailRow label="Brand / model">{[appointment.brand, appointment.modelNumber].filter(Boolean).join(' / ') || '—'}</DetailRow>
          <DetailRow label="Serial number">{appointment.serialNumber ?? '—'}</DetailRow>
          <DetailRow label="Invoice number">{appointment.invoiceNumber ?? '—'}</DetailRow>
          {appointment.cancellationReason && (
            <DetailRow label="Cancellation reason">{appointment.cancellationReason}</DetailRow>
          )}
        </div>
        {appointment.problemDescription && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Problem description</p>
            <p className="mt-1 text-slate-700">{appointment.problemDescription}</p>
          </div>
        )}

        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Technician visit</p>
          {visitLoading && <p className="mt-1 text-slate-500">Loading…</p>}
          {notFound && <p className="mt-1 text-slate-500">No visit started for this appointment yet.</p>}
          {visitError && !notFound && <ErrorNotice error={visitError} />}
          {visit && (
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
              <DetailRow label="Started">{new Date(visit.startedAt).toLocaleString()}</DetailRow>
              <DetailRow label="GPS">{visit.startGpsLat.toFixed(4)}, {visit.startGpsLng.toFixed(4)}</DetailRow>
              <DetailRow label="Serial / warranty">
                {visit.serialNumber ? (
                  <>
                    {visit.serialNumber}{' '}
                    {visit.warrantyStatus && <StatusBadge status={visit.warrantyStatus} />}
                  </>
                ) : 'Not captured yet'}
              </DetailRow>
              <DetailRow label="Fault / symptom">
                {visit.faultCode ? `${visit.faultCode} / ${visit.symptomCode}` : 'Not captured yet'}
              </DetailRow>
            </div>
          )}
        </div>

        {appointment.status === 'COMPLETED' && (
          <Link
            to={`/job-cards?appointmentId=${appointment.id}`}
            className="block rounded-md bg-slate-900 px-3 py-2 text-center text-sm font-medium text-white hover:bg-slate-800"
          >
            Job Card →
          </Link>
        )}
      </div>
    </Modal>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-0.5 text-slate-700">{children}</div>
    </div>
  );
}
