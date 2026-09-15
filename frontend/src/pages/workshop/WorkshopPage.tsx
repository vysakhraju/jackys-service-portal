import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { ErrorNotice } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { StockLookupPanel } from '../../components/StockLookupPanel';
import { NamePicker } from '../../components/pickers/NamePicker';
import { AsyncSearchPicker } from '../../components/pickers/AsyncSearchPicker';
import { useAuth } from '../../lib/auth';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { useTechnicianOptions } from '../../lib/useTechnicianOptions';
import { useWorkshopJobCardSelection } from './WorkshopInventoryContext';
import {
  assignWorkshopTechnician,
  completeWorkshop,
  getWorkshopState,
  listReworkApprovers,
  requestSpare,
  startWip,
} from '../../lib/workshopApi';
import { requestReturn, reviewReservation } from '../../lib/inventoryApi';
import { listSpareParts } from '../../lib/masterDataApi';
import type { WorkshopState } from '../../lib/workshopTypes';
import type { InventoryReservation, InventoryReservationWithAge } from '../../lib/inventoryTypes';
import { searchJobCardJourney } from '../../lib/jobCardJourneyApi';
import type { JourneySearchResult } from '../../lib/jobCardJourneyTypes';

function renderJobCardOption(item: JourneySearchResult) {
  return (
    <div>
      <div className="font-medium text-slate-900">{item.jobCardNumber}</div>
      <div className="text-xs text-slate-500">
        {item.customerName} · {item.appointmentNumber} · {item.jobCardStatus.replace(/_/g, ' ')}
      </div>
    </div>
  );
}

// TL+ roles that can act on ANY workshop job, mirroring WorkshopController's own
// ownership-bypass roles. Still a hardcoded role array for the TL+ part (same "checked in
// code, not admin-editable" reasoning as Job Cards' TASK_PAUSE_PRIVILEGED_ROLES) - but
// Modification Request 2026-09-16 closed the gap this comment used to flag: a caller who
// holds the WORKSHOP_ACTION_ANY_JOB capability (e.g. a CCE granted it via Designation
// access) now also bypasses ownership, mirroring workshop-ownership.util.ts exactly. This
// is a UI hint only - the backend (bypassesWorkshopOwnership()) is what actually enforces it.
const PRIVILEGED_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER'];

function useIsPrivilegedWorkshopCaller(): boolean {
  const { user } = useAuth();
  const { has } = useMyCapabilities();
  return (!!user && PRIVILEGED_ROLES.includes(user.role.name)) || has('WORKSHOP_ACTION_ANY_JOB');
}

