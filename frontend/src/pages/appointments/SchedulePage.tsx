import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
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
import { WorkshopIntakeModal } from './WorkshopIntakeModal';
import { getWorkshopIntake } from '../../lib/workshopIntakeApi';
import {
  assignTechnician,
  cancelAppointment,
  completeAppointment,
  confirmAppointment,
  createAppointment,
  deleteAppointment,
  getAppointmentActivity,
  getVisit,
  listAppointments,
  markAppointmentCollectedToWorkshop,
  markAppointmentOnSite,
  overrideFinishAppointmentActivity,
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
  ACTIVE_JOB_TYPES,
  GLANCE_TILES,
  WORKSHOP_SUB_STATUSES,
  type Appointment,
  type AppointmentStatusValue,
  type EffectiveAppointmentStatusValue,
  type CreateAppointmentInput,
} from '../../lib/appointmentsTypes';
import { listApplianceModels, listAppointmentFieldConfigs, listCities, listServiceCentres } from '../../lib/masterDataApi';
import { getBlockedAppointmentsForJobCard, getEligibleAppointmentsForJobCard } from '../../lib/jobCardsApi';
import { blockedJobCardReasonText, type TaskPauseReasonValue } from '../../lib/jobCardsTypes';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { useTechnicianOptions } from '../../lib/useTechnicianOptions';
import { useBillingChannelOptions } from '../../lib/useBillingChannelOptions';

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
  // Phase 5 (2026-09-22) - the New Appointment popup's "Billing Channel" dropdown, the
  // gap the original request's point #4 asked for but Phases 1-4 never actually built.
  // Optional, NamePicker-driven exactly like cityId/applianceModelId above.
  billingChannelId: string;
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
  billingChannelId: '',
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

