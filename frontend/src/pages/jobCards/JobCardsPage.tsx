import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import type { AxiosError } from 'axios';
import { ErrorNotice } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { getAppointment } from '../../lib/appointmentsApi';
import { listApplianceModels } from '../../lib/masterDataApi';
import {
  approveCustomer,
  assignSection,
  cancelJobCard,
  createActivityJobCard,
  createJobCard,
  getBlockedAppointmentsForJobCard,
  getEligibleActivityAppointmentsForJobCard,
  getEligibleAppointmentsForJobCard,
  getJobCardByAppointment,
  getTaskPauses,
  pauseTask,
  resumeTask,
  validateSn,
  warrantyOverride,
} from '../../lib/jobCardsApi';
import type {
  ActivityJobCardLineItemInput,
  EligibleActivityAppointmentForJobCard,
  EligibleAppointmentForJobCard,
  JobCard,
  JobCardSectionValue,
  JobCardLaneValue,
  JobCardStatusValue,
  TaskPauseReasonValue,
} from '../../lib/jobCardsTypes';
import { blockedJobCardReasonText, TASK_PAUSE_REASONS } from '../../lib/jobCardsTypes';

// Statuses past which this phase's screens stop. WORKSHOP_ASSIGNED/IN_PROGRESS/
// SPARE_PENDING/READY_FOR_QC now link to the Workshop screen (Frontend Phase 6) instead
// of dead-ending here - READY_FOR_QC deliberately stays linked, not terminal, since a
// READY_FOR_QC job can still take a top-up spare request there (workshop.service.ts's own
// comment on requestSpare). Only QC (Phase 7) and Delivery (Phase 8) still pick up from
// QC_PASSED/DELIVERED.
const TERMINAL_FOR_THIS_PHASE: JobCard['status'][] = ['QC_PASSED', 'DELIVERED'];
const WORKSHOP_LINKED_STATUSES: JobCard['status'][] = [
  'WORKSHOP_ASSIGNED',
  'IN_PROGRESS',
  'SPARE_PENDING',
  'READY_FOR_QC',
];

// Task timer pause/resume (SLA-safe pausing). Mirrors PAUSABLE_STATUSES in the backend's
// job-cards.service.ts exactly - SECTION_ASSIGNED covers the only "work under way" status
// an on-site job ever reaches (it has no separate IN_PROGRESS at all), alongside the
// workshop sub-machine's own three statuses.
const PAUSABLE_STATUSES: JobCardStatusValue[] = ['SECTION_ASSIGNED', 'WORKSHOP_ASSIGNED', 'IN_PROGRESS', 'SPARE_PENDING'];

const TASK_PAUSE_REASON_LABELS: Record<TaskPauseReasonValue, string> = {
  MATERIAL_SHORTAGE: 'Material shortage (SLA-exempt)',
  AWAITING_CUSTOMER_APPROVAL: 'Awaiting customer approval',
  CUSTOMER_UNAVAILABLE: 'Customer unavailable',
  BREAK: 'Break',
  OTHER: 'Other',
};

// Lane badge - see backend job-card-progress.util.ts for the derivation this mirrors.
// Purely a display label; nothing here gates any action.
const LANE_META: Record<JobCardLaneValue, { title: string; className: string }> = {
  A: { title: 'On-site repair · In warranty', className: 'bg-emerald-50 text-emerald-700' },
  B: { title: 'On-site repair · Out of warranty', className: 'bg-amber-50 text-amber-700' },
  C: { title: 'Workshop · In warranty', className: 'bg-sky-50 text-sky-700' },
  D: { title: 'Workshop · Out of warranty', className: 'bg-violet-50 text-violet-700' },
};

function LaneBadge({ lane }: { lane: JobCardLaneValue }) {
  const meta = LANE_META[lane];
  return (
    <span
      title={meta.title}
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}
    >
      Lane {lane}
    </span>
  );
}

// --- Job Card progress stepper -------------------------------------------------------
// Bullet-point, single-screen progress indicator (per the user's request to mirror the
// step-by-step flow seen in the Redtra360 competitor review). Purely presentational -
// derived entirely from status + section, both already on the JobCard response, so this
// needs no backend change and can never disagree with the real gating logic elsewhere on
// this page (canValidateSn/canAssignSection/etc. below stay the actual source of truth
// for what actions are allowed).
type StepDef = { status: JobCardStatusValue; label: string };
type StepDisplayState = 'done' | 'current' | 'upcoming';
type ProgressStep = StepDef & { state: StepDisplayState; note?: string };

const COMMON_STEPS: StepDef[] = [
  { status: 'OPEN', label: 'Open' },
  { status: 'SN_VALIDATED', label: 'S/N validated' },
  { status: 'SECTION_ASSIGNED', label: 'Section assigned' },
];
const ON_SITE_ONLY_STEPS: StepDef[] = [
  { status: 'READY_FOR_QC', label: 'Ready for QC' },
  { status: 'QC_PASSED', label: 'QC passed' },
  { status: 'DELIVERED', label: 'Delivered' },
];
const WORKSHOP_ONLY_STEPS: StepDef[] = [
  { status: 'WORKSHOP_ASSIGNED', label: 'Workshop technician assigned' },
  { status: 'IN_PROGRESS', label: 'In progress' },
  { status: 'READY_FOR_QC', label: 'Ready for QC' },
  { status: 'QC_PASSED', label: 'QC passed' },
  { status: 'DELIVERED', label: 'Delivered' },
];