export function WorkshopPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const prefill = searchParams.get('jobCardId') ?? '';
  // 2026-09-14 live-tested finding, round 2: a first attempt at this fix had activeJobCardId
  // as page-local state, seeded from ?jobCardId= once and echoed back into the url on every
  // pick - that survives a page refresh, but NOT the actual reported bug: switching to the
  // Inventory & Stock or Need Spare Requests tab and back. Those 3 tabs are sibling ROUTES
  // under WorkshopInventoryLayout's one <Outlet />, and the "Workshop" tab's <NavLink> target
  // is a fixed path carrying no query string - so switching back navigates to a bare
  // /workshop-inventory/workshop and this page remounts with page-local state reset to
  // nothing, no matter what the url held a moment before. The fix: the selection now lives
  // in WorkshopInventoryContext, provided by the layout itself (which never unmounts across
  // its child routes) - see that file's doc comment.
  const { selection, setSelection } = useWorkshopJobCardSelection();
  const activeJobCardId = selection.id;
  const queryClient = useQueryClient();

  // Guards the reconciliation effect below against a real render race: setSearchParams()
  // can take one extra render to actually change what useSearchParams() returns, one
  // render behind a plain useState update made in the SAME event handler (onSelect/
  // onClear below, and the effect's own "restore" branch). Without this, the effect would
  // see a `prefill` that hasn't caught up yet, treat it as a genuinely different value, and
  // fight its own just-made change - live-tested: clicking "Change" cleared `selection` but
  // then immediately un-cleared it because `prefill` was still momentarily the old id.
  // Holds the id we're waiting for `prefill` to catch up to; null once settled.
  const pendingUrlIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (pendingUrlIdRef.current !== null) {
      if (prefill === pendingUrlIdRef.current) {
        pendingUrlIdRef.current = null;
      }
      return;
    }
    if (prefill && prefill !== selection.id) {
      // A fresh deep link (initial page load, or a "Go to Workshop ->" link for a
      // DIFFERENT job while this one was already open) - adopt it into the shared
      // selection. Never fires on a bare tab-switch-back navigation (no ?jobCardId= in the
      // url at all), so the previously-loaded job in context survives that case untouched.
      setSelection({ id: prefill, label: null });
    } else if (!prefill && selection.id) {
      // Landed back on the tab's bare path (exactly what the NavLink does) but the shared
      // context still has a job loaded - restore it into this page's own url too, so a
      // browser refresh right after switching tabs back also still works, not just the
      // in-session switch itself.
      pendingUrlIdRef.current = selection.id;
      setSearchParams({ jobCardId: selection.id }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, selection.id]);

  const stateQuery = useQuery({
    queryKey: ['workshop-state', activeJobCardId],
    queryFn: () => getWorkshopState(activeJobCardId),
    enabled: !!activeJobCardId,
    retry: false,
  });

  function onChanged() {
    queryClient.invalidateQueries({ queryKey: ['workshop-state', activeJobCardId] });
  }

  const selectedLabel = activeJobCardId ? (selection.label ?? stateQuery.data?.jobCard.jobCardNumber ?? activeJobCardId) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-8 py-8">
      <p className="max-w-2xl text-sm text-slate-500">
        Same "no list-all queue" pattern as Job Cards and Estimates. Search by job card #,
        appointment #, customer name or phone (or use "Go to Workshop →" from its Job Cards
        page entry) to assign a technician, track WIP, and request spares.
      </p>

      <div className="max-w-sm">
        <Field label="Job Card">
          <AsyncSearchPicker<JourneySearchResult>
            search={searchJobCardJourney}
            onSelect={(item) => {
              pendingUrlIdRef.current = item.jobCardId;
              setSelection({ id: item.jobCardId, label: item.jobCardNumber });
              setSearchParams({ jobCardId: item.jobCardId });
            }}
            renderOption={renderJobCardOption}
            getOptionLabel={(item) => `${item.jobCardNumber} — ${item.customerName}`}
            placeholder="Search by job card #, appointment #, customer name or phone…"
            selectedLabel={selectedLabel}
            onClear={() => {
              pendingUrlIdRef.current = '';
              setSelection({ id: '', label: null });
              setSearchParams({});
            }}
          />
        </Field>
      </div>

      {activeJobCardId && (
        <div className="space-y-4">
          {stateQuery.isLoading && <p className="text-sm text-slate-400">Loading workshop state…</p>}
          {stateQuery.error && <ErrorNotice error={stateQuery.error} />}
          {stateQuery.data && <WorkshopDetail state={stateQuery.data} onChanged={onChanged} />}
        </div>
      )}
    </div>
  );
}