// req.txt Issue E - Previous/Next Day quick-nav buttons shift off a reference date, so
// repeated clicks step one full day at a time from wherever the filter currently points.
// Pure Y-M-D calendar arithmetic done entirely in UTC (Date.UTC to build, getUTCDate/
// setUTCDate to shift, toISOString to re-serialize) - never mixed with local-time Date
// methods. Bug fixed 2026-09-22: the previous version parsed `${iso}T00:00:00` (local
// midnight) but then shifted with local setDate()/getDate() and re-serialized with
// toISOString() (UTC) - on any host whose local offset isn't exactly a whole multiple that
// keeps local-midnight-plus-N-days on the same UTC calendar day, that round-trip silently
// cancelled out or double-counted the shift (caught by the existing Issue E "Next ▶"/
// "◀ Prev" tests once run on a non-UTC-offset host - see MODIFICATION_REQUESTS.md).
function shiftIsoDate(iso: string, days: number): string {
  const source = iso || todayIsoDate();
  const [y, m, d] = source.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
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
// Job Type split (2026-09-22) Phase 9 - `jobType` added so the REPAIR-only row actions
// below (Collected to WS, Complete) never render for an Installation/Delivery
// Installation appointment. Calling either of those for one of these 2 job types would
// move the appointment into a status the mobile Work card / activity-override flow
// doesn't expect (COLLECTED_TO_WS or COMPLETED with no AppointmentActivity ever
// finished) - a real trap found while building this phase's own CCE override, not just
// theoretical: AppointmentsService.overrideFinishActivity() explicitly rejects once an
// appointment reaches either of those statuses.
function availableActions(
  status: AppointmentStatusValue,
  type: string,
  jobType: string | null | undefined,
  hasJobCard: boolean,
  has: (key: string) => boolean,
) {
  const isAmc = type === 'AMC';
  const isActivityJobType = jobType === 'INSTALLATION' || jobType === 'DELIVERY_INSTALLATION';
  const preVisit = status === 'SCHEDULED' || status === 'CONFIRMED' || status === 'TECHNICIAN_ASSIGNED';
  const activeNotYetOnSite = status === 'CONFIRMED' || status === 'TECHNICIAN_ASSIGNED';
  return {
    canEdit: has('SCHEDULE_VIEW_UPDATE') && preVisit,
    canConfirm: has('SCHEDULE_CCE_MANAGE') && status === 'SCHEDULED',
    canMarkOnSite: has('SCHEDULE_FIELD_VISIT') && activeNotYetOnSite,
    canMarkCollectedToWorkshop:
      has('SCHEDULE_FIELD_VISIT') && (activeNotYetOnSite || status === 'ON_SITE') && !isActivityJobType,
    canComplete: has('SCHEDULE_FIELD_VISIT') && status === 'ON_SITE' && !isAmc && !isActivityJobType,
    canCompleteAmcVisit: status === 'ON_SITE' && isAmc,
    // Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 4, req. 3e) - the
    // COLLECTED_TO_WS equivalent of "Complete": leads into the workshop intake screen
    // rather than completing directly, since a Job Card still needs to be created from
    // there first (see WorkshopIntakeModal). Gated on the same capability the backend
    // requires for every workshop-intake endpoint (WORKSHOP_INTAKE_SN_VALIDATE).
    canMarkReceived: has('WORKSHOP_INTAKE_SN_VALIDATE') && status === 'COLLECTED_TO_WS',
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

  // req.txt Issue D - the Status filter is shareable via URL (?status=Completed etc.), so
  // a link into "just today's cancellations" works for whoever opens it. searchParams is
  // read once for the initial filters state below; setStatusFilter() (below the appointments
  // query) is the one place that ever changes it again, keeping the URL and filters.status
  // from drifting apart.
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFilters] = useState({
    serviceCentreId: '',
    technicianId: '',
    status: (searchParams.get('status') || '') as EffectiveAppointmentStatusValue | '',
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

  // Phase 5 (2026-09-22) - the New Appointment popup's "Billing Channel" dropdown, the
  // gap the original request's point #4 asked for but Phases 1-4 never actually built.
  // Reuses the same options hook the Price List form's own Billing Channel picker uses.
  const billingChannelOptions = useBillingChannelOptions();

  // Master-Data/New-Appointment billing modification Phase 2 (2026-09-22), req. 1 -
  // Super-Admin-editable mandatory-field config, read once and applied to every optional
  // field on this popup below (asterisked label + a submit-time check, since several of
  // these fields - cityId/applianceModelId - are NamePicker-driven, not plain register()
  // inputs, so a uniform submit-time check covers both kinds of field the same way rather
  // than wiring `required` individually per input type). `type`/`customerType` are never
  // in this list - see the config entity's own doc comment.
  const { data: fieldConfigs } = useQuery({
    queryKey: ['master-data', 'appointment-field-configs'],
    queryFn: () => listAppointmentFieldConfigs(),
  });
  // Job Type split (requested 2026-09-22), Phase 6 - a fieldKey can now have several rows
  // (one global, jobType: null, plus one per Job Type that overrides it for that Job Type
  // only). Resolves the most specific row for the CURRENTLY SELECTED Job Type - mirrors
  // AppointmentsService.validateMandatoryFields()'s own resolution on the backend exactly,
  // so the popup's asterisks/hidden fields never disagree with what the server will accept.
  function resolveFieldConfig(key: string) {
    const rows = (fieldConfigs ?? []).filter((c) => c.fieldKey === key);
    return rows.find((c) => c.jobType === watchedJobType) ?? rows.find((c) => c.jobType == null);
  }
  const isFieldMandatory = (key: string) => resolveFieldConfig(key)?.isMandatory ?? false;
  // A field with no config row at all defaults to visible (every pre-Phase-6 field keeps
  // behaving exactly as before) - only an explicit isVisible: false row hides it.
  const isFieldVisible = (key: string) => resolveFieldConfig(key)?.isVisible ?? true;

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
        status: (filters.status || undefined) as EffectiveAppointmentStatusValue | undefined,
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

  // "+ Create Job" pill (req.txt Issue F, widened 2026-09-21 to also cover on-site jobs):
  // reuses JobCardsService.findEligibleForJobCardCreation() via the same endpoint the
  // JobCardsPage picker already calls, rather than re-deriving the eligibility rule
  // (invoice on file + S/N/warranty/fault/symptom captured, from workshop_intakes for a
  // COLLECTED_TO_WS row or technician_visits for every other status) client-side. Blank
  // query = full eligible pool (capped at 30 by that endpoint, same cap the JobCardsPage
  // picker already lives with). Same 20s poll as the main list so the pill and the list
  // never disagree for long.
  const { data: eligibleForJobCard } = useQuery({
    queryKey: ['job-cards', 'eligible-appointments'],
    queryFn: () => getEligibleAppointmentsForJobCard(),
    refetchInterval: 20000,
  });
  const eligibleAppointmentIds = new Set((eligibleForJobCard ?? []).map((a) => a.id));

  // 2026-09-21 live finding: a row can look "ready" (Pending Job Creation, or an on-site
  // visit fully captured) and still never get the pill above, with nothing on the row
  // saying why (the mismatch is JobCardsService.findEligibleForJobCardCreation()'s own
  // separate invoiceNumber gate - see that method's and findBlockedForJobCardCreation()'s
  // doc comments). This surfaces the same "why" here as a small warning badge instead of
  // the row just silently having no pill.
  const { data: blockedForJobCard } = useQuery({
    queryKey: ['job-cards', 'blocked-appointments'],
    queryFn: () => getBlockedAppointmentsForJobCard(),
    refetchInterval: 20000,
  });
  const blockedAppointmentReasons = new Map((blockedForJobCard ?? []).map((a) => [a.id, a.reason]));

  const [createOpen, setCreateOpen] = useState(false);
  // Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 2, req. 2b) - the same popup
  // now doubles as Edit: null means "creating new", an Appointment means "editing this
  // one", pre-filled by openEdit() below. Assign is no longer a separate row action/modal -
  // (re)assigning a technician happens from inside this popup's own scheduling grid.
  const [editTarget, setEditTarget] = useState<Appointment | null>(null);
  const [mutationError, setMutationError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  // Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 4, req. 3e/3.4) - "Mark
  // Received" reuses this same Edit popup (spec: "reopens the same appointment popup so
  // details can be verified/updated") rather than a separate form; this flag just changes
  // the popup's submit button/footer and, on success, routes into the workshop intake
  // screen instead of just closing. See openMarkReceived() and onSubmit()'s edit branch.
  const [openedForIntake, setOpenedForIntake] = useState(false);
  const [intakeTarget, setIntakeTarget] = useState<Appointment | null>(null);

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
  const watchedBillingChannelId = watch('billingChannelId');
  // Job Type split (requested 2026-09-22), Phase 6 - drives both the per-Job-Type field
  // visibility below and, in edit mode, keeps MAINTENANCE selectable on an appointment
  // that already has it (see jobTypeSelectOptions below) even though it's hidden from
  // ACTIVE_JOB_TYPES for anything new.
  const watchedJobType = watch('jobType');
  // MAINTENANCE is soft-hidden (locked decision, Job Type split request): dropped from
  // every NEW pick, but an appointment that already has it must keep showing it as its
  // own selected option in edit mode - re-saving the form must never silently change an
  // existing MAINTENANCE appointment's Job Type just because the option disappeared.
  const jobTypeSelectOptions =
    watchedJobType === 'MAINTENANCE' ? [...ACTIVE_JOB_TYPES, 'MAINTENANCE' as const] : ACTIVE_JOB_TYPES;

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
    // req.txt Issue A - "Today at a Glance" must recount after every create/update/delete,
    // not just on its own 60s poll. Every mutation below already funnels success through
    // this one function (or calls it directly as onSuccess), so this single line covers all
    // of them rather than repeating it at each mutation's onSuccess.
    queryClient.invalidateQueries({ queryKey: ['appointment-dashboard-stats'] });
  }

  // req.txt Issue D - the one place filters.status ever changes: keeps the dropdown, the
  // glance widget's active tile, and the URL's ?status= all in sync. Passed to both the
  // Status <select> below and DashboardStatsWidget's onSelectStatus.
  // req.txt Issue E - Previous/Next Day/Today buttons set From AND To to the same computed
  // date (a single-day view), stepping off whichever of dateFrom/dateTo is already set so
  // repeated clicks walk one day at a time; 'today' ignores the current filter entirely.
  function applyQuickDate(delta: number | 'today') {
    setPage(1);
    setFilters((f) => {
      const next = delta === 'today' ? todayIsoDate() : shiftIsoDate(f.dateFrom || f.dateTo || todayIsoDate(), delta);
      return { ...f, dateFrom: next, dateTo: next };
    });
  }

  function setStatusFilter(status: EffectiveAppointmentStatusValue | '') {
    setPage(1);
    setFilters((f) => ({ ...f, status }));
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (status) next.set('status', status);
        else next.delete('status');
        return next;
      },
      { replace: true },
    );
  }

  function closeForm() {
    setCreateOpen(false);
    setEditTarget(null);
    setCustomerLookupHistory(null);
    setOpenedForIntake(false);
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
      billingChannelId: appointment.billingChannelId ?? '',
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

  // Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 4, req. 3e) - "Mark Received"
  // opens the exact same pre-filled Edit popup as openEdit(), just flagged so its footer
  // offers a path into the workshop intake screen (see onSubmit()'s edit branch and the
  // "Skip" button rendered near the form's submit button below).
  function openMarkReceived(appointment: Appointment) {
    openEdit(appointment);
    setOpenedForIntake(true);
  }

  async function onSubmit(values: FormValues) {
    // Master-Data/New-Appointment billing modification Phase 2, req. 1 - client-side
    // mirror of AppointmentsService.validateMandatoryFields() on create. Scoped to create
    // only (matching the backend, which only enforces this in create() too) - cityId/
    // applianceModelId are NamePicker-driven rather than plain register() inputs, so this
    // one submit-time check covers every optional field uniformly instead of wiring
    // `required` per input type. The backend re-checks this regardless (this is UX, not
    // the security boundary), so a stale/unfetched config here just means the backend
    // catches it instead - never a way to bypass a mandatory field.
    if (!editTarget) {
      // Job Type split (requested 2026-09-22), Phase 6 - resolves per fieldKey the same
      // "most specific row for values.jobType wins" way resolveFieldConfig() above does,
      // instead of treating any isMandatory row for that fieldKey as binding regardless of
      // Job Type. A resolved row with isVisible: false is skipped (it was never shown for
      // the CCE to fill in - matches AppointmentsService.validateMandatoryFields()).
      const fieldKeys = new Set((fieldConfigs ?? []).map((c) => c.fieldKey));
      const missingLabels: string[] = [];
      for (const fieldKey of fieldKeys) {
        const rows = (fieldConfigs ?? []).filter((c) => c.fieldKey === fieldKey);
        const resolved = rows.find((c) => c.jobType === values.jobType) ?? rows.find((c) => c.jobType == null);
        if (!resolved || !resolved.isMandatory || resolved.isVisible === false) continue;
        const value = (values as unknown as Record<string, unknown>)[fieldKey];
        const isMissing = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
        if (isMissing) missingLabels.push(resolved.fieldLabel);
      }
      if (missingLabels.length > 0) {
        setMutationError(new Error(`Missing mandatory field(s): ${missingLabels.join(', ')}`));
        return;
      }
    }

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
      billingChannelId: values.billingChannelId || undefined,
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
        // Captured before closeForm() resets editTarget/openedForIntake to null/false.
        const goToIntake = openedForIntake;
        const target = editTarget;
        closeForm();
        if (goToIntake && target) {
          setIntakeTarget(target);
        }
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
    // req.txt Issue B/C - shows the resolved sub-stage (Marked Received / Pending Job
    // Creation) for a COLLECTED_TO_WS row instead of the same generic badge for all of them;
    // falls back to the raw status for any row a caller/mock didn't attach effectiveStatus to.
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.effectiveStatus ?? r.status} /> },
    { key: 'centre', label: 'Service Centre', render: (r) => r.serviceCentre?.name ?? r.serviceCentreId },
    { key: 'technician', label: 'Technician', render: (r) => (r.technician ? `${r.technician.firstName} ${r.technician.lastName}` : '—') },
    { key: 'scheduledAt', label: 'Scheduled', render: (r) => new Date(r.scheduledAt).toLocaleString() },
  ];

  return (
    <div className="space-y-4">
      <DashboardStatsWidget
        serviceCentreId={filters.serviceCentreId || undefined}
        activeStatus={filters.status}
        onSelectStatus={setStatusFilter}
      />

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

      {/* req.txt Issue E - was `flex flex-wrap items-end gap-3`: `items-end` bottom-aligns
          each field's *column* to its own content height, so any field with a taller label/
          hint (or, before Issue B/C's Channel fix, a lone hint line) throws its control out
          of line with its neighbors - a class of bug a flex row keeps reintroducing one field
          at a time. A grid with a fixed column template sizes every cell the same regardless
          of its content, so this can't recur; every control below is `w-full` to actually
          fill that cell (the old per-field `w-36`/`w-40`/`w-48` classes sized them for the
          flex row and would otherwise leave dead space in a wider grid column). */}
      <div
        className="rounded-lg border border-slate-200 bg-white p-4"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}
      >
        <Field label="Service centre">
          <NamePicker
            value={filters.serviceCentreId || null}
            options={serviceCentreOptions}
            onChange={(id) => { setPage(1); setFilters((f) => ({ ...f, serviceCentreId: id ?? '' })); }}
          />
        </Field>
        <Field label="Technician" hint={!technicianOptions.accessible ? 'paste uuid - name list needs Team Leader access' : undefined}>
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
        </Field>
        <Field label="Status">
          <select
            className={`${inputClass} w-full`}
            value={filters.status}
            onChange={(e) => setStatusFilter(e.target.value as EffectiveAppointmentStatusValue | '')}
          >
            <option value="">All</option>
            {APPOINTMENT_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>
            ))}
            {/* req.txt Issue B - the two COLLECTED_TO_WS sub-statuses, listed by the same
                labels GLANCE_TILES uses so the dropdown and the glance widget never disagree. */}
            {WORKSHOP_SUB_STATUSES.map((s) => (
              <option key={s} value={s}>{GLANCE_TILES.find((t) => t.statusValue === s)!.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Type">
          <select
            className={`${inputClass} w-full`}
            value={filters.type}
            onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, type: e.target.value })); }}
          >
            <option value="">All</option>
            {APPOINTMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>
            ))}
          </select>
        </Field>
        <Field label="Channel">
          <select
            className={`${inputClass} w-full`}
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
          {/* Native calendar icon: inputClass has no `appearance-none`/icon-hiding rule, so
              the browser's built-in icon is already visible and clickable here - nothing to
              fix. `w-full` (in place of the old fixed `w-36`) just lets it fill its grid cell
              like every other control in this row. */}
          <input
            type="date"
            className={`${inputClass} w-full`}
            value={filters.dateFrom}
            onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, dateFrom: e.target.value })); }}
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            className={`${inputClass} w-full`}
            value={filters.dateTo}
            onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, dateTo: e.target.value })); }}
          />
        </Field>
        {/* Deliberately NOT a <Field> here: Field wraps its children in a single <label>,
            which is fine for one input but breaks accessible-name computation for a group of
            several buttons - the first button ends up "labelled" by the label's ENTIRE text
            content (its own text plus its siblings' and the hint's), while the others somehow
            keep their own (caught by the new Issue E tests below: the "◀ Prev" button's
            accessible name came back as "Quick nav Today Next ▶ Sets From and To to the same
            day" once it briefly used Field). This reproduces Field's visual classes by hand
            instead, with a plain <span> caption. */}
        <div className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Quick nav</span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => applyQuickDate(-1)}
              className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              ◀ Prev
            </button>
            <button
              type="button"
              onClick={() => applyQuickDate('today')}
              className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => applyQuickDate(1)}
              className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              Next ▶
            </button>
          </div>
          <span className="mt-1 block text-xs text-slate-400">Sets From and To to the same day</span>
        </div>
      </div>

      {actionError ? <ErrorNotice error={actionError} /> : null}

      <DataTable
        columns={columns}
        rows={data?.data}
        isLoading={isLoading}
        error={error}
        emptyMessage="No appointments match these filters yet."
        rowActions={(row) => {
          const a = availableActions(row.status, row.type, row.jobType, !!row.jobCard, has);
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
              {a.canMarkReceived && (
                <button
                  onClick={() => { setActionError(null); openMarkReceived(row); }}
                  className="text-xs font-medium text-violet-700 hover:text-violet-900"
                  title="Verify the appointment's details, then capture serial number/warranty/fault/symptom and create the Job Card"
                >
                  Mark Received →
                </button>
              )}
              {/* req.txt Issue F - a row that's actually ready for Job Card creation (per
                  JobCardsService.findEligibleForJobCardCreation(), fetched into
                  eligibleAppointmentIds above) with no Job Card yet gets a visual cue and a
                  direct shortcut into Job Cards, rather than relying on the CCE to remember
                  it's still pending. Widened 2026-09-21: originally gated on
                  effectiveStatus MARKED_RECEIVED/PENDING_JOB_CREATION only (workshop-intake
                  sub-stages), which meant an on-site job with a fully captured field visit
                  never got the pill even though create() would already accept it. Now gated
                  on the same eligible-set the backend itself would honor, so both the
                  workshop (Collected to WS -> Marked Received -> Pending Job Creation) and
                  on-site (field visit S/N/warranty/fault-symptom captured) paths show it.
                  Links into the exact same screen WorkshopIntakeModal's own Step 4 hands off
                  to (JobCardsPage reads ?appointmentId=, looks the appointment up, and shows
                  a single "Create Job Card" button once intake is complete - see that page's
                  Gate 1/FR-05 check for what "complete" means) rather than a new inline form:
                  the backend has no separate fields to pre-fill (createJobCard only ever
                  takes { appointmentId }, deriving customer/service centre/job type from the
                  appointment server-side), so that page already IS the pre-filled form.
                  No separate "Job Created" badge state needed either: once the Job Card is
                  created the backend auto-completes the appointment (completeFromJobCardCreation),
                  row.jobCard becomes non-null and the row drops out of the eligible set on
                  the next refetch - so this pill simply stops rendering (the spec's "...or
                  hide it" option). */}
              {eligibleAppointmentIds.has(row.id) && !row.jobCard && (
                <Link
                  to={`/job-cards?appointmentId=${row.id}`}
                  className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                  title="Open Job Cards, pre-filled with this appointment, to create its Job Card"
                >
                  + Create Job
                </Link>
              )}
              {/* 2026-09-21 live finding - see blockedAppointmentReasons above. A row that's
                  captured but blocked (currently: no invoice number on file) gets this
                  instead of the pill, so it's never just silently absent. */}
              {blockedAppointmentReasons.has(row.id) && !row.jobCard && (
                <span
                  className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
                  title={blockedJobCardReasonText(blockedAppointmentReasons.get(row.id)!)}
                >
                  Job card blocked ⓘ
                </span>
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
      <Modal
        open={createOpen}
        onClose={closeForm}
        title={
          editTarget
            ? openedForIntake
              ? `Verify before workshop intake — ${editTarget.appointmentNumber}`
              : `Edit — ${editTarget.appointmentNumber}`
            : 'New Appointment'
        }
      >
        <form onSubmit={handleSubmit(onSubmit)} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <ErrorNotice error={mutationError} />
          {openedForIntake && (
            <p className="rounded-md border border-violet-200 bg-violet-50 p-2 text-xs text-violet-800">
              Check the details below (brand/model, serial number, invoice number) are
              correct before receiving this unit into the workshop.
            </p>
          )}

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
                  if (a.billingChannelId) setValue('billingChannelId', a.billingChannelId);
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
                {jobTypeSelectOptions.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Customer type">
            <select className={inputClass} {...register('customerType', { required: true })}>
              {CUSTOMER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field
            label={isFieldMandatory('channel') ? 'Channel *' : 'Channel (optional)'}
            hint="How this request came in - Service Desk triage"
            error={errors.channel?.message}
          >
            <select className={inputClass} {...register('channel')}>
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
            <Field label={isFieldMandatory('customerEmail') ? 'Email *' : 'Email (optional)'} error={errors.customerEmail?.message}>
              <input
                type="email"
                className={inputClass}
                {...register('customerEmail')}
              />
            </Field>
            <Field label={isFieldMandatory('customerAddress') ? 'Address *' : 'Address (optional)'} error={errors.customerAddress?.message}>
              <input
                className={inputClass}
                {...register('customerAddress')}
              />
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
            <Field label={isFieldMandatory('cityId') ? 'City *' : 'City (optional)'}>
              <NamePicker
                value={watchedCityId || null}
                options={cityOptions}
                onChange={(id) => setValue('cityId', id ?? '')}
              />
            </Field>
            <Field
              label={isFieldMandatory('country') ? 'Country *' : 'Country'}
              hint="Informational only - VAT stays Service Centre-driven"
              error={errors.country?.message}
            >
              <select className={inputClass} {...register('country')}>
                {APPOINTMENT_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field
              label={isFieldMandatory('customerVatNumber') ? 'VAT number *' : 'VAT number (optional)'}
              hint="B2B only"
              error={errors.customerVatNumber?.message}
            >
              <input
                className={inputClass}
                {...register('customerVatNumber')}
              />
            </Field>
          </div>
          {isFieldVisible('applianceModelId') && (
            <Field
              label={isFieldMandatory('applianceModelId') ? 'Brand / Model *' : 'Brand / Model (optional)'}
              hint="Search by brand or model"
            >
              <NamePicker
                value={watchedApplianceModelId || null}
                options={applianceModelOptions}
                onChange={(id) => setValue('applianceModelId', id ?? '')}
                placeholder="Type a brand or model…"
              />
            </Field>
          )}
          <Field
            label={isFieldMandatory('billingChannelId') ? 'Billing Channel *' : 'Billing Channel (optional)'}
            hint="Finance routing for B2B interdepartment billing - separate from the intake Channel above"
          >
            <NamePicker
              value={watchedBillingChannelId || null}
              options={billingChannelOptions.options}
              loading={billingChannelOptions.loading}
              onChange={(id) => setValue('billingChannelId', id ?? '')}
            />
          </Field>
          {(isFieldVisible('serialNumber') || isFieldVisible('invoiceNumber')) && (
            <div className="grid grid-cols-2 gap-4">
              {isFieldVisible('serialNumber') && (
                <Field label={isFieldMandatory('serialNumber') ? 'Serial number *' : 'Serial number (optional)'} error={errors.serialNumber?.message}>
                  <input
                    className={inputClass}
                    {...register('serialNumber')}
                  />
                </Field>
              )}
              {isFieldVisible('invoiceNumber') && (
                <Field
                  label={isFieldMandatory('invoiceNumber') ? 'Invoice number *' : 'Invoice number (optional)'}
                  hint="Needed later to create a Job Card for this appointment (FR-05)"
                  error={errors.invoiceNumber?.message}
                >
                  <input
                    className={inputClass}
                    {...register('invoiceNumber')}
                  />
                </Field>
              )}
            </div>
          )}
          {isFieldVisible('purchaseDate') && (
            <Field label={isFieldMandatory('purchaseDate') ? 'Purchase date *' : 'Purchase date (optional)'} error={errors.purchaseDate?.message}>
              <input
                type="date"
                className={inputClass}
                {...register('purchaseDate')}
              />
            </Field>
          )}
          {isFieldVisible('problemDescription') && (
            <Field
              label={isFieldMandatory('problemDescription') ? 'Problem description *' : 'Problem description (optional)'}
              error={errors.problemDescription?.message}
            >
              <textarea
                className={inputClass}
                rows={2}
                {...register('problemDescription')}
              />
            </Field>
          )}
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

          <Field label={isFieldMandatory('notes') ? 'Notes *' : 'Notes (optional)'} error={errors.notes?.message}>
            <textarea
              className={inputClass}
              rows={2}
              {...register('notes')}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeForm} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
              Cancel
            </button>
            {openedForIntake && editTarget && (
              <button
                type="button"
                onClick={() => {
                  const target = editTarget;
                  closeForm();
                  setIntakeTarget(target);
                }}
                className="rounded-md border border-violet-200 px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-50"
                title="Nothing to change — go straight to the workshop intake screen"
              >
                Skip — details are correct
              </button>
            )}
            <button
              type="submit"
              disabled={isSubmitting || createMutation.isPending || updateMutation.isPending || reassignMutation.isPending || (!editTarget && !gridSelection)}
              title={!editTarget && !gridSelection ? 'Pick a technician + time slot on the grid above first' : undefined}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {editTarget ? (openedForIntake ? 'Save & continue to intake' : 'Save changes') : 'Create'}
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
      <ViewAppointmentModal
        appointment={viewTarget}
        onClose={() => setViewTarget(null)}
        onMarkReceived={(a) => { setViewTarget(null); openMarkReceived(a); }}
        canMarkReceived={has('WORKSHOP_INTAKE_SN_VALIDATE')}
        canOverrideActivityFinish={has('SCHEDULE_CCE_MANAGE')}
      />

      {/* --- Workshop intake (Phase 4) --- */}
      <WorkshopIntakeModal appointment={intakeTarget} onClose={() => setIntakeTarget(null)} />
    </div>
  );
}

// Job Type split (2026-09-22) Phase 8 - same reason labels as JobCardsPage.tsx's own
// TASK_PAUSE_REASON_LABELS (local there too, not shared centrally - see that file), used
// here for the read-only activity timeline's pause reason text.
const ACTIVITY_PAUSE_REASON_LABELS: Record<TaskPauseReasonValue, string> = {
  MATERIAL_SHORTAGE: 'Material shortage',
  AWAITING_CUSTOMER_APPROVAL: 'Awaiting customer approval',
  CUSTOMER_UNAVAILABLE: 'Customer unavailable',
  BREAK: 'Break',
  OTHER: 'Other',
};

function ViewAppointmentModal({
  appointment,
  onClose,
  onMarkReceived,
  canMarkReceived,
  canOverrideActivityFinish,
}: {
  appointment: Appointment | null;
  onClose: () => void;
  onMarkReceived: (appointment: Appointment) => void;
  canMarkReceived: boolean;
  canOverrideActivityFinish: boolean;
}) {
  const queryClient = useQueryClient();
  // Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 4) - a COLLECTED_TO_WS
  // appointment can never have a TechnicianVisit (it was collected, not visited on-site),
  // so the old unconditional getVisit() query below used to 404 and render a misleading
  // "No visit started for this appointment yet" with no way forward (live-tested bug,
  // 2026-09-16). Skip that query entirely for COLLECTED_TO_WS and show the workshop
  // intake status instead.
  const isCollectedToWs = appointment?.status === 'COLLECTED_TO_WS';
  // Job Type split (2026-09-22) Phase 8 - Installation/Delivery Installation appointments
  // never get a TechnicianVisit (see the mobile screen's own isActivityJobType comment),
  // so the Technician visit box below is replaced with the live activity status/timeline
  // instead, and the visit query is skipped entirely for these two job types (same
  // COLLECTED_TO_WS reasoning already documented above - a query the backend would just
  // 404 for isn't worth issuing).
  const isActivityJobType = appointment?.jobType === 'INSTALLATION' || appointment?.jobType === 'DELIVERY_INSTALLATION';
  const { data: visit, error: visitError, isLoading: visitLoading } = useQuery({
    queryKey: ['technician-visit', appointment?.id],
    queryFn: () => getVisit(appointment!.id),
    enabled: !!appointment && !isCollectedToWs && !isActivityJobType,
    retry: false,
  });
  const { data: intake, isLoading: intakeLoading } = useQuery({
    queryKey: ['workshop-intake', appointment?.id],
    queryFn: () => getWorkshopIntake(appointment!.id),
    enabled: !!appointment && isCollectedToWs,
  });
  const {
    data: activity,
    error: activityError,
    isLoading: activityLoading,
    isFetching: activityFetching,
    refetch: refetchActivity,
  } = useQuery({
    queryKey: ['appointment-activity', appointment?.id],
    queryFn: () => getAppointmentActivity(appointment!.id),
    enabled: !!appointment && isActivityJobType,
    // Same 15-30s live-polling pattern already used on Workshop/Dashboard (see
    // WorkshopPage.tsx's own refetchInterval) - a manual refresh button below covers the
    // gap between polls.
    refetchInterval: 20000,
  });

  // Job Type split (2026-09-22) Phase 9 - point 9's CCE manual override, for when a
  // technician hands over a paper completion document instead of using the mobile flow.
  // Invalidates the same ['appointment-activity', id] query key the poll above already
  // uses, so the box re-renders FINISHED immediately rather than waiting up to 20s for
  // the next poll.
  const overrideFinishMutation = useMutation({
    mutationFn: () => overrideFinishAppointmentActivity(appointment!.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appointment-activity', appointment!.id] }),
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
          <DetailRow label="Billing Channel">{appointment.billingChannel?.name ?? '—'}</DetailRow>
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

        {isActivityJobType ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Work status</p>
              <button
                type="button"
                onClick={() => refetchActivity()}
                disabled={activityFetching}
                className="text-xs text-slate-500 hover:text-slate-700 hover:underline disabled:opacity-50"
              >
                {activityFetching ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            {activityLoading && <p className="mt-1 text-slate-500">Loading…</p>}
            {activityError && <ErrorNotice error={activityError} />}
            {activity && (
              <div className="mt-2 space-y-2">
                <StatusBadge status={activity.status} />
                {activity.status === 'NOT_STARTED' && (
                  <p className="text-slate-600">The technician hasn&apos;t started work yet.</p>
                )}
                {activity.startedAt && (
                  <p className="text-slate-600">Started {new Date(activity.startedAt).toLocaleString()}</p>
                )}
                {activity.status === 'PAUSED' && (() => {
                  const openPause = activity.pauses.find((p) => p.resumedAt === null);
                  return openPause ? (
                    <p className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
                      <span className="font-medium">Paused</span> — {ACTIVITY_PAUSE_REASON_LABELS[openPause.reason]}
                      {openPause.notes && ` — "${openPause.notes}"`}
                      <span className="ml-1 text-orange-600">since {new Date(openPause.pausedAt).toLocaleString()}</span>
                    </p>
                  ) : null;
                })()}
                {activity.finishedAt && (
                  <p className="text-slate-600">Finished {new Date(activity.finishedAt).toLocaleString()}</p>
                )}
                {activity.status !== 'FINISHED' && canOverrideActivityFinish && (
                  <div className="rounded-md border border-slate-200 bg-white p-2">
                    <p className="text-xs text-slate-500">
                      Technician handed over a paper completion document instead of using the mobile app?
                    </p>
                    {overrideFinishMutation.isError && <ErrorNotice error={overrideFinishMutation.error} />}
                    <button
                      type="button"
                      disabled={overrideFinishMutation.isPending}
                      onClick={() => overrideFinishMutation.mutate()}
                      className="mt-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {overrideFinishMutation.isPending ? 'Marking complete…' : 'Mark Activity Complete'}
                    </button>
                  </div>
                )}
                {activity.pauses.length > 0 && (
                  <details className="text-xs text-slate-500">
                    <summary className="cursor-pointer font-medium text-slate-600">Timeline ({activity.pauses.length} pause{activity.pauses.length === 1 ? '' : 's'})</summary>
                    <ul className="mt-2 space-y-1">
                      {activity.startedAt && <li>Started — {new Date(activity.startedAt).toLocaleString()}</li>}
                      {activity.pauses.map((p) => (
                        <li key={p.id}>
                          {ACTIVITY_PAUSE_REASON_LABELS[p.reason]}
                          {p.notes ? ` — "${p.notes}"` : ''} — {new Date(p.pausedAt).toLocaleString()}
                          {p.resumedAt ? ` → resumed ${new Date(p.resumedAt).toLocaleString()}` : ' (still paused)'}
                        </li>
                      ))}
                      {activity.finishedAt && <li>Finished — {new Date(activity.finishedAt).toLocaleString()}</li>}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
        ) : isCollectedToWs ? (
          <div className="rounded-md border border-violet-200 bg-violet-50 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-violet-500">Workshop intake</p>
            {intakeLoading && <p className="mt-1 text-slate-500">Loading…</p>}
            {!intakeLoading && !intake && <p className="mt-1 text-slate-600">Not received at the workshop yet.</p>}
            {intake && (
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                <DetailRow label="Received">{new Date(intake.receivedAt).toLocaleString()}</DetailRow>
                <DetailRow label="Serial / warranty">
                  {intake.serialNumber ? (
                    <>
                      {intake.serialNumber}{' '}
                      {intake.warrantyStatus && <StatusBadge status={intake.warrantyStatus} />}
                    </>
                  ) : 'Not captured yet'}
                </DetailRow>
                <DetailRow label="Fault / symptom">
                  {intake.faultCode ? `${intake.faultCode} / ${intake.symptomCode}` : 'Not captured yet'}
                </DetailRow>
              </div>
            )}
            {canMarkReceived && (
              <button
                onClick={() => onMarkReceived(appointment)}
                className="mt-3 rounded-md bg-violet-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-800"
              >
                {intake ? 'Continue workshop intake →' : 'Mark Received →'}
              </button>
            )}
          </div>
        ) : (
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
        )}

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