function buildProgressSteps(jobCard: Pick<JobCard, 'status' | 'section'>): ProgressStep[] {
  const sequence: StepDef[] =
    jobCard.section === 'WORKSHOP'
      ? [...COMMON_STEPS, ...WORKSHOP_ONLY_STEPS]
      : jobCard.section === 'ON_SITE_REPAIR'
        ? [...COMMON_STEPS, ...ON_SITE_ONLY_STEPS]
        : // Section not assigned yet - the on-site vs. workshop path isn't known, so only
          // show the steps common to both.
          COMMON_STEPS;

  // RWR loops back to SN_VALIDATED (a revised estimate is needed before re-proceeding);
  // SPARE_PENDING is a hold off IN_PROGRESS. Neither is its own numbered step - each is
  // shown as a note on the step it effectively sits at.
  const effectiveStatus: JobCardStatusValue =
    jobCard.status === 'RWR'
      ? 'SN_VALIDATED'
      : jobCard.status === 'SPARE_PENDING'
        ? 'IN_PROGRESS'
        : jobCard.status;

  const currentIndex = sequence.findIndex((s) => s.status === effectiveStatus);

  return sequence.map((step, i) => {
    const state: StepDisplayState = currentIndex < 0 ? 'upcoming' : i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'upcoming';
    let note: string | undefined;
    if (i === currentIndex && jobCard.status === 'RWR') note = 'Blocked - revised estimate required (RWR)';
    if (i === currentIndex && jobCard.status === 'SPARE_PENDING') note = 'Waiting on spare part stock';
    return { ...step, state, note };
  });
}