function WorkshopDetail({ state, onChanged }: { state: WorkshopState; onChanged: () => void }) {
  const { jobCard, staleReservations, activeReservations, assignedWorkshopTechnicianName } = state;
  const { user } = useAuth();
  const { has } = useMyCapabilities();
  const [stockLookupOpen, setStockLookupOpen] = useState(false);
  // Modification Request (2026-09-15): a quick "can I fulfil this?" stock check, without
  // leaving the job card open here - opens the same StockLookupPanel the Inventory & Stock
  // tab uses (see its own comment), in a Modal. Gated on INVENTORY_VIEW at the pill itself
  // (not just inside the panel) so a caller who can't look up stock doesn't see a button
  // that only opens a "you don't have access" notice.
  const canViewStock = has('INVENTORY_VIEW');
  const isPrivileged = useIsPrivilegedWorkshopCaller();
  // 2026-09-14: was ASSIGN_ROLES, a hardcoded mirror of WorkshopController's own
  // WORKSHOP_ASSIGN gate - now checks the real capability, so a Designation-access grant
  // actually shows this form instead of only ever working for the 3 hardcoded roles.
  const canAssign = has('WORKSHOP_ASSIGN');
  const isAssignedTechnician = !!user && user.id === jobCard.assignedWorkshopTechnicianId;
  // Ownership gate mirroring WorkshopService.assertOwnership() exactly (the-fool
  // pre-mortem finding #4) - a non-privileged caller who isn't the assigned technician
  // would get a raw 403 from every mutation below, so hide the actions instead.
  const canAct = isPrivileged || isAssignedTechnician;

  const notWorkshopSection = jobCard.section !== 'WORKSHOP';
  // READY_FOR_QC deliberately stays in-scope here (not "past this phase") - a READY_FOR_QC
  // job can still take a top-up spare request to resolve a shortfall QC approval is
  // blocked on (workshop.service.ts's own comment on requestSpare). Only QC_PASSED/
  // DELIVERED/CANCELLED/RWR and pre-workshop statuses are out of scope for this screen.
  const inWorkshopScope = [
    'SECTION_ASSIGNED',
    'WORKSHOP_ASSIGNED',
    'IN_PROGRESS',
    'SPARE_PENDING',
    'READY_FOR_QC',
  ].includes(jobCard.status);

  const assignMutation = useMutation({
    mutationFn: (technicianId: string) => assignWorkshopTechnician(jobCard.id, { technicianId }),
    onSuccess: onChanged,
  });
  const startWipMutation = useMutation({ mutationFn: () => startWip(jobCard.id), onSuccess: onChanged });
  const completeMutation = useMutation({ mutationFn: () => completeWorkshop(jobCard.id), onSuccess: onChanged });
  const requestSpareMutation = useMutation({
    mutationFn: (data: Parameters<typeof requestSpare>[1]) => requestSpare(jobCard.id, data),
    onSuccess: onChanged,
  });

  return (
    <>
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-slate-900">{jobCard.jobCardNumber}</p>
          <p className="text-xs text-slate-400">
            {jobCard.brand ?? 'Unknown brand'} · S/N {jobCard.serialNumber} · Section:{' '}
            {jobCard.section?.replaceAll('_', ' ') ?? '—'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canViewStock && (
            <button
              type="button"
              onClick={() => setStockLookupOpen(true)}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Inventory
            </button>
          )}
          <Link
            to={`/job-cards/journey?jobCardId=${jobCard.id}`}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Journey →
          </Link>
          <StatusBadge status={jobCard.status} />
        </div>
      </div>

      {notWorkshopSection && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          This job's section is {jobCard.section?.replaceAll('_', ' ') ?? 'unassigned'}, not Workshop - there's
          nothing to do here. Go to{' '}
          <Link to={`/job-cards?appointmentId=${jobCard.appointmentId}`} className="font-medium underline">
            Job Cards
          </Link>{' '}
          to change the section, if that's a mistake.
        </p>
      )}

      {!notWorkshopSection && !inWorkshopScope && (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
          This job is {jobCard.status.replaceAll('_', ' ')} - past what the Workshop screen covers
          {jobCard.status === 'QC_PASSED' ? (
            <>
              {' '}
              (Delivery gets its own screen in a later phase); see the{' '}
              <Link to={`/qc-permissions/qc?jobCardId=${jobCard.id}`} className="font-medium underline">
                QC screen
              </Link>{' '}
              for the approval that got it here
            </>
          ) : (
            ' (Delivery gets its own screen in a later phase), or not yet assigned a section'
          )}
          .
        </p>
      )}

      {!canAct && !notWorkshopSection && inWorkshopScope && jobCard.status !== 'SECTION_ASSIGNED' && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          You're not the technician assigned to this job ({assignedWorkshopTechnicianName ?? 'unassigned'})
          and don't hold a Team Leader+ role - the backend will reject any action below.
        </p>
      )}

      {!notWorkshopSection && jobCard.status === 'SECTION_ASSIGNED' && canAssign && (
        <AssignTechnicianCard mutation={assignMutation} />
      )}

      {!notWorkshopSection && jobCard.status === 'WORKSHOP_ASSIGNED' && canAct && (
        <ActionCard title="Start work-in-progress">
          <ErrorNotice error={startWipMutation.error} />
          <button
            onClick={() => startWipMutation.mutate()}
            disabled={startWipMutation.isPending}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Start WIP
          </button>
        </ActionCard>
      )}

      {!notWorkshopSection && ['IN_PROGRESS', 'SPARE_PENDING', 'READY_FOR_QC'].includes(jobCard.status) && canAct && (
        <>
          <RequestSpareCard jobCard={jobCard} mutation={requestSpareMutation} activeReservations={activeReservations} />
          <ActiveReservationsSection reservations={activeReservations} isPrivileged={isPrivileged} onChanged={onChanged} />
          {jobCard.status === 'IN_PROGRESS' && (
            <ActionCard title="Mark workshop work done">
              <ErrorNotice error={completeMutation.error} />
              <p className="mb-2 text-xs text-slate-400">
                Moves this job to READY_FOR_QC. Blocked while SPARE_PENDING - resolve or top
                up the outstanding spare request first.
              </p>
              <button
                onClick={() => completeMutation.mutate()}
                disabled={completeMutation.isPending}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Complete → Ready for QC
              </button>
            </ActionCard>
          )}
          {jobCard.status === 'SPARE_PENDING' && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Waiting on parts - the last spare request came back short of stock. Request a
              top-up above once more stock is available, or check the reservations below.
            </p>
          )}
          {jobCard.status === 'READY_FOR_QC' && (
            <p className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-700">
              Work is done and waiting on QC.{' '}
              <Link to={`/qc-permissions/qc?jobCardId=${jobCard.id}`} className="font-medium underline">
                Go to the QC screen →
              </Link>{' '}
              You can still request a top-up spare above if QC approval reports a stock
              shortfall.
            </p>
          )}
        </>
      )}

      <div className="border-t border-slate-100 pt-4">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
          Stale reservations on this job ({staleReservations.length})
        </p>
        <p className="mb-2 text-xs text-slate-400">
          Only reservations idle 24h+ (or whose custodian was deactivated) show up here - a
          fresh request shows in "Active reservations on this job" above instead.
        </p>
        {staleReservations.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing idle right now.</p>
        ) : (
          <div className="space-y-2">
            {staleReservations.map((r) => (
              <StaleReservationRow key={r.id} reservation={r} canReview={has('INVENTORY_REVIEW')} onChanged={onChanged} />
            ))}
          </div>
        )}
      </div>
    </div>
    {/* Outside the space-y-4 card on purpose - a fixed-position overlay inheriting a
        Tailwind space-y margin-top would render offset from the viewport edge. */}
    <Modal open={stockLookupOpen} onClose={() => setStockLookupOpen(false)} title="Stock lookup">
      <StockLookupPanel />
    </Modal>
    </>
  );
}

