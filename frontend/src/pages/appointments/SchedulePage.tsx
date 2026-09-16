import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import type { AxiosError } from 'axios';
import { DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { NamePicker } from '../../components/pickers/NamePicker';
import { AsyncSearchPicker } from '../../components/pickers/AsyncSearchPicker';
import { DashboardStatsWidget } from './DashboardStatsWidget';
import { SchedulingGridPicker, type SchedulingSelection } from './SchedulingGrid';
import {
  assignTechnician,
  cancelAppointment,
  completeAppointment,
  confirmAppointment,
  createAppointment,
  deleteAppointment,
  getVisit,
  listAppointments,
  markAppointmentCollectedToWorkshop,
  markAppointmentOnSite,
  resolveMapLink,
  searchAppointments,
  updateAppointment,
} from '../../lib/appointmentsApi';
import {
  APPOINTMENT_CHANNELS,
  APPOINTMENT_COUNTRIES,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  CUSTOMER_TYPES,
  JOB_TYPES,
  type Appointment,
  type AppointmentStatusValue,
  type CreateAppointmentInput,
} from '../../lib/appointmentsTypes';
import { listApplianceModels, listCities, listServiceCentres } from '../../lib/masterDataApi';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { useTechnicianOptions } from '../../lib/useTechnicianOptions';

type FormValues = {
  type: string;
  // Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 2) - orthogonal to `type`
  // (coverage). Defaults to REPAIR.
  jobType: string;
  channel: string;
  customerType: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  // Deliberately plain strings, not `valueAsNumber`-backed numbers: an empty number input's
  // native `.valueAsNumber` is NaN (not ''), and react-hook-form's `valueAsNumber: true`
  // reads through to that native property on every watch()/getValues() call - not just on
  // change - so an untouched field would silently read back as NaN rather than ''. Parsing
  // happens once, explicitly, at submit time (onSubmit below) instead.
  customerLat: string;
  customerLng: string;
  // Phase 2 - City/Country dropdowns replace the old free-text customerCity/customerCountry
  // inputs for anything created or edited from this popup going forward (see cityId/country
  // on CreateAppointmentInput). Old appointments' string values still display read-only in
  // ViewAppointmentModal if their new FK fields were never set.
  cityId: string;
  country: string;
  customerVatNumber: string;
  // Phase 2 - Appliance Model master replaces the old free-text brand/modelNumber inputs.
  applianceModelId: string;
  serialNumber: string;
  purchaseDate: string;
  invoiceNumber: string;
  problemDescription: string;
  serviceCentreId: string;
  notes: string;
};

const EMPTY_FORM: FormValues = {
  type: 'WARRANTY',
  jobType: 'REPAIR',
  channel: 'PHONE',
  customerType: 'B2C',
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  customerAddress: '',
  customerLat: '',
  customerLng: '',
  cityId: '',
  country: 'UAE',
  customerVatNumber: '',
  applianceModelId: '',
  serialNumber: '',
  purchaseDate: '',
  invoiceNumber: '',
  problemDescription: '',
  serviceCentreId: '',
  notes: '',
};

function googleMapsViewUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

// A blank field must become `undefined` (omit the field entirely), never NaN/null - see the
// FormValues.customerLat/customerLng doc comment for why these stay plain strings up to
// this point rather than react-hook-form's `valueAsNumber`.
function parseOptionalNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// Mirrors the exact status-transition guards in AppointmentsService, so we don't render a
// button that the backend will just 400 - see confirmAppointment/markOnSite/
// completeAppointment/assignTechnician/markCollectedToWorkshop for the source of these
// checks.
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
// 2026-09-14 (Group B): each flag now ALSO requires the exact backend capability that
// guards its action (AppointmentsController: assign-technician -> SCHEDULE_ASSIGN_TECHNICIAN,
// confirm/cancel -> SCHEDULE_CCE_MANAGE, on-site/complete/collected-to-ws -> SCHEDULE_FIELD_VISIT)
// - these buttons used to render for every logged-in user regardless of capability, only
// 403ing on click.
//
// Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 2, decision #2/req. 2b/2c):
// - `canAssign` is gone as a standalone row action - a technician is now (re)assigned from
//   inside the Edit popup's own scheduling grid, not a repeated separate row button.
// - `canConfirm`/`canMarkOnSite`/`canMarkCollectedToWorkshop` no longer gate on a strict
//   linear order (there's no CCE-confirm precondition for Onsite any more) - they're each
//   independently available across the same span of "still active, not yet on a terminal
//   or completed path" statuses. Every one of the endpoints behind them is idempotent
//   server-side, so clicking one that's already effectively true is a safe no-op - this is
//   the "manual override" the spec calls for, built as plain always-safe buttons rather than
//   one button that has to guess which state you meant.
// - `canEdit` mirrors the backend's own read/write appointment.entity.ts intent: editable
//   up to TECHNICIAN_ASSIGNED (nothing real has happened in the field yet), read-only once
//   a visit or a workshop collection is actually underway.
function availableActions(status: AppointmentStatusValue, type: string, hasJobCard: boolean, has: (key: string) => boolean) {
  const isAmc = type === 'AMC';
  const preVisit = status === 'SCHEDULED' || status === 'CONFIRMED' || status === 'TECHNICIAN_ASSIGNED';
  const activeNotYetOnSite = status === 'CONFIRMED' || status === 'TECHNICIAN_ASSIGNED';
  return {
    canEdit: has('SCHEDULE_VIEW_UPDATE') && preVisit,
    canConfirm: has('SCHEDULE_CCE_MANAGE') && status === 'SCHEDULED',
    canMarkOnSite: has('SCHEDULE_FIELD_VISIT') && activeNotYetOnSite,
    canMarkCollectedToWorkshop: has('SCHEDULE_FIELD_VISIT') && (activeNotYetOnSite || status === 'ON_SITE'),
    canComplete: has('SCHEDULE_FIELD_VISIT') && status === 'ON_SITE' && !isAmc,
    canCompleteAmcVisit: status === 'ON_SITE' && isAmc,
    // Once a Job Card exists the appointment is fulfilled - see
    // AppointmentsService.cancel()'s guard, which this mirrors so we don't render a
    // button the backend will just 409 on.
    canCancel: has('SCHEDULE_CCE_MANAGE') && status !== 'COMPLETED' && status !== 'CANCELLED' && !hasJobCard,
  };
}

export function SchedulePage() {
  const queryClient = useQueryClient();
  const { has } = useMyCapabilities();
  const canManage = has('SCHEDULE_CCE_MANAGE');

  const [filters, setFilters] = useState({
    serviceCentreId: '',
    technicianId: '',
    status: '',
    type: '',
    channel: '',
    dateFrom: '',
    dateTo: '',
  });
  const [page, setPage] = useState(1);
  const limit = 20;

  // #218: name-based pickers for the filter bar/forms below, replacing raw pasted uuids.
  const { data: serviceCentres } = useQuery({ queryKey: ['master-data', 'service-centres'], queryFn: () => listServiceCentres() });
  const serviceCentreOptions = (serviceCentres ?? []).map((sc) => ({ id: sc.id, name: sc.name }));
  const technicianOptions = useTechnicianOptions();

  // Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 2, req. 1) - the two new master
  // data sources the New Appointment popup's City/Brand+Model dropdowns are built from.
  const { data: cities } = useQuery({ queryKey: ['master-data', 'cities'], queryFn: () => listCities() });
  const cityOptions = (cities ?? []).map((c) => ({ id: c.id, name: c.name }));
  const { data: applianceModels } = useQuery({ queryKey: ['master-data', 'appliance-models'], queryFn: () => listApplianceModels() });
  const applianceModelOptions = (applianceModels ?? []).map((m) => ({
    id: m.id,
    name: `${m.brand} — ${m.model}`,
  }));

  const {
    data,
    isLoading,
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['appointments', filters, page],
    queryFn: () =>
      listAppointments({
        serviceCentreId: filters.serviceCentreId || undefined,
        technicianId: filters.technicianId || undefined,
        status: (filters.status || undefined) as AppointmentStatusValue | undefined,
        type: (filters.type || undefined) as CreateAppointmentInput['type'] | undefined,
        channel: (filters.channel || undefined) as CreateAppointmentInput['channel'] | undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        page,
        limit,
      }),
    // Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 2, req. 4) - same lightweight
    // polling pattern already used by the Workshop screen (15s) and mobile job-card
    // polling, rather than a new WebSocket gateway. Refetches in the background - React
    // Query only swaps in new data once it lands, so an open modal isn't disturbed by it.
    refetchInterval: 20000,
  });

  const [createOpen, setCreateOpen] = useState(false);
  // Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 2, req. 2b) - the same popup
  // now doubles as Edit: null means "creating new", an Appointment means "editing this
  // one", pre-filled by openEdit() below. Assign is no longer a separate row action/modal -
  // (re)assigning a technician happens from inside this popup's own scheduling grid.
  const [editTarget, setEditTarget] = useState<Appointment | null>(null);
  const [mutationError, setMutationError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [viewTarget, setViewTarget] = useState<Appointment | null>(null);

  // The New Appointment scheduling grid (2026-09-09) picks the technician, start time, AND
  // duration together via tapped chips - kept as plain state rather than RHF-registered
  // fields, since there's no visible date/technician/duration input for RHF to register
  // against any more, only the grid component reporting a selection.
  const [gridDate, setGridDate] = useState(todayIsoDate());
  const [gridSelection, setGridSelection] = useState<SchedulingSelection | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: EMPTY_FORM });
  const watchedServiceCentreId = watch('serviceCentreId');
  // #218: serviceCentreId is now driven by NamePicker via setValue()/watch() rather than a
  // native <input {...register()}>, so it's registered here (not spread onto any element)
  // purely to keep its `required` validation active - the documented RHF pattern for wiring
  // a non-native controlled input into the form without <Controller>.
  register('serviceCentreId', { required: 'Required' });
  // Phase 2 (2026-09-16) - same NamePicker-via-setValue()/watch() pattern as
  // serviceCentreId above, but both optional so no register()/required needed.
  const watchedCityId = watch('cityId');
  const watchedApplianceModelId = watch('applianceModelId');

  // Phase 2 (2026-09-16, req. 1b) - which past appointment (if any) the customer-lookup
  // search below was filled in from, so a "view repair history" link can show once
  // something's been picked. Cleared whenever the popup opens fresh.
  const [customerLookupHistory, setCustomerLookupHistory] = useState<Appointment | null>(null);

  const [mapLinkInput, setMapLinkInput] = useState('');
  const resolveMapLinkMutation = useMutation({
    mutationFn: (url: string) => resolveMapLink(url),
    onSuccess: (coords) => {
      setValue('customerLat', String(coords.lat));
      setValue('customerLng', String(coords.lng));
    },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['appointments'] });
  }

  function closeForm() {
    setCreateOpen(false);
    setEditTarget(null);
    setCustomerLookupHistory(null);
  }

  const createMutation = useMutation({
    mutationFn: (data: CreateAppointmentInput) => createAppointment(data),
    onSuccess: () => {
      invalidate();
      closeForm();
    },
    onError: (err) => setMutationError(err),
  });

  // Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 2, req. 2b) - Edit is a real
  // update, unlike the removed standalone Assign modal. Reassigning the technician/time
  // from inside this same popup (below) is a SEPARATE call to the existing
  // assignTechnician endpoint, awaited right after this one in onSubmit - the backend has
  // no single "update everything including scheduling" endpoint, and there's no value in
  // inventing one just for this form.
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateAppointmentInput> }) => updateAppointment(id, data),
    onError: (err) => setMutationError(err),
  });
  const reassignMutation = useMutation({
    mutationFn: ({ id, technicianId, scheduledAt }: { id: string; technicianId: string; scheduledAt: string }) =>
      assignTechnician(id, technicianId, scheduledAt),
    onError: (err) => setMutationError(err),
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
  const collectedToWorkshopMutation = useMutation({
    mutationFn: (id: string) => markAppointmentCollectedToWorkshop(id),
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
    setEditTarget(null);
    setCustomerLookupHistory(null);
    reset(EMPTY_FORM);
    setMapLinkInput('');
    resolveMapLinkMutation.reset();
    setGridDate(todayIsoDate());
    setGridSelection(null);
    setCreateOpen(true);
  }

  // Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 2, req. 2b) - opens the same
  // popup pre-filled from an existing appointment. Only rendered from row actions when
  // availableActions().canEdit is true (pre-visit statuses), so the backend's own
  // read-only-once-visited intent is never actually tested here client-side - this is
  // convenience, not the enforcement boundary.
  function openEdit(appointment: Appointment) {
    setMutationError(null);
    setEditTarget(appointment);
    setCustomerLookupHistory(null);
    reset({
      type: appointment.type,
      jobType: appointment.jobType || 'REPAIR',
      channel: appointment.channel,
      customerType: appointment.customerType,
      customerName: appointment.customerName,
      customerPhone: appointment.customerPhone,
      customerEmail: appointment.customerEmail ?? '',
      customerAddress: appointment.customerAddress ?? '',
      customerLat: appointment.customerLat != null ? String(appointment.customerLat) : '',
      customerLng: appointment.customerLng != null ? String(appointment.customerLng) : '',
      cityId: appointment.cityId ?? '',
      country: appointment.country || 'UAE',
      customerVatNumber: appointment.customerVatNumber ?? '',
      applianceModelId: appointment.applianceModelId ?? '',
      serialNumber: appointment.serialNumber ?? '',
      purchaseDate: appointment.purchaseDate ? appointment.purchaseDate.slice(0, 10) : '',
      invoiceNumber: appointment.invoiceNumber ?? '',
      problemDescription: appointment.problemDescription ?? '',
      serviceCentreId: appointment.serviceCentreId,
      notes: appointment.notes ?? '',
    });
    setMapLinkInput('');
    resolveMapLinkMutation.reset();
    setGridDate(appointment.scheduledAt.slice(0, 10));
    // Left null deliberately - "no change" for the technician/time, distinct from create
    // where a slot pick is mandatory. Only set if the CCE actually taps a new slot below.
    setGridSelection(null);
    setCreateOpen(true);
  }

  async function onSubmit(values: FormValues) {
    const sharedFields = {
      type: values.type as CreateAppointmentInput['type'],
      jobType: values.jobType as CreateAppointmentInput['jobType'],
      channel: values.channel as CreateAppointmentInput['channel'],
      customerType: values.customerType as CreateAppointmentInput['customerType'],
      customerName: values.customerName,
      customerPhone: values.customerPhone,
      customerEmail: values.customerEmail || undefined,
      customerAddress: values.customerAddress || undefined,
      customerLat: parseOptionalNumber(values.customerLat),
      customerLng: parseOptionalNumber(values.customerLng),
      cityId: values.cityId || undefined,
      country: (values.country || undefined) as CreateAppointmentInput['country'],
      customerVatNumber: values.customerVatNumber || undefined,
      applianceModelId: values.applianceModelId || undefined,
      serialNumber: values.serialNumber || undefined,
      purchaseDate: values.purchaseDate || undefined,
      invoiceNumber: values.invoiceNumber || undefined,
      problemDescription: values.problemDescription || undefined,
      notes: values.notes || undefined,
    };

    if (editTarget) {
      // Edit mode (req. 2b): the popup's own scheduling grid is optional here - a blank
      // gridSelection means "leave the technician/time as they are", so this is a plain
      // field update. Only when the CCE actually taps a new slot does a second call
      // (assignTechnician, same endpoint the removed standalone Assign modal used) also
      // run, awaited right after so a failed reassignment surfaces without silently
      // leaving the field edits half-applied.
      try {
        await updateMutation.mutateAsync({ id: editTarget.id, data: { ...sharedFields, serviceCentreId: values.serviceCentreId } });
        if (gridSelection) {
          await reassignMutation.mutateAsync({
            id: editTarget.id,
            technicianId: gridSelection.technicianId,
            scheduledAt: gridSelection.scheduledAt,
          });
        }
        invalidate();
        closeForm();
      } catch {
        // onError on each mutation already set mutationError for display - nothing further
        // to do here, and closeForm() must NOT run so the CCE can see the error and retry.
      }
      return;
    }

    // Create mode: scheduledAt/technicianId/estimatedDurationMinutes all come from one tap
    // on the scheduling grid, not three separate fields - see gridSelection's own doc
    // comment. The Create button stays disabled until a chip is picked (below), so
    // gridSelection is never null here in practice.
    const payload: CreateAppointmentInput = {
      ...sharedFields,
      scheduledAt: gridSelection?.scheduledAt ?? '',
      estimatedDurationMinutes: gridSelection?.estimatedDurationMinutes,
      serviceCentreId: values.serviceCentreId,
      technicianId: gridSelection?.technicianId,
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
    // Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 2) - orthogonal to Type
    // (coverage) above; jobType falls back to REPAIR for any row read before Phase 1
    // shipped, matching the DB column's own default.
    { key: 'jobType', label: 'Job Type', render: (r) => (r.jobType || 'REPAIR').replaceAll('_', ' ') },
    { key: 'channel', label: 'Channel', render: (r) => <span className="text-xs text-slate-600">{r.channel.replaceAll('_', ' ')}</span> },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'centre', label: 'Service Centre', render: (r) => r.serviceCentre?.name ?? r.serviceCentreId },
    { key: 'technician', label: 'Technician', render: (r) => (r.technician ? `${r.technician.firstName} ${r.technician.lastName}` : '—') },
    { key: 'scheduledAt', label: 'Scheduled', render: (r) => new Date(r.scheduledAt).toLocaleString() },
  ];

  return (
    <div className="space-y-4">
      <DashboardStatsWidget serviceCentreId={filters.serviceCentreId || undefined} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-2xl text-sm text-slate-500">
          Every filter below maps directly to a real <code>GET /appointments</code> query
          param - there's no client-side search, only what the backend actually accepts.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {/* Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 2, req. 4) - manual
              refresh alongside the 20s background poll above, for an immediate check
              rather than waiting out the interval. */}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh now"
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            {isFetching ? 'Refreshing…' : '⟲ Refresh'}
          </button>
          {canManage && (
            <button
              onClick={openCreate}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              + New Appointment
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <Field label="Service centre">
          <div className="w-48">
            <NamePicker
              value={filters.serviceCentreId || null}
              options={serviceCentreOptions}
              onChange={(id) => { setPage(1); setFilters((f) => ({ ...f, serviceCentreId: id ?? '' })); }}
            />
          </div>
        </Field>
        <Field label="Technician" hint={!technicianOptions.accessible ? 'paste uuid - name list needs Team Leader access' : undefined}>
          <div className="w-48">
            {technicianOptions.accessible ? (
              <NamePicker
                value={filters.technicianId || null}
                options={technicianOptions.options}
                loading={technicianOptions.loading}
                onChange={(id) => { setPage(1); setFilters((f) => ({ ...f, technicianId: id ?? '' })); }}
              />
            ) : (
              <input
                className={inputClass}
                placeholder="paste uuid"
                value={filters.technicianId}
                onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, technicianId: e.target.value })); }}
              />
            )}
          </div>
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
        <Field label="Channel" hint="Service Desk triage - how the request came in">
          <select
            className={`${inputClass} w-36`}
            value={filters.channel}
            onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, channel: e.target.value })); }}
          >
            <option value="">All</option>
            {APPOINTMENT_CHANNELS.map((c) => (
              <option key={c} value={c}>{c.replaceAll('_', ' ')}</option>
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
          const a = availableActions(row.status, row.type, !!row.jobCard, has);
          return (
            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={() => setViewTarget(row)} className="text-xs font-medium text-slate-600 hover:text-slate-900">
                View
              </button>
              {a.canEdit && (
                <button onClick={() => { setActionError(null); openEdit(row); }} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
                  Edit
                </button>
              )}
              {a.canConfirm && (
                <button onClick={() => { setActionError(null); confirmMutation.mutate(row.id); }} className="text-xs font-medium text-sky-600 hover:text-sky-800">
                  Confirm
                </button>
              )}
              {/* Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 2, decision #2) -
                  no CCE-confirm precondition any more, and every one of these transition
                  endpoints is idempotent server-side, so both buttons below double as the
                  spec's "manual override": safe to click even if a mobile action for the
                  same appointment is still in flight or already landed. */}
              {a.canMarkOnSite && (
                <button onClick={() => { setActionError(null); onSiteMutation.mutate(row.id); }} className="text-xs font-medium text-amber-600 hover:text-amber-800">
                  Mark on-site
                </button>
              )}
              {a.canMarkCollectedToWorkshop && (
                <button
                  onClick={() => { setActionError(null); collectedToWorkshopMutation.mutate(row.id); }}
                  className="text-xs font-medium text-violet-600 hover:text-violet-800"
                  title="For a walk-in, driver-collected, or field-technician-collected unit heading to the workshop"
                >
                  Mark collected to WS
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

      {/* --- Create / Edit --- */}
      <Modal open={createOpen} onClose={closeForm} title={editTarget ? `Edit — ${editTarget.appointmentNumber}` : 'New Appointment'}>
        <form onSubmit={handleSubmit(onSubmit)} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <ErrorNotice error={mutationError} />

          {/* Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 2, req. 1b) - customer
              lookup by name/phone/serial number, reusing GET /appointments?q= (now also
              ILIKE-matching serialNumber). Create-only: an edit already has its customer.
              Selecting a result autofills the fields below and links into that
              appointment's own repair history via Job Card Journey when one exists. */}
          {!editTarget && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                Customer lookup (optional) — search by name, phone, or serial number
              </p>
              <AsyncSearchPicker
                search={(query) => searchAppointments(query)}
                getOptionLabel={(a) => `${a.customerName} ${a.customerPhone}`}
                placeholder="Start typing a name, phone, or serial number…"
                renderOption={(a) => (
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      <span className="font-medium text-slate-900">{a.customerName}</span>{' '}
                      <span className="text-slate-400">{a.customerPhone}</span>
                    </span>
                    <span className="text-xs text-slate-400">
                      {a.appointmentNumber} · {new Date(a.scheduledAt).toLocaleDateString()}
                    </span>
                  </div>
                )}
                emptyMessage="No past appointment matches that yet."
                onSelect={(a) => {
                  setValue('customerName', a.customerName);
                  setValue('customerPhone', a.customerPhone);
                  if (a.customerEmail) setValue('customerEmail', a.customerEmail);
                  if (a.customerAddress) setValue('customerAddress', a.customerAddress);
                  if (a.cityId) setValue('cityId', a.cityId);
                  if (a.country) setValue('country', a.country);
                  if (a.customerVatNumber) setValue('customerVatNumber', a.customerVatNumber);
                  if (a.applianceModelId) setValue('applianceModelId', a.applianceModelId);
                  if (a.serialNumber) setValue('serialNumber', a.serialNumber);
                  setCustomerLookupHistory(a);
                }}
              />
              {customerLookupHistory && (
                <p className="mt-2 text-xs text-emerald-700">
                  Filled in from {customerLookupHistory.appointmentNumber} ({new Date(customerLookupHistory.scheduledAt).toLocaleDateString()}).
                  {customerLookupHistory.jobCard && (
                    <>
                      {' '}
                      <Link to={`/job-cards/journey?jobCardId=${customerLookupHistory.jobCard.id}`} className="underline" target="_blank" rel="noreferrer">
                        View repair history →
                      </Link>
                    </>
                  )}
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Type" hint="Coverage - Warranty/AMC/etc">
              <select className={inputClass} {...register('type', { required: true })}>
                {APPOINTMENT_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}
              </select>
            </Field>
            <Field label="Job type" hint="What work is being done - independent of coverage">
              <select className={inputClass} {...register('jobType', { required: true })}>
                {JOB_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Customer type">
            <select className={inputClass} {...register('customerType', { required: true })}>
              {CUSTOMER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Channel" hint="How this request came in - Service Desk triage">
            <select className={inputClass} {...register('channel', { required: true })}>
              {APPOINTMENT_CHANNELS.map((c) => <option key={c} value={c}>{c.replaceAll('_', ' ')}</option>)}
            </select>
          </Field>
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
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              Service address coordinates (optional)
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1" style={{ minWidth: '14rem' }}>
                <Field label="Paste a Google Maps link">
                  <input
                    className={inputClass}
                    placeholder="https://maps.app.goo.gl/…"
                    value={mapLinkInput}
                    onChange={(e) => setMapLinkInput(e.target.value)}
                  />
                </Field>
              </div>
              <button
                type="button"
                disabled={!mapLinkInput.trim() || resolveMapLinkMutation.isPending}
                onClick={() => resolveMapLinkMutation.mutate(mapLinkInput.trim())}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                {resolveMapLinkMutation.isPending ? 'Resolving…' : 'Resolve'}
              </button>
            </div>
            {resolveMapLinkMutation.error ? <ErrorNotice error={resolveMapLinkMutation.error} /> : null}
            {resolveMapLinkMutation.isSuccess && resolveMapLinkMutation.data && (
              <p className="mt-1 text-xs text-emerald-700">
                Resolved: {resolveMapLinkMutation.data.lat}, {resolveMapLinkMutation.data.lng}
              </p>
            )}
            <div className="mt-2 grid grid-cols-2 gap-4">
              <Field label="Latitude (optional)" hint="Auto-filled by Resolve, or type it in">
                <input type="number" step="any" className={inputClass} {...register('customerLat')} />
              </Field>
              <Field label="Longitude (optional)">
                <input type="number" step="any" className={inputClass} {...register('customerLng')} />
              </Field>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="City (optional)">
              <NamePicker
                value={watchedCityId || null}
                options={cityOptions}
                onChange={(id) => setValue('cityId', id ?? '')}
              />
            </Field>
            <Field label="Country" hint="Informational only - VAT stays Service Centre-driven">
              <select className={inputClass} {...register('country')}>
                {APPOINTMENT_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="VAT number (optional)" hint="B2B only">
              <input className={inputClass} {...register('customerVatNumber')} />
            </Field>
          </div>
          <Field label="Brand / Model (optional)" hint="Search by brand or model">
            <NamePicker
              value={watchedApplianceModelId || null}
              options={applianceModelOptions}
              onChange={(id) => setValue('applianceModelId', id ?? '')}
              placeholder="Type a brand or model…"
            />
          </Field>
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
          <Field label="Purchase date (optional)">
            <input type="date" className={inputClass} {...register('purchaseDate')} />
          </Field>
          <Field label="Problem description (optional)">
            <textarea className={inputClass} rows={2} {...register('problemDescription')} />
          </Field>
          <Field label="Service centre" error={errors.serviceCentreId?.message}>
            <NamePicker
              value={watchedServiceCentreId || null}
              options={serviceCentreOptions}
              onChange={(id) => setValue('serviceCentreId', id ?? '', { shouldValidate: true })}
            />
          </Field>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              Technician &amp; time{editTarget ? ' (optional - only pick a slot to reassign)' : ''}
            </p>
            {editTarget && !gridSelection && (
              <p className="mb-2 text-xs text-slate-500">
                Currently {editTarget.technician ? `${editTarget.technician.firstName} ${editTarget.technician.lastName}` : 'unassigned'} ·{' '}
                {new Date(editTarget.scheduledAt).toLocaleString()}. Pick a new slot below only if this needs to change.
              </p>
            )}
            <SchedulingGridPicker
              serviceCentreId={watchedServiceCentreId}
              date={gridDate}
              onDateChange={setGridDate}
              onChange={setGridSelection}
            />
            {gridSelection ? (
              <p className="mt-2 text-xs font-medium text-emerald-700">
                {gridSelection.technicianName} · {new Date(gridSelection.scheduledAt).toLocaleString()} · {gridSelection.estimatedDurationMinutes} min
              </p>
            ) : !editTarget ? (
              <p className="mt-2 text-xs text-slate-400">Pick a slot above to set the technician and time.</p>
            ) : null}
          </div>

          <Field label="Notes (optional)">
            <textarea className={inputClass} rows={2} {...register('notes')} />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeForm} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || createMutation.isPending || updateMutation.isPending || reassignMutation.isPending || (!editTarget && !gridSelection)}
              title={!editTarget && !gridSelection ? 'Pick a technician + time slot on the grid above first' : undefined}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {editTarget ? 'Save changes' : 'Create'}
            </button>
          </div>
        </form>
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
          <DetailRow label="Job type">{(appointment.jobType || 'REPAIR').replaceAll('_', ' ')}</DetailRow>
          <DetailRow label="Channel">{appointment.channel.replaceAll('_', ' ')}</DetailRow>
          <DetailRow label="Customer">{appointment.customerName} · {appointment.customerPhone}</DetailRow>
          <DetailRow label="Customer type">{appointment.customerType}</DetailRow>
          <DetailRow label="City">{appointment.city?.name ?? appointment.customerCity ?? '—'}</DetailRow>
          <DetailRow label="Country">{appointment.country ?? '—'}</DetailRow>
          <DetailRow label="Service centre">{appointment.serviceCentre?.name ?? appointment.serviceCentreId}</DetailRow>
          <DetailRow label="Technician">{appointment.technician ? `${appointment.technician.firstName} ${appointment.technician.lastName}` : 'Unassigned'}</DetailRow>
          <DetailRow label="Scheduled">{new Date(appointment.scheduledAt).toLocaleString()}</DetailRow>
          <DetailRow label="Brand / model">
            {appointment.applianceModel
              ? `${appointment.applianceModel.brand} / ${appointment.applianceModel.model}`
              : [appointment.brand, appointment.modelNumber].filter(Boolean).join(' / ') || '—'}
          </DetailRow>
          <DetailRow label="Serial number">{appointment.serialNumber ?? '—'}</DetailRow>
          <DetailRow label="Invoice number"><InvoiceNumberField appointment={appointment} /></DetailRow>
          <DetailRow label="Service address coordinates">
            {appointment.customerLat != null && appointment.customerLng != null ? (
              <a
                href={googleMapsViewUrl(appointment.customerLat, appointment.customerLng)}
                target="_blank"
                rel="noreferrer"
                className="text-slate-700 underline"
              >
                {appointment.customerLat.toFixed(5)}, {appointment.customerLng.toFixed(5)} · View on Google Maps →
              </a>
            ) : '—'}
          </DetailRow>
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
              {/* Number(...) guards against a decimal column ever coming back as a string
                  (node-postgres's default for NUMERIC/DECIMAL) - see main.ts's global type
                  parser fix for the real root cause; this is just defense-in-depth so a
                  future drift here degrades to a value, not a blank page. */}
              <DetailRow label="GPS">{Number(visit.startGpsLat).toFixed(4)}, {Number(visit.startGpsLng).toFixed(4)}</DetailRow>
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

// Live-tested bug fix (2026-09-14): invoiceNumber was only ever collectable on the CREATE
// form - once an appointment existed without one (easy to do; it was never required there),
// there was no way to add it later, and JobCardsService.create()'s Gate 1 (FR-05) blocks
// Job Card creation forever without it. UpdateAppointmentDto already accepts invoiceNumber
// (PartialType(CreateAppointmentDto)) and AppointmentsService.update() already persists any
// field via Object.assign - the backend was never the blocker, only this screen was missing
// an edit control for it. Kept inline here (not a full "edit appointment" form, which this
// app has never had) since this is the one field CCE actually gets stuck needing to add
// after the fact.
function InvoiceNumberField({ appointment }: { appointment: Appointment }) {
  const queryClient = useQueryClient();
  // 2026-09-14 (Group B): this Add/Edit control calls updateAppointment (PUT /:id), which is
  // @RequiresCapability('SCHEDULE_VIEW_UPDATE') - used to render for every logged-in user
  // regardless of capability, only 403ing on click.
  const { has } = useMyCapabilities();
  const canEdit = has('SCHEDULE_VIEW_UPDATE');
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(appointment.invoiceNumber ?? '');
  const [savedNumber, setSavedNumber] = useState(appointment.invoiceNumber ?? null);

  const saveMutation = useMutation({
    mutationFn: () => updateAppointment(appointment.id, { invoiceNumber: value.trim() }),
    onSuccess: (updated) => {
      setSavedNumber(updated.invoiceNumber ?? value.trim());
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
  });

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span>{savedNumber ?? '—'}</span>
        {canEdit && (
          <button
            type="button"
            className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
            onClick={() => {
              setValue(savedNumber ?? '');
              setEditing(true);
            }}
          >
            {savedNumber ? 'Edit' : 'Add'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <input
          className={inputClass}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. INV-2026-00123"
          autoFocus
        />
        <button
          type="button"
          disabled={!value.trim() || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Save
        </button>
        <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
      {saveMutation.isError && <ErrorNotice error={saveMutation.error} />}
    </div>
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