function JobCardProgressStepper({ jobCard }: { jobCard: Pick<JobCard, 'status' | 'section'> }) {
  if (jobCard.status === 'CANCELLED') {
    return (
      <div className="border-t border-slate-100 pt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Progress</p>
        <p className="text-sm text-red-600">This Job Card was cancelled - see the reason below.</p>
      </div>
    );
  }

  // Job Type split (Phase 10) - a COMPLETED Job Card never enters the OPEN -> ... pipeline
  // this stepper otherwise walks (no section, no S/N step, nothing to be "current" or
  // "upcoming" at), so it gets its own short message instead of running through
  // buildProgressSteps() below with a status that sequence.findIndex() would never match.
  if (jobCard.status === 'COMPLETED') {
    return (
      <div className="border-t border-slate-100 pt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Progress</p>
        <p className="text-sm text-emerald-600">
          Completed directly from ERP-sourced Installation/Delivery paperwork - see the ERP
          reference number and line items below.
        </p>
      </div>
    );
  }

  const steps = buildProgressSteps(jobCard);

  return (
    <div className="border-t border-slate-100 pt-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Progress</p>
      <ol className="space-y-2">
        {steps.map((step) => (
          <li key={step.status} className="flex items-start gap-2">
            <span
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                step.state === 'done'
                  ? 'bg-emerald-600 text-white'
                  : step.state === 'current'
                    ? 'border-2 border-slate-900'
                    : 'border border-slate-300'
              }`}
            >
              {step.state === 'done' ? '✓' : ''}
            </span>
            <span
              className={`text-sm ${
                step.state === 'current'
                  ? 'font-medium text-slate-900'
                  : step.state === 'done'
                    ? 'text-slate-500'
                    : 'text-slate-400'
              }`}
            >
              {step.label}
              {step.note && <span className="ml-2 text-xs font-normal text-amber-700">({step.note})</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// --- Eligible-appointment picker ------------------------------------------------------
// Modification request (2026-09-17): "provide type to search similar to that of Job Card
// Journey, also list all appointments that fulfilled the criteria for job creation,
// instead now user copy paste appointment number for job creation." Two gaps in the old
// AsyncSearchPicker<Appointment>-based picker this replaces: (1) it searched EVERY
// appointment (searchAppointments), not just ones create() would actually accept right
// now; (2) AsyncSearchPicker never shows a result until the user types >= minChars - there
// was no way to just browse what's eligible. This component fixes both: it always queries
// GET /job-cards/eligible-appointments (backed by
// JobCardsService.findEligibleForJobCardCreation, which mirrors create()'s own FR-05 +
// TechnicianVisit/WorkshopIntake gates exactly), with the typed query as an optional
// narrowing filter rather than a precondition for showing anything - a blank box shows the
// full eligible pool, same list-then-narrow feel as Job Card Journey's search, but without
// Journey's "blank query returns nothing" behavior, since browsing IS the point here.
function EligibleAppointmentPicker({
  onSelect,
  selectedLabel,
  onClear,
}: {
  onSelect: (item: EligibleAppointmentForJobCard) => void;
  /** When set, shows this as the current selection instead of the search box + list. */
  selectedLabel?: string | null;
  onClear?: () => void;
}) {
  const [queryInput, setQueryInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(queryInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [queryInput]);

  const eligibleQuery = useQuery({
    queryKey: ['job-cards', 'eligible-appointments', debouncedQuery],
    queryFn: () => getEligibleAppointmentsForJobCard(debouncedQuery || undefined),
  });

  // 2026-09-21 live finding: a CCE saw "No appointments are ready" here while Appointment
  // Scheduling showed "Pending Job Creation 1" for the exact same appointment, with
  // nothing anywhere explaining the mismatch (root cause: S/N/warranty/fault/symptom fully
  // captured, but the separate invoiceNumber gate/FR-05 was still unmet). Only fetched once
  // the eligible list has actually come back empty - the common case has results, so this
  // stays a no-op extra call for every normal page load rather than firing alongside
  // eligibleQuery every time.
  const blockedQuery = useQuery({
    queryKey: ['job-cards', 'blocked-appointments', debouncedQuery],
    queryFn: () => getBlockedAppointmentsForJobCard(debouncedQuery || undefined),
    enabled: eligibleQuery.data != null && eligibleQuery.data.length === 0,
  });

  if (selectedLabel != null) {
    return (
      <div className="flex items-center gap-2">
        <span className={`${inputClass} flex items-center`}>{selectedLabel}</span>
        {onClear && (
          <button type="button" className="text-xs text-slate-500 hover:text-slate-700 hover:underline" onClick={onClear}>
            Change
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        className={inputClass}
        value={queryInput}
        onChange={(e) => setQueryInput(e.target.value)}
        placeholder="Search by appointment #, customer name, or phone… (leave blank to see all)"
        data-testid="eligible-appointment-search-input"
      />
      <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white" data-testid="eligible-appointment-list">
        {eligibleQuery.isLoading ? (
          <p className="px-3 py-2 text-sm text-slate-400">Loading eligible appointments…</p>
        ) : eligibleQuery.error ? (
          <div className="p-3">
            <ErrorNotice error={eligibleQuery.error} />
          </div>
        ) : eligibleQuery.data && eligibleQuery.data.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {eligibleQuery.data.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span>
                    <span className="font-medium text-slate-900">{item.appointmentNumber}</span>
                    <span className="ml-2 text-slate-500">
                      {item.customerName} · {item.customerPhone}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {new Date(item.scheduledAt).toLocaleDateString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-3 py-2">
            <p className="text-sm text-slate-400">
              {debouncedQuery
                ? `No eligible appointments match "${debouncedQuery}".`
                : 'No appointments are ready for Job Card creation right now.'}
            </p>
            {blockedQuery.data && blockedQuery.data.length > 0 && (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2" data-testid="blocked-appointment-list">
                <p className="text-xs font-medium text-amber-800">
                  {blockedQuery.data.length} appointment{blockedQuery.data.length === 1 ? '' : 's'} captured but not job-card-ready yet:
                </p>
                <ul className="mt-1 space-y-1">
                  {blockedQuery.data.map((item) => (
                    <li key={item.id} className="text-xs text-amber-900">
                      <span className="font-medium">{item.appointmentNumber}</span>
                      <span className="text-amber-700"> ({item.customerName}) — {blockedJobCardReasonText(item.reason)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Job Type split (2026-09-22 request, Phase 10) - the Installation/Delivery Installation
// counterpart to EligibleAppointmentPicker above. Same "always browsable, typed query just
// narrows" shape, backed by GET /job-cards/eligible-activity-appointments instead (real
// precondition: the appointment's mobile Activity must already be FINISHED, not FR-05's
// invoice/S-N/fault-symptom gate) - so there's no "blocked appointments" companion list
// here, since that gate doesn't exist for this flow.
function EligibleActivityAppointmentPicker({
  onSelect,
  selectedLabel,
  onClear,
}: {
  onSelect: (item: EligibleActivityAppointmentForJobCard) => void;
  selectedLabel?: string | null;
  onClear?: () => void;
}) {
  const [queryInput, setQueryInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(queryInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [queryInput]);

  const eligibleQuery = useQuery({
    queryKey: ['job-cards', 'eligible-activity-appointments', debouncedQuery],
    queryFn: () => getEligibleActivityAppointmentsForJobCard(debouncedQuery || undefined),
  });

  if (selectedLabel != null) {
    return (
      <div className="flex items-center gap-2">
        <span className={`${inputClass} flex items-center`}>{selectedLabel}</span>
        {onClear && (
          <button type="button" className="text-xs text-slate-500 hover:text-slate-700 hover:underline" onClick={onClear}>
            Change
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        className={inputClass}
        value={queryInput}
        onChange={(e) => setQueryInput(e.target.value)}
        placeholder="Search by appointment #, customer name, or phone… (leave blank to see all)"
        data-testid="eligible-activity-appointment-search-input"
      />
      <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white" data-testid="eligible-activity-appointment-list">
        {eligibleQuery.isLoading ? (
          <p className="px-3 py-2 text-sm text-slate-400">Loading eligible appointments…</p>
        ) : eligibleQuery.error ? (
          <div className="p-3">
            <ErrorNotice error={eligibleQuery.error} />
          </div>
        ) : eligibleQuery.data && eligibleQuery.data.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {eligibleQuery.data.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span>
                    <span className="font-medium text-slate-900">{item.appointmentNumber}</span>
                    <span className="ml-2 text-slate-500">
                      {item.customerName} · {item.customerPhone}
                    </span>
                    <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                      {item.jobType.replaceAll('_', ' ')}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {new Date(item.scheduledAt).toLocaleDateString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-2 text-sm text-slate-400">
            {debouncedQuery
              ? `No eligible appointments match "${debouncedQuery}".`
              : "No Installation/Delivery Installation appointments are ready for Job Card creation right now - the technician's mobile Activity Finished action (or a CCE override) has to run first."}
          </p>
        )}
      </div>
    </div>
  );
}

// Job Type split (2026-09-22 request, Phase 10) - the new, separate creation popup for
// Installation/Delivery Installation appointments. Deliberately skips S/N validation,
// fault/symptom, and the FR-05 invoice gate entirely, per the locked spec: just the ERP
// reference number plus a repeatable Brand/Job Type/Quantity/Finished line-items grid.
// Mirrors EstimatesPage's CreateEstimateCard for the useFieldArray repeatable-row pattern.
function CreateActivityJobCardModal({
  open,
  onClose,
  appointmentId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  appointmentId: string;
  onCreated: () => void;
}) {
  const applianceModelsQuery = useQuery({
    queryKey: ['master-data', 'appliance-models', 'all'],
    queryFn: () => listApplianceModels(),
    enabled: open,
  });

  const { register, control, handleSubmit, reset } = useForm<{
    erpReferenceNumber: string;
    lineItems: ActivityJobCardLineItemInput[];
  }>({
    defaultValues: {
      erpReferenceNumber: '',
      lineItems: [{ applianceModelId: '', jobType: 'INSTALLATION', quantity: 1, finished: true }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lineItems' });

  const mutation = useMutation({
    mutationFn: (values: { erpReferenceNumber: string; lineItems: ActivityJobCardLineItemInput[] }) =>
      createActivityJobCard({
        appointmentId,
        erpReferenceNumber: values.erpReferenceNumber,
        lineItems: values.lineItems.map((li) => ({
          applianceModelId: li.applianceModelId,
          jobType: li.jobType,
          quantity: Number(li.quantity),
          finished: !!li.finished,
        })),
      }),
    onSuccess: () => {
      onCreated();
      reset();
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create Job Card - Installation / Delivery Installation"
      maxWidthClassName="max-w-2xl"
    >
      <p className="mb-3 text-xs text-slate-400">
        This ERP-sourced flow skips serial number validation, fault/symptom capture, and
        the invoice-number gate entirely - it just records the ERP reference number and the
        appliances actually installed or delivered, then marks the Job Card (and this
        appointment) complete straight away.
      </p>
      <ErrorNotice error={mutation.error} />
      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-3">
        <Field label="ERP Reference Number">
          <input
            className={inputClass}
            {...register('erpReferenceNumber', { required: true })}
            placeholder="e.g. ERP-2026-04512"
          />
        </Field>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Line items</p>
          {fields.map((field, index) => (
            <div key={field.id} className="flex items-end gap-2">
              <div className="flex-1">
                <Field label={index === 0 ? 'Brand / Model' : ''}>
                  <select className={inputClass} {...register(`lineItems.${index}.applianceModelId`, { required: true })}>
                    <option value="">Select…</option>
                    {applianceModelsQuery.data?.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.brand} — {m.model}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="w-44">
                <Field label={index === 0 ? 'Job Type' : ''}>
                  <select className={inputClass} {...register(`lineItems.${index}.jobType`, { required: true })}>
                    <option value="INSTALLATION">Installation</option>
                    <option value="DELIVERY_INSTALLATION">Delivery Installation</option>
                  </select>
                </Field>
              </div>
              <div className="w-20">
                <Field label={index === 0 ? 'Qty' : ''}>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    className={inputClass}
                    {...register(`lineItems.${index}.quantity`, { required: true, valueAsNumber: true, min: 1 })}
                  />
                </Field>
              </div>
              <label className="mb-2 flex items-center gap-1 text-xs text-slate-500">
                <input type="checkbox" {...register(`lineItems.${index}.finished`)} />
                Finished
              </label>
              <button
                type="button"
                onClick={() => remove(index)}
                disabled={fields.length === 1}
                className="mb-0.5 rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-30"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => append({ applianceModelId: '', jobType: 'INSTALLATION', quantity: 1, finished: true })}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            + Add line item
          </button>
        </div>

        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Create Job Card
        </button>
      </form>
    </Modal>
  );
}

export function JobCardsPage() {
  const [searchParams] = useSearchParams();
  const prefill = searchParams.get('appointmentId') ?? '';
  const [activeAppointmentId, setActiveAppointmentId] = useState(prefill);
  // Job Type split (Phase 10) - which eligible-appointment pool the picker below queries.
  // Only relevant while nothing is selected yet (selectedLabel == null) - once an
  // appointment is picked, its own jobType (not this toggle) decides which creation flow
  // renders below, so pasting a URL ?appointmentId= for either kind of appointment still
  // routes correctly regardless of which tab happens to be active.
  const [flow, setFlow] = useState<'repair' | 'activity'>('repair');
  const [showActivityModal, setShowActivityModal] = useState(false);
  // #218/#251: see QcPage's identical field for why this isn't derived via an effect.
  const [pickedLabel, setPickedLabel] = useState<string | null>(null);
  const queryClient = useQueryClient();
  // 2026-09-14: gated on the real capability (mirrors job-cards.controller.ts's
  // @RequiresCapability('JOB_CARD_WARRANTY_OVERRIDE')) rather than a hardcoded role list,
  // so a role granted this via Designation access sees the button too.
  const { has } = useMyCapabilities();
  const canWarrantyOverride = has('JOB_CARD_WARRANTY_OVERRIDE');
  // 2026-09-14 (Group B): validate-sn/assign-section/approve-customer/cancel were pure
  // status-derived booleans with no capability check at all - every button rendered for
  // every logged-in user regardless of role, and only 403'd on click (backend already
  // gates all four actions on @RequiresCapability('JOB_CARD_MANAGE')). This mirrors that.
  const canManage = has('JOB_CARD_MANAGE');

  const appointmentQuery = useQuery({
    queryKey: ['appointment', activeAppointmentId],
    queryFn: () => getAppointment(activeAppointmentId),
    enabled: !!activeAppointmentId,
    retry: false,
  });

  const jobCardQuery = useQuery({
    queryKey: ['job-card', 'by-appointment', activeAppointmentId],
    queryFn: () => getJobCardByAppointment(activeAppointmentId),
    enabled: !!activeAppointmentId,
    retry: false,
  });
  const jobCardNotFound = (jobCardQuery.error as AxiosError)?.response?.status === 404;

  function invalidateJobCard() {
    queryClient.invalidateQueries({ queryKey: ['job-card', 'by-appointment', activeAppointmentId] });
  }

  const createMutation = useMutation({
    mutationFn: () => createJobCard({ appointmentId: activeAppointmentId }),
    onSuccess: invalidateJobCard,
  });

  const selectedLabel = activeAppointmentId
    ? (pickedLabel ?? appointmentQuery.data?.appointmentNumber ?? activeAppointmentId)
    : null;

  // Job Type split (Phase 10) - decides the creation flow purely off the selected
  // appointment's own jobType (mirrors SchedulePage.tsx's identical inline check), not off
  // which picker tab found it - so a prefilled ?appointmentId= link (e.g. from the
  // Schedule page's own "+ Create Job" pill) always routes correctly too.
  const isActivityJobType =
    appointmentQuery.data?.jobType === 'INSTALLATION' || appointmentQuery.data?.jobType === 'DELIVERY_INSTALLATION';

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-8 py-8">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Job Cards</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          There's no "list all Job Cards" screen - the backend has no such endpoint, only
          look-up by appointment. But the picker below already shows every appointment
          that's ready for Job Card creation right now (invoice on file, plus S/N, warranty
          check, fault, and symptom all captured) - pick one directly, or type an
          appointment #, customer name, or phone to narrow it down.
        </p>
      </div>

      <div className="max-w-md space-y-2">
        {selectedLabel == null && (
          <div className="flex gap-1 text-xs" data-testid="job-card-flow-toggle">
            <button
              type="button"
              onClick={() => setFlow('repair')}
              className={`rounded-md px-2 py-1 font-medium ${flow === 'repair' ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              Repair
            </button>
            <button
              type="button"
              onClick={() => setFlow('activity')}
              className={`rounded-md px-2 py-1 font-medium ${flow === 'activity' ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              Installation / Delivery
            </button>
          </div>
        )}
        <Field label="Appointment">
          {flow === 'repair' ? (
            <EligibleAppointmentPicker
              selectedLabel={selectedLabel}
              onSelect={(item) => {
                setPickedLabel(`${item.appointmentNumber} — ${item.customerName}`);
                setActiveAppointmentId(item.id);
              }}
              onClear={() => {
                setPickedLabel(null);
                setActiveAppointmentId('');
              }}
            />
          ) : (
            <EligibleActivityAppointmentPicker
              selectedLabel={selectedLabel}
              onSelect={(item) => {
                setPickedLabel(`${item.appointmentNumber} — ${item.customerName}`);
                setActiveAppointmentId(item.id);
              }}
              onClear={() => {
                setPickedLabel(null);
                setActiveAppointmentId('');
              }}
            />
          )}
        </Field>
      </div>

      {activeAppointmentId && (
        <div className="space-y-4">
          {appointmentQuery.isLoading && (
            <p className="text-sm text-slate-400">Looking up the appointment…</p>
          )}
          {appointmentQuery.error ? (
            <ErrorNotice error={appointmentQuery.error} />
          ) : appointmentQuery.data ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-medium text-slate-800">
                {appointmentQuery.data.appointmentNumber} · {appointmentQuery.data.customerName}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Appointment status: <StatusBadge status={appointmentQuery.data.status} />
              </p>
            </div>
          ) : null}

          {jobCardQuery.isLoading && <p className="text-sm text-slate-400">Looking up the Job Card…</p>}
          {jobCardQuery.error && !jobCardNotFound && <ErrorNotice error={jobCardQuery.error} />}

          {jobCardNotFound && isActivityJobType && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-600">
                No Job Card exists yet for this Installation/Delivery Installation
                appointment. This flow skips S/N validation, fault/symptom, and the invoice
                gate entirely - its own precondition is that the technician's mobile
                Activity Finished action (or a CCE's Mark Activity Complete override) has
                already run.
              </p>
              <button
                onClick={() => setShowActivityModal(true)}
                className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
              >
                Create Job Card
              </button>
              <CreateActivityJobCardModal
                open={showActivityModal}
                onClose={() => setShowActivityModal(false)}
                appointmentId={activeAppointmentId}
                onCreated={invalidateJobCard}
              />
            </div>
          )}

          {jobCardNotFound && !isActivityJobType && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-600">
                No Job Card exists yet for this appointment. Creating one requires the
                appointment to have an invoice number on file, plus a fully-captured serial
                number/warranty check/fault/symptom - either from a field technician's visit
                (on-site appointments), or from the workshop intake screen's Mark Received
                flow (for a collected-to-workshop appointment, via Schedule → Mark
                Received →) - the backend blocks creation otherwise (FR-05).
              </p>
              <ErrorNotice error={createMutation.error} />
              <button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
                className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Create Job Card
              </button>
            </div>
          )}

          {jobCardQuery.data && (
            <JobCardDetail
              jobCard={jobCardQuery.data}
              canWarrantyOverride={canWarrantyOverride}
              canManage={canManage}
              onChanged={invalidateJobCard}
            />
          )}
        </div>
      )}
    </div>
  );
}

function JobCardDetail({
  jobCard,
  canWarrantyOverride,
  canManage,
  onChanged,
}: {
  jobCard: JobCard;
  canWarrantyOverride: boolean;
  canManage: boolean;
  onChanged: () => void;
}) {
  const validateSnMutation = useMutation({
    mutationFn: (matches: boolean) => validateSn(jobCard.id, { matches }),
    onSuccess: onChanged,
  });
  const approveCustomerMutation = useMutation({
    mutationFn: (notes: string) => approveCustomer(jobCard.id, { notes: notes || undefined }),
    onSuccess: onChanged,
  });
  const assignSectionMutation = useMutation({
    mutationFn: (section: JobCardSectionValue) => assignSection(jobCard.id, { section }),
    onSuccess: onChanged,
  });
  const overrideMutation = useMutation({
    mutationFn: (input: { newStatus: 'IW' | 'OOW'; reason: string }) => warrantyOverride(jobCard.id, input),
    onSuccess: onChanged,
  });
  const cancelMutation = useMutation({
    mutationFn: (reason: string) => cancelJobCard(jobCard.id, { reason }),
    onSuccess: onChanged,
  });

  const canValidateSn = canManage && jobCard.status === 'OPEN';
  const canAssignSection = canManage && jobCard.status === 'SN_VALIDATED';
  const canApproveCustomer = canManage && jobCard.warrantyStatus === 'OOW' && jobCard.status !== 'CANCELLED';
  const blockedByCustomerApproval = jobCard.warrantyStatus === 'OOW' && !jobCard.customerApproved;
  // Job Type split (Phase 10) - excluded for COMPLETED too: an ERP-sourced job card has no
  // warrantyStatus to override (backend's warrantyOverride() rejects COMPLETED outright).
  const canOverride =
    canWarrantyOverride && jobCard.status !== 'RWR' && jobCard.status !== 'CANCELLED' && jobCard.status !== 'COMPLETED';
  const canCancel =
    canManage && !['CANCELLED', 'READY_FOR_QC', 'QC_PASSED', 'DELIVERED', 'COMPLETED'].includes(jobCard.status);
  const pastThisPhase = TERMINAL_FOR_THIS_PHASE.includes(jobCard.status);
  const showWorkshopLink =
    WORKSHOP_LINKED_STATUSES.includes(jobCard.status) ||
    (jobCard.status === 'SECTION_ASSIGNED' && jobCard.section === 'WORKSHOP');

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-slate-900">{jobCard.jobCardNumber}</p>
          <p className="text-xs text-slate-400">
            {jobCard.status === 'COMPLETED'
              ? `ERP Ref ${jobCard.erpReferenceNumber ?? '—'}`
              : `${jobCard.brand ?? 'Unknown brand'} · S/N ${jobCard.serialNumber ?? '—'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/job-cards/journey?jobCardId=${jobCard.id}`}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Journey →
          </Link>
          {jobCard.lane && <LaneBadge lane={jobCard.lane} />}
          <StatusBadge status={jobCard.status} />
        </div>
      </div>

      {jobCard.nextStepText && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="font-medium text-slate-700">Next: </span>
          {jobCard.nextStepText}
        </p>
      )}

      <JobCardProgressStepper jobCard={jobCard} />

      {jobCard.status === 'COMPLETED' ? (
        // Job Type split (Phase 10) - none of the REPAIR flow's S/N/fault/symptom/warranty
        // fields apply to an ERP-sourced Job Card (they're all null - see the JobCard
        // entity's own doc comment), so this replaces that grid entirely rather than
        // rendering it with a run of "—"s.
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <DetailRow label="ERP Reference Number">{jobCard.erpReferenceNumber ?? '—'}</DetailRow>
          <DetailRow label="Line items">
            {jobCard.activityLineItems && jobCard.activityLineItems.length > 0 ? (
              <ul className="space-y-1">
                {jobCard.activityLineItems.map((li) => (
                  <li key={li.id}>
                    {li.applianceModel ? `${li.applianceModel.brand} — ${li.applianceModel.model}` : li.applianceModelId}
                    <span className="ml-1 text-xs text-slate-400">
                      ({li.jobType.replaceAll('_', ' ')} · qty {li.quantity} ·{' '}
                      {li.finished ? 'finished' : 'not finished'})
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              '—'
            )}
          </DetailRow>
          {jobCard.cancellationReason && (
            <DetailRow label="Cancellation reason">{jobCard.cancellationReason}</DetailRow>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <DetailRow label="Section">{jobCard.section?.replaceAll('_', ' ') ?? '—'}</DetailRow>
          <DetailRow label="Fault / symptom">{jobCard.faultCode} / {jobCard.symptomCode}</DetailRow>
          <DetailRow label="Warranty status">
            {jobCard.warrantyStatus ? <StatusBadge status={jobCard.warrantyStatus} /> : '—'}
            {jobCard.warrantyOverridden && jobCard.originalWarrantyStatus && (
              <span className="ml-2 text-xs text-slate-400">
                overridden from <StatusBadge status={jobCard.originalWarrantyStatus} /> ({jobCard.overrideCount}x)
              </span>
            )}
          </DetailRow>
          <DetailRow label="S/N validated against invoice">
            {jobCard.snValidatedAgainstInvoice ? 'Yes' : 'Not yet'}
          </DetailRow>
          <DetailRow label="Customer approved (OOW)">{jobCard.customerApproved ? 'Yes' : 'Not yet'}</DetailRow>
          {jobCard.cancellationReason && (
            <DetailRow label="Cancellation reason">{jobCard.cancellationReason}</DetailRow>
          )}
        </div>
      )}

      {jobCard.publicToken && (
        <ActionCard title="Customer tracking link">
          <p className="mb-2 text-xs text-slate-400">
            Minted automatically when this Job Card was created (valid 180 days) - the customer
            can use it to check status, see what's owed on an out-of-warranty repair, and
            download a summary. No login required.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={`${window.location.origin}/track/${jobCard.publicToken}`}
              className={`${inputClass} font-mono text-xs`}
            />
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/track/${jobCard.publicToken}`)}
              className="shrink-0 rounded-md border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Copy
            </button>
          </div>
        </ActionCard>
      )}

      {pastThisPhase && (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
          This job has moved past what this phase's screens cover ({jobCard.status.replaceAll('_', ' ')}) -
          QC and Delivery each get their own screens in later phases.
        </p>
      )}

      {showWorkshopLink && (
        <p className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
          This is a Workshop job -{' '}
          <Link to={`/workshop?jobCardId=${jobCard.id}`} className="font-medium underline">
            go to the Workshop screen →
          </Link>{' '}
          to assign a technician, track WIP, and request spares.
        </p>
      )}

      <TaskPauseCard jobCard={jobCard} />

      {canValidateSn && (
        <ActionCard title="Step 1 · Validate serial number against the physical invoice">
          <ErrorNotice error={validateSnMutation.error} />
          <div className="flex gap-2">
            <button
              onClick={() => validateSnMutation.mutate(true)}
              disabled={validateSnMutation.isPending}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Matches
            </button>
            <button
              onClick={() => validateSnMutation.mutate(false)}
              disabled={validateSnMutation.isPending}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Doesn't match
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            A mismatch stays OPEN (no status change) rather than blocking outright - the
            backend only advances to SN_VALIDATED when this is confirmed as a match.
          </p>
        </ActionCard>
      )}

      {canApproveCustomer && (
        <ApproveCustomerCard jobCard={jobCard} mutation={approveCustomerMutation} />
      )}

      {canAssignSection && (
        <ActionCard title="Step 2 · Assign section - the point work actually starts">
          <ErrorNotice error={assignSectionMutation.error} />
          {blockedByCustomerApproval && (
            <p className="mb-2 text-xs text-amber-700">
              This is an out-of-warranty job with no customer approval on file yet - the
              backend will reject a section assignment until "Record customer approval"
              above is done (FR-06).
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => assignSectionMutation.mutate('ON_SITE_REPAIR')}
              disabled={assignSectionMutation.isPending || blockedByCustomerApproval}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              On-site repair
            </button>
            <button
              onClick={() => assignSectionMutation.mutate('WORKSHOP')}
              disabled={assignSectionMutation.isPending || blockedByCustomerApproval}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Workshop
            </button>
          </div>
        </ActionCard>
      )}

      {canOverride && <WarrantyOverrideCard jobCard={jobCard} mutation={overrideMutation} />}

      {canCancel && <CancelCard mutation={cancelMutation} />}
    </div>
  );
}

// Task timer pause/resume. "Currently paused" is never a stored flag - it's derived
// client-side by finding the pause row (if any) with resumedAt === null, mirroring how
// the backend itself derives it (JobCardsService's "computed, never stored" pattern).
// Returns null (renders nothing) once the job's status is past every pausable status AND
// it never had any pause history worth showing - most jobs never touch this feature.
function TaskPauseCard({ jobCard }: { jobCard: JobCard }) {
  const queryClient = useQueryClient();
  const pausesQueryKey = ['job-card', jobCard.id, 'pauses'];
  const pausesQuery = useQuery({
    queryKey: pausesQueryKey,
    queryFn: () => getTaskPauses(jobCard.id),
  });
  const invalidatePauses = () => queryClient.invalidateQueries({ queryKey: pausesQueryKey });

  const pauseMutation = useMutation({
    mutationFn: (input: { reason: TaskPauseReasonValue; notes: string }) =>
      pauseTask(jobCard.id, { reason: input.reason, notes: input.notes || undefined }),
    onSuccess: invalidatePauses,
  });
  const resumeMutation = useMutation({
    mutationFn: () => resumeTask(jobCard.id),
    onSuccess: invalidatePauses,
  });

  const { register, handleSubmit, reset } = useForm<{ reason: TaskPauseReasonValue; notes: string }>({
    defaultValues: { reason: 'MATERIAL_SHORTAGE', notes: '' },
  });

  const pauses = pausesQuery.data ?? [];
  const openPause = pauses.find((p) => p.resumedAt === null);
  const isPausableStatus = PAUSABLE_STATUSES.includes(jobCard.status);
  const canPause = isPausableStatus && !openPause;
  const canResume = !!openPause;

  if (!isPausableStatus && pauses.length === 0) {
    return null;
  }

  return (
    <ActionCard title="Task timer">
      {openPause && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-medium">Paused</span> — {TASK_PAUSE_REASON_LABELS[openPause.reason]}
          {openPause.autoCreated && ' (opened automatically - a spare part request came back short of stock)'}
          {openPause.notes && ` — "${openPause.notes}"`}
          <span className="ml-1 text-amber-600">since {new Date(openPause.pausedAt).toLocaleString()}</span>
        </div>
      )}

      <ErrorNotice error={pauseMutation.error ?? resumeMutation.error} />

      {canResume && (
        <button
          onClick={() => resumeMutation.mutate()}
          disabled={resumeMutation.isPending}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Resume
        </button>
      )}

      {canPause && (
        <form
          onSubmit={handleSubmit((values) => {
            pauseMutation.mutate(values, { onSuccess: () => reset({ reason: 'MATERIAL_SHORTAGE', notes: '' }) });
          })}
          className="space-y-2"
        >
          <Field label="Pause reason">
            <select className={inputClass} {...register('reason')}>
              {TASK_PAUSE_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {TASK_PAUSE_REASON_LABELS[reason]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes (optional)">
            <input className={inputClass} {...register('notes')} placeholder="e.g. which part, or why the customer is unavailable" />
          </Field>
          <button
            type="submit"
            disabled={pauseMutation.isPending}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Pause
          </button>
        </form>
      )}

      {pauses.length > 0 && (
        <details className="mt-3 text-xs text-slate-500">
          <summary className="cursor-pointer font-medium text-slate-600">Pause history ({pauses.length})</summary>
          <ul className="mt-2 space-y-1">
            {pauses.map((p) => (
              <li key={p.id}>
                {TASK_PAUSE_REASON_LABELS[p.reason]}
                {p.autoCreated ? ' (auto)' : ''} — {new Date(p.pausedAt).toLocaleString()}
                {p.resumedAt ? ` → ${new Date(p.resumedAt).toLocaleString()}` : ' (still open)'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </ActionCard>
  );
}

function ApproveCustomerCard({
  jobCard,
  mutation,
}: {
  jobCard: JobCard;
  mutation: UseMutationResult<JobCard, unknown, string>;
}) {
  const { register, handleSubmit, reset } = useForm<{ notes: string }>({ defaultValues: { notes: '' } });
  return (
    <ActionCard title="Record customer approval (out-of-warranty jobs)">
      <p className="mb-2 text-xs text-slate-400">
        Manual flag - sets the same flag an approved Estimate sets, but with no line
        items, no VAT, and no audit trail of what the customer actually agreed to.{' '}
        <Link to={`/estimates?jobCardId=${jobCard.id}`} className="font-medium text-slate-600 underline">
          Use the Estimate flow →
        </Link>{' '}
        instead when there's a real quote to send. Currently:{' '}
        {jobCard.customerApproved ? 'approved' : 'not yet approved'}
        {jobCard.customerApprovalNotes ? ` — "${jobCard.customerApprovalNotes}"` : ''}.
      </p>
      <ErrorNotice error={mutation.error} />
      <form
        onSubmit={handleSubmit((values) => {
          mutation.mutate(values.notes, { onSuccess: () => reset() });
        })}
        className="flex items-end gap-2"
      >
        <div className="flex-1">
          <Field label="Notes (optional)">
            <input className={inputClass} {...register('notes')} placeholder="How approval was obtained" />
          </Field>
        </div>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {jobCard.customerApproved ? 'Update' : 'Approve'}
        </button>
      </form>
    </ActionCard>
  );
}

function WarrantyOverrideCard({
  jobCard,
  mutation,
}: {
  jobCard: JobCard;
  mutation: UseMutationResult<JobCard, unknown, { newStatus: 'IW' | 'OOW'; reason: string }>;
}) {
  const otherStatus = jobCard.warrantyStatus === 'IW' ? 'OOW' : 'IW';
  const { register, handleSubmit, reset } = useForm<{ reason: string }>({ defaultValues: { reason: '' } });
  return (
    <ActionCard title="Warranty Override (FR-17/AC-18 · Technical Team Leader or above)">
      <ErrorNotice error={mutation.error} />
      <form
        onSubmit={handleSubmit((values) => {
          mutation.mutate({ newStatus: otherStatus, reason: values.reason }, { onSuccess: () => reset() });
        })}
        className="space-y-2"
      >
        <Field label={`Reason for overriding to ${otherStatus === 'IW' ? 'In Warranty' : 'Out of Warranty'}`} hint="Minimum 5 characters - written to the audit trail.">
          <textarea className={inputClass} rows={2} {...register('reason', { required: true, minLength: 5 })} />
        </Field>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >
          Override to {otherStatus === 'IW' ? 'In Warranty' : 'Out of Warranty'}
        </button>
      </form>
    </ActionCard>
  );
}

function CancelCard({ mutation }: { mutation: UseMutationResult<JobCard, unknown, string> }) {
  const { register, handleSubmit, reset } = useForm<{ reason: string }>({ defaultValues: { reason: '' } });
  return (
    <ActionCard title="Cancel this Job Card">
      <ErrorNotice error={mutation.error} />
      <form
        onSubmit={handleSubmit((values) => {
          mutation.mutate(values.reason, { onSuccess: () => reset() });
        })}
        className="space-y-2"
      >
        <Field label="Reason" hint="Minimum 3 characters.">
          <textarea className={inputClass} rows={2} {...register('reason', { required: true, minLength: 3 })} />
        </Field>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          Cancel Job Card
        </button>
      </form>
    </ActionCard>
  );
}

function ActionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-slate-100 pt-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">{title}</p>
      {children}
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