function AssignTechnicianCard({ mutation }: { mutation: UseMutationResult<unknown, unknown, string> }) {
  const { handleSubmit, reset, setValue, watch } = useForm<{ technicianId: string }>({ defaultValues: { technicianId: '' } });
  // #218: workshop technicians only - GET /technician-schedule/gantt is TECHNICIAN_SCHEDULE_
  // GANTT-gated (Team Leader), same floor as WORKSHOP_ASSIGN (who can even open this card),
  // so this resolves for the common case; falls back to the old raw-paste input for anyone
  // it still 403s for.
  const technicianOptions = useTechnicianOptions('TECHNICIAN_WORKSHOP');
  const technicianId = watch('technicianId');
  return (
    <ActionCard title="Assign a workshop technician">
      {!technicianOptions.accessible && (
        <p className="mb-2 text-xs text-slate-400">
          The technician name list needs Team Leader access - paste the technician's user
          id directly (same convention as Appointments). The backend rejects anyone whose
          role isn't a real workshop technician / TL+.
        </p>
      )}
      <ErrorNotice error={mutation.error} />
      <form
        onSubmit={handleSubmit((values) => mutation.mutate(values.technicianId, { onSuccess: () => reset() }))}
        className="flex items-end gap-2"
      >
        <div className="flex-1">
          <Field label="Technician">
            {technicianOptions.accessible ? (
              <NamePicker
                value={technicianId || null}
                options={technicianOptions.options}
                loading={technicianOptions.loading}
                onChange={(id) => setValue('technicianId', id ?? '')}
              />
            ) : (
              <input className={inputClass} value={technicianId} onChange={(e) => setValue('technicianId', e.target.value)} />
            )}
          </Field>
        </div>
        <button
          type="submit"
          disabled={mutation.isPending || !technicianId}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Assign
        </button>
      </form>
    </ActionCard>
  );
}

