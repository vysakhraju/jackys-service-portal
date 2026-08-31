import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { ErrorNotice } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../lib/auth';
import {
  assignWorkshopTechnician,
  completeWorkshop,
  getWorkshopState,
  requestSpare,
  startWip,
} from '../../lib/workshopApi';
import { requestReturn, reviewReservation } from '../../lib/inventoryApi';
import { listSpareParts } from '../../lib/masterDataApi';
import type { WorkshopState } from '../../lib/workshopTypes';
import type { InventoryReservation, InventoryReservationWithAge } from '../../lib/inventoryTypes';

// TL+ roles that can act on ANY workshop job, mirroring WorkshopController's
// ASSIGN_ROLES/PRIVILEGED_ROLES exactly. A plain TECHNICIAN_WORKSHOP is only ever allowed
// to act on the job they're assigned to (WorkshopService.assertOwnership) - the-fool
// pre-mortem finding #4.
const PRIVILEGED_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER'];
const ASSIGN_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER'];
// Reservation review is TL+ only - same set as PRIVILEGED_ROLES above, so WorkshopDetail
// passes isPrivileged straight through as canReview rather than duplicating the list.
const RETURN_CONFIRM_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'WAREHOUSE_CLERK'];

export function WorkshopPage() {
  const [searchParams] = useSearchParams();
  const prefill = searchParams.get('jobCardId') ?? '';
  const [jobCardIdInput, setJobCardIdInput] = useState(prefill);
  const [activeJobCardId, setActiveJobCardId] = useState(prefill);
  const queryClient = useQueryClient();

  const stateQuery = useQuery({
    queryKey: ['workshop-state', activeJobCardId],
    queryFn: () => getWorkshopState(activeJobCardId),
    enabled: !!activeJobCardId,
    retry: false,
  });

  function onChanged() {
    queryClient.invalidateQueries({ queryKey: ['workshop-state', activeJobCardId] });
  }

  return (
    <div className="max-w-3xl space-y-6">
      <p className="max-w-2xl text-sm text-slate-500">
        Same "no list-all, paste the id" pattern as Job Cards and Estimates - there's no
        workshop queue endpoint. Paste the Job Card's id (or use "Go to Workshop →" from
        its Job Cards page entry) to assign a technician, track WIP, and request spares.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setActiveJobCardId(jobCardIdInput.trim());
        }}
        className="flex items-end gap-2"
      >
        <div className="flex-1">
          <Field label="Job Card ID">
            <input
              className={inputClass}
              value={jobCardIdInput}
              onChange={(e) => setJobCardIdInput(e.target.value)}
              placeholder="Paste the job card's id"
            />
          </Field>
        </div>
        <button
          type="submit"
          disabled={!jobCardIdInput.trim()}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Find
        </button>
      </form>

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
  const { jobCard, staleReservations } = state;
  const { user } = useAuth();
  const isPrivileged = !!user && PRIVILEGED_ROLES.includes(user.role.name);
  const canAssign = !!user && ASSIGN_ROLES.includes(user.role.name);
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
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-slate-900">{jobCard.jobCardNumber}</p>
          <p className="text-xs text-slate-400">
            {jobCard.brand ?? 'Unknown brand'} · S/N {jobCard.serialNumber} · Section:{' '}
            {jobCard.section?.replaceAll('_', ' ') ?? '—'}
          </p>
        </div>
        <StatusBadge status={jobCard.status} />
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
          You're not the technician assigned to this job ({jobCard.assignedWorkshopTechnicianId ?? 'unassigned'})
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
          <RequestSpareCard jobCard={jobCard} mutation={requestSpareMutation} />
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
          Only reservations idle 24h+ (or whose custodian was deactivated) show up here -
          the backend has no "list every reservation for this job" endpoint, so a spare
          request from a few minutes ago that came back short won't appear until it goes
          stale. See the request result above for anything just requested.
        </p>
        {staleReservations.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing idle right now.</p>
        ) : (
          <div className="space-y-2">
            {staleReservations.map((r) => (
              <StaleReservationRow key={r.id} reservation={r} canReview={isPrivileged} onChanged={onChanged} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AssignTechnicianCard({ mutation }: { mutation: UseMutationResult<unknown, unknown, string> }) {
  const { register, handleSubmit, reset } = useForm<{ technicianId: string }>({ defaultValues: { technicianId: '' } });
  return (
    <ActionCard title="Assign a workshop technician">
      <p className="mb-2 text-xs text-slate-400">
        There's no "list technicians" endpoint in this app - paste the technician's user
        id directly (same convention as Appointments). The backend rejects anyone whose
        role isn't a real workshop technician / TL+.
      </p>
      <ErrorNotice error={mutation.error} />
      <form
        onSubmit={handleSubmit((values) => mutation.mutate(values.technicianId, { onSuccess: () => reset() }))}
        className="flex items-end gap-2"
      >
        <div className="flex-1">
          <Field label="Technician user id">
            <input className={inputClass} {...register('technicianId', { required: true })} />
          </Field>
        </div>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Assign
        </button>
      </form>
    </ActionCard>
  );
}

function RequestSpareCard({
  jobCard,
  mutation,
}: {
  jobCard: WorkshopState['jobCard'];
  mutation: UseMutationResult<InventoryReservation, unknown, Parameters<typeof requestSpare>[1]>;
}) {
  const sparePartsQuery = useQuery({
    queryKey: ['spare-parts', 'active'],
    queryFn: () => listSpareParts({ active: true }),
  });
  const { register, handleSubmit, reset } = useForm<{
    sparePartId: string;
    quantity: number;
    approverId: string;
    verbalOverrideBy: string;
    verbalOverrideNotes: string;
  }>({
    defaultValues: { sparePartId: '', quantity: 1, approverId: '', verbalOverrideBy: '', verbalOverrideNotes: '' },
  });
  const [justReserved, setJustReserved] = useState<InventoryReservation | null>(null);
  const { user } = useAuth();
  const isPrivileged = !!user && PRIVILEGED_ROLES.includes(user.role.name);
  const canRequestReturnOnJustReserved = !!justReserved && (isPrivileged || user?.id === justReserved.custodianUserId);

  const returnMutation = useMutation({
    mutationFn: (id: string) => requestReturn(id),
    onSuccess: (r) => setJustReserved(r),
  });

  const hadPriorRejection = jobCard.qcRejectionCount > 0;

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
                label="Approver user id"
                hint="A different user (not you) holding the REWORK_APPROVAL grant. If you don't have their id handy, use verbal override below instead."
              >
                <input className={inputClass} {...register('approverId')} />
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
    </ActionCard>
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
  const { user } = useAuth();
  const canConfirmReturn = !!user && RETURN_CONFIRM_ROLES.includes(user.role.name);

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