type RequestSpareFormValues = {
  sparePartId: string;
  quantity: number;
  approverId: string;
  verbalOverrideBy: string;
  verbalOverrideNotes: string;
};

function RequestSpareCard({
  jobCard,
  mutation,
  activeReservations,
}: {
  jobCard: WorkshopState['jobCard'];
  mutation: UseMutationResult<InventoryReservation, unknown, Parameters<typeof requestSpare>[1]>;
  activeReservations: InventoryReservation[];
}) {
  const sparePartsQuery = useQuery({
    queryKey: ['spare-parts', 'active'],
    queryFn: () => listSpareParts({ active: true }),
  });
  const { register, handleSubmit, reset, setValue, watch } = useForm<RequestSpareFormValues>({
    defaultValues: { sparePartId: '', quantity: 1, approverId: '', verbalOverrideBy: '', verbalOverrideNotes: '' },
  });
  // #218: WORKSHOP_ACTION-gated, same capability as request-spare itself, so this resolves
  // for every caller who can even reach this form - no raw-paste fallback needed.
  const reworkApproversQuery = useQuery({ queryKey: ['workshop', 'rework-approvers'], queryFn: listReworkApprovers });
  const reworkApproverOptions = reworkApproversQuery.data ?? [];
  const [justReserved, setJustReserved] = useState<InventoryReservation | null>(null);
  const { user } = useAuth();
  const isPrivileged = useIsPrivilegedWorkshopCaller();
  const canRequestReturnOnJustReserved = !!justReserved && (isPrivileged || user?.id === justReserved.custodianUserId);

  const returnMutation = useMutation({
    mutationFn: (id: string) => requestReturn(id),
    onSuccess: (r) => setJustReserved(r),
  });

  const hadPriorRejection = jobCard.qcRejectionCount > 0;

  // 2026-09-14 live-tested finding: nothing stopped a technician from re-requesting a
  // spare part that already has an outstanding (non-terminal) reservation on this exact
  // job card - easy to do by mistake, and each extra request holds/reserves more stock
  // against Main Store. This doesn't block it (a genuine second unit is a real need,
  // e.g. it broke again on refit) - it just makes them confirm before it goes through.
  // Checked against `activeReservations` (the same PENDING_REVIEW/HELD/PARTIALLY_RESERVED/
  // RETURN_PENDING list already fetched for the "Active reservations on this job" section
  // below), not a fresh query - it's already the right scope (this job card, still open).
  const [pendingDuplicateValues, setPendingDuplicateValues] = useState<RequestSpareFormValues | null>(null);

  function submitRequest(values: RequestSpareFormValues) {
    mutation.mutate(
      {
        sparePartId: values.sparePartId,
        quantity: Number(values.quantity),
        approverId: values.approverId || undefined,
        verbalOverrideBy: values.verbalOverrideBy || undefined,
        verbalOverrideNotes: values.verbalOverrideNotes || undefined,
      },
      {
        onSuccess: (r) => {
          setJustReserved(r);
          reset({ sparePartId: '', quantity: 1, approverId: '', verbalOverrideBy: '', verbalOverrideNotes: '' });
        },
      },
    );
  }

  function findDuplicateReservation(sparePartId: string) {
    return activeReservations.find((r) => r.sparePartId === sparePartId);
  }

  const duplicateReservation = pendingDuplicateValues ? findDuplicateReservation(pendingDuplicateValues.sparePartId) : undefined;

  return (
    <ActionCard title="Request a spare part (FR-09: reserves, does not deduct)">
      {hadPriorRejection && (
        <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-700">
          This job has been QC-rejected before ({jobCard.qcRejectionCount}x). If the part
          you're requesting was already reserved/consumed once on this job, the backend
          requires the rework sign-off fields below - otherwise leave them blank.
        </p>
      )}
      <ErrorNotice error={mutation.error} />
      <form
        onSubmit={handleSubmit((values) => {
          const duplicate = findDuplicateReservation(values.sparePartId);
          if (duplicate) {
            setPendingDuplicateValues(values);
          } else {
            submitRequest(values);
          }
        })}
        className="space-y-2"
      >
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="Spare part">
              <select className={inputClass} {...register('sparePartId', { required: true })}>
                <option value="">Select…</option>
                {(sparePartsQuery.data ?? []).map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.code} — {sp.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="w-20">
            <Field label="Qty">
              <input
                type="number"
                min="1"
                step="1"
                className={inputClass}
                {...register('quantity', { required: true, valueAsNumber: true, min: 1 })}
              />
            </Field>
          </div>
        </div>

        {hadPriorRejection && (
          <details className="rounded-md border border-slate-200 p-2">
            <summary className="cursor-pointer text-xs font-medium text-slate-600">
              Rework sign-off (only needed if this exact part was requested before on this job)
            </summary>
            <div className="mt-2 space-y-2">
              <Field
                label="Approver"
                hint="A different user (not you) holding the REWORK_APPROVAL grant. If none is available, use verbal override below instead."
              >
                <NamePicker
                  value={watch('approverId') || null}
                  options={reworkApproverOptions}
                  loading={reworkApproversQuery.isLoading}
                  onChange={(id) => setValue('approverId', id ?? '')}
                  emptyMessage="No one currently holds the rework-approval grant."
                />
              </Field>
              <Field label="Verbal override by" hint="Name/identifier of who gave verbal approval, if no approver id is at hand.">
                <input className={inputClass} {...register('verbalOverrideBy')} />
              </Field>
              <Field label="Verbal override notes" hint="Required alongside the above - min 5 characters.">
                <input className={inputClass} {...register('verbalOverrideNotes')} />
              </Field>
            </div>
          </details>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Request Spare
        </button>
      </form>

      {justReserved && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2.5 text-xs">
          <p className="font-medium text-slate-700">
            Reservation {justReserved.id.slice(0, 8)}… ·{' '}
            <StatusBadge status={justReserved.status} /> · {justReserved.quantityReserved}/
            {justReserved.quantityRequested} reserved
          </p>
          {justReserved.status === 'PARTIALLY_RESERVED' && (
            <p className="mt-1 text-amber-700">
              Short of stock - only {justReserved.quantityReserved} of {justReserved.quantityRequested} could be
              reserved. This job is now (or stays) SPARE_PENDING until a follow-up request fully fills it.
            </p>
          )}
          {justReserved.status === 'RETURN_PENDING' && (
            <p className="mt-1">Marked for return - an Inventory Clerk still needs to confirm it physically arrived back.</p>
          )}
          {['HELD', 'PARTIALLY_RESERVED'].includes(justReserved.status) && canRequestReturnOnJustReserved && (
            <button
              onClick={() => returnMutation.mutate(justReserved.id)}
              disabled={returnMutation.isPending}
              className="mt-2 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Not needed - request return
            </button>
          )}
          <ErrorNotice error={returnMutation.error} />
        </div>
      )}

      <Modal
        open={!!pendingDuplicateValues}
        onClose={() => setPendingDuplicateValues(null)}
        title="Request more of the same spare?"
      >
        <p className="text-sm text-slate-600">
          {duplicateReservation?.sparePart
            ? `${duplicateReservation.sparePart.code} — ${duplicateReservation.sparePart.name}`
            : 'This spare part'}{' '}
          already has an outstanding request on this job card ({duplicateReservation?.status.replaceAll('_', ' ')}
          {duplicateReservation ? `, ${duplicateReservation.quantityReserved} unit(s)` : ''}). Are you sure you need
          more quantity of the same spare?
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setPendingDuplicateValues(null)}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            No, cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (pendingDuplicateValues) submitRequest(pendingDuplicateValues);
              setPendingDuplicateValues(null);
            }}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Yes, request again
          </button>
        </div>
      </Modal>
    </ActionCard>
  );
}

/**
 * 2026-09-14 live-tested finding: RequestSpareCard's `justReserved` banner above is
 * ephemeral component state - it's gone the instant this screen remounts (switch to
 * Inventory & Stock and back, or just refresh), even though the reservation itself is
 * still sitting there exactly as HELD/PARTIALLY_RESERVED in the database. This section is
 * the persistent fix: it renders straight from `WorkshopState.activeReservations` (fetched
 * fresh on every `getWorkshopState` call, same as jobCard/staleReservations), so it's
 * always there regardless of whether this page was just loaded or has been open all day.
 * A reservation moves out of this list only once InventoryService.
 * getActiveReservationsForJobCard's terminal-status filter excludes it (RETURNED/
 * CONSUMED/REJECTED) - see that method's own doc comment.
 */
function ActiveReservationsSection({
  reservations,
  isPrivileged,
  onChanged,
}: {
  reservations: InventoryReservation[];
  isPrivileged: boolean;
  onChanged: () => void;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
        Active reservations on this job ({reservations.length})
      </p>
      {reservations.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing currently reserved for this job.</p>
      ) : (
        <div className="space-y-2">
          {reservations.map((r) => (
            <ActiveReservationRow key={r.id} reservation={r} isPrivileged={isPrivileged} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActiveReservationRow({
  reservation,
  isPrivileged,
  onChanged,
}: {
  reservation: InventoryReservation;
  isPrivileged: boolean;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const canRequestReturn = isPrivileged || user?.id === reservation.custodianUserId;
  const returnMutation = useMutation({
    mutationFn: (id: string) => requestReturn(id),
    onSuccess: onChanged,
  });

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5 text-xs">
      <div className="flex items-center justify-between">
        <p className="font-medium text-slate-700">
          {reservation.sparePart ? `${reservation.sparePart.code} — ${reservation.sparePart.name}` : 'Spare part'} ·{' '}
          {reservation.quantityReserved}/{reservation.quantityRequested} reserved
        </p>
        <StatusBadge status={reservation.status} />
      </div>
      <p className="mt-0.5 text-slate-400">Reservation id: {reservation.id}</p>
      {reservation.status === 'PARTIALLY_RESERVED' && (
        <p className="mt-1 text-amber-700">
          Short of stock - only {reservation.quantityReserved} of {reservation.quantityRequested} could be
          reserved. Request a top-up above once more stock is available.
        </p>
      )}
      {reservation.status === 'RETURN_PENDING' && (
        <p className="mt-1">Marked for return - an Inventory Clerk still needs to confirm it physically arrived back.</p>
      )}
      {['HELD', 'PARTIALLY_RESERVED'].includes(reservation.status) && canRequestReturn && (
        <>
          <button
            onClick={() => returnMutation.mutate(reservation.id)}
            disabled={returnMutation.isPending}
            className="mt-2 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Not needed - request return
          </button>
          <ErrorNotice error={returnMutation.error} />
        </>
      )}
    </div>
  );
}

function StaleReservationRow({
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
  const { has } = useMyCapabilities();
  // 2026-09-14: was RETURN_CONFIRM_ROLES, a hardcoded mirror of INVENTORY_STAFF - purely
  // informational here (which message to show), but should reflect the same real
  // capability as the Inventory page's own gate.
  const canConfirmReturn = has('INVENTORY_STAFF');

  return (
    <div className="rounded-md border border-slate-200 bg-white p-2.5 text-xs">
      <div className="flex items-center justify-between">
        <p className="font-medium text-slate-700">
          {reservation.quantityReserved} unit(s) · held {reservation.ageHours.toFixed(0)}h
          {!reservation.custodianActive && <span className="ml-1 text-red-600">· custodian inactive</span>}
        </p>
        <StatusBadge status={reservation.status} />
      </div>
      <p className="mt-0.5 text-slate-400">Reservation id: {reservation.id}</p>
      {canReview && !reviewed && (
        <div className="mt-2 flex gap-2">
          <ErrorNotice error={reviewMutation.error} />
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
      {reviewed && reviewed.status === 'RETURN_PENDING' && (
        <p className="mt-2 rounded bg-slate-50 px-2 py-1 text-slate-600">
          Approved - now RETURN_PENDING. {canConfirmReturn ? 'Confirm the physical return on the Inventory tab.' : 'An Inventory Clerk still needs to confirm it physically arrived back.'}
        </p>
      )}
      {reviewed && reviewed.status !== 'RETURN_PENDING' && (
        <p className="mt-2 rounded bg-slate-50 px-2 py-1 text-slate-600">Rejected - will resurface again after 24h if still untouched.</p>
      )}
    </div>
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
