// Gantt-style technician assignment board (2026-09-09) - today's #1 build priority, the
// last remaining item from the Redtra360 competitor review. One row per active
// TECHNICIAN_FIELD/TECHNICIAN_WORKSHOP user, a horizontal timeline of their day's field
// appointments and workshop assignments, double-booking conflicts flagged in red by the
// backend (technician-schedule.util.ts), an "Add crew helper" action on any workshop block
// that's still actively assigned, and (2026-09-09, second pass) an "Unassigned" panel plus
// Assign/Reassign actions that make this the one place both an Appointment's field
// technician and a Job Card's workshop technician get assigned - see AssignTechnicianModal
// below for why this is a click-to-assign flow rather than drag-and-drop.
//
// Deliberately reuses the technician list already embedded in the Gantt response for every
// technician picker on this page (crew helper, assign, reassign) instead of calling GET
// /users: that endpoint is restricted to SUPER_ADMIN/SERVICE_HEAD (UsersController's
// USER_ADMIN_ROLES), but this board is also open to TECHNICAL_TEAM_LEADER, who would
// otherwise hit a 403 trying to populate any of these pickers.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ErrorNotice } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useToast } from '../../lib/toast';
import { getGanttBoard } from '../../lib/technicianScheduleApi';
import { addCrewHelper, assignWorkshopTechnician, reassignWorkshopTechnician } from '../../lib/workshopApi';
import { assignTechnician, updateAppointment } from '../../lib/appointmentsApi';
import type {
  ScheduleBlock,
  TechnicianScheduleRow,
  UnassignedAppointment,
  UnassignedJobCard,
} from '../../lib/technicianScheduleTypes';

const DAY_START_HOUR = 7;
const DAY_END_HOUR = 21; // 9pm - covers every field/workshop shift this app schedules into today
const TOTAL_HOURS = DAY_END_HOUR - DAY_START_HOUR;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const BLOCK_COLORS: Record<ScheduleBlock['type'], string> = {
  appointment: 'bg-sky-100 border-sky-300 text-sky-900',
  workshop_job: 'bg-emerald-100 border-emerald-300 text-emerald-900',
  crew_helper: 'bg-violet-100 border-violet-300 text-violet-900',
};

const CREW_HELPER_ELIGIBLE_STATUSES = new Set(['WORKSHOP_ASSIGNED', 'IN_PROGRESS', 'SPARE_PENDING']);

// Mirrors WorkshopService.reassign()'s own status guard - only show a Reassign button when
// the backend would actually accept the call, rather than a button that always 400s.
const WORKSHOP_JOB_REASSIGN_STATUSES = new Set(['WORKSHOP_ASSIGNED', 'IN_PROGRESS', 'SPARE_PENDING', 'READY_FOR_QC']);

// What's currently being assigned/reassigned via AssignTechnicianModal - one shape covers
// both entity kinds (Appointment/Job Card) and both actions (initial assign / reassign),
// since the modal itself only differs by which mutation it calls and which technician
// pool + exclusion it shows.
type AssignTarget =
  | { kind: 'appointment-assign'; id: string; label: string }
  | { kind: 'appointment-reassign'; id: string; label: string; currentTechnicianId: string }
  | { kind: 'jobcard-assign'; id: string; label: string }
  | { kind: 'jobcard-reassign'; id: string; label: string; currentTechnicianId: string };

export function TechnicianGanttPage() {
  const [date, setDate] = useState(todayIsoDate());
  const [helperTarget, setHelperTarget] = useState<{ jobCardId: string; jobCardNumber: string } | null>(null);
  const [assignTarget, setAssignTarget] = useState<AssignTarget | null>(null);
  const queryClient = useQueryClient();

  const boardQuery = useQuery({
    queryKey: ['technician-schedule', 'gantt', date],
    queryFn: () => getGanttBoard(date),
  });

  const conflictCount = boardQuery.data?.rows.filter((r) => r.hasConflict).length ?? 0;

  function invalidateBoard() {
    queryClient.invalidateQueries({ queryKey: ['technician-schedule', 'gantt', date] });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-8 py-8">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Technician Assignment Board</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          One day, every technician - field appointments and workshop assignments on one timeline, plus
          appointments and job cards still waiting on a technician below. Double bookings are flagged in red.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <Field label="Date">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {conflictCount > 0 && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700">
            {conflictCount} technician{conflictCount === 1 ? '' : 's'} double-booked today
          </p>
        )}
      </div>

      {boardQuery.isLoading && <p className="text-sm text-slate-400">Loading the board…</p>}
      {boardQuery.error && <ErrorNotice error={boardQuery.error} />}

      {boardQuery.data && (
        <div className="grid gap-4 md:grid-cols-2">
          <UnassignedAppointmentsPanel
            items={boardQuery.data.unassignedAppointments}
            onAssign={(a) => setAssignTarget({ kind: 'appointment-assign', id: a.id, label: a.appointmentNumber })}
          />
          <UnassignedJobCardsPanel
            items={boardQuery.data.unassignedJobCards}
            onAssign={(j) => setAssignTarget({ kind: 'jobcard-assign', id: j.id, label: j.jobCardNumber })}
          />
        </div>
      )}

      {boardQuery.data && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <TimeAxis />
          <div className="divide-y divide-slate-100">
            {boardQuery.data.rows.length === 0 && (
              <p className="p-4 text-sm text-slate-400">No active field or workshop technicians found.</p>
            )}
            {boardQuery.data.rows.map((row) => (
              <TechnicianRow key={row.technicianId} row={row} onAddHelper={(t) => setHelperTarget(t)} onReassign={(t) => setAssignTarget(t)} />
            ))}
          </div>
        </div>
      )}

      {helperTarget && (
        <AddCrewHelperModal
          jobCardId={helperTarget.jobCardId}
          jobCardNumber={helperTarget.jobCardNumber}
          candidates={
            boardQuery.data?.rows.filter((r) => r.role === 'TECHNICIAN_WORKSHOP').map((r) => ({ id: r.technicianId, name: r.technicianName })) ??
            []
          }
          currentlyOnJob={
            new Set(
              (boardQuery.data?.rows ?? [])
                .flatMap((r) => r.blocks)
                .filter((b) => b.refId === helperTarget.jobCardId && (b.type === 'workshop_job' || b.type === 'crew_helper'))
                .map((b) => b.technicianId),
            )
          }
          onClose={() => setHelperTarget(null)}
          onAdded={() => {
            setHelperTarget(null);
            invalidateBoard();
          }}
        />
      )}

      {assignTarget && (
        <AssignTechnicianModal
          target={assignTarget}
          fieldCandidates={
            boardQuery.data?.rows.filter((r) => r.role === 'TECHNICIAN_FIELD').map((r) => ({ id: r.technicianId, name: r.technicianName })) ?? []
          }
          workshopCandidates={
            boardQuery.data?.rows.filter((r) => r.role === 'TECHNICIAN_WORKSHOP').map((r) => ({ id: r.technicianId, name: r.technicianName })) ?? []
          }
          onClose={() => setAssignTarget(null)}
          onAssigned={() => {
            setAssignTarget(null);
            invalidateBoard();
          }}
        />
      )}
    </div>
  );
}

function UnassignedAppointmentsPanel({
  items,
  onAssign,
}: {
  items: UnassignedAppointment[];
  onAssign: (a: UnassignedAppointment) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Appointments needing a technician</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">Every scheduled appointment today has a technician.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">
                  {a.appointmentNumber} <span className="font-normal text-slate-500">· {a.customerName}</span>
                </p>
                <p className="text-xs text-slate-400">{new Date(a.scheduledAt).toLocaleString()}</p>
              </div>
              <button
                onClick={() => onAssign(a)}
                className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-white"
              >
                Assign →
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UnassignedJobCardsPanel({ items, onAssign }: { items: UnassignedJobCard[]; onAssign: (j: UnassignedJobCard) => void }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Job cards needing a workshop technician</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">No workshop job cards are waiting on a technician.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((j) => (
            <li key={j.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{j.jobCardNumber}</p>
                <p className="text-xs text-slate-400">
                  {j.faultCode}/{j.symptomCode} · {j.warrantyStatus.replaceAll('_', ' ')}
                </p>
              </div>
              <button
                onClick={() => onAssign(j)}
                className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-white"
              >
                Assign →
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TimeAxis() {
  const hours = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => DAY_START_HOUR + i);
  return (
    <div className="flex border-b border-slate-200 bg-slate-50 pl-48 text-[10px] text-slate-400">
      {hours.map((h) => (
        <div key={h} className="flex-1 border-l border-slate-100 py-1 text-center first:border-l-0">
          {h % 12 === 0 ? 12 : h % 12}
          {h < 12 ? 'am' : 'pm'}
        </div>
      ))}
    </div>
  );
}

function TechnicianRow({
  row,
  onAddHelper,
  onReassign,
}: {
  row: TechnicianScheduleRow;
  onAddHelper: (t: { jobCardId: string; jobCardNumber: string }) => void;
  onReassign: (t: AssignTarget) => void;
}) {
  return (
    <div className={`flex items-stretch ${row.hasConflict ? 'bg-red-50/50' : ''}`}>
      <div className="w-48 shrink-0 border-r border-slate-100 p-2">
        <p className="text-sm font-medium text-slate-900">{row.technicianName}</p>
        <p className="text-xs text-slate-400">{row.role === 'TECHNICIAN_FIELD' ? 'Field' : 'Workshop'}</p>
        {row.hasConflict && <p className="mt-1 text-xs font-medium text-red-600">Double-booked</p>}
      </div>
      <div className="relative flex-1 py-2">
        {row.blocks.length === 0 && <p className="px-2 text-xs text-slate-300">No assignments today</p>}
        {row.blocks.map((block) => (
          <BlockBar key={block.id} block={block} onAddHelper={onAddHelper} onReassign={onReassign} />
        ))}
      </div>
    </div>
  );
}

function timeToPercent(iso: string): number {
  const d = new Date(iso);
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60;
  const clamped = Math.min(Math.max(hours, DAY_START_HOUR), DAY_END_HOUR);
  return ((clamped - DAY_START_HOUR) / TOTAL_HOURS) * 100;
}

function BlockBar({
  block,
  onAddHelper,
  onReassign,
}: {
  block: ScheduleBlock;
  onAddHelper: (t: { jobCardId: string; jobCardNumber: string }) => void;
  onReassign: (t: AssignTarget) => void;
}) {
  const left = timeToPercent(block.startAt);
  const right = timeToPercent(block.endAt);
  const width = Math.max(right - left, 2);
  const canAddHelper = block.type === 'workshop_job' && CREW_HELPER_ELIGIBLE_STATUSES.has(block.status);
  // Reassignment doesn't apply to a crew_helper block (that's the "remove helper" flow,
  // out of scope for this page today - see this page's own top doc comment) or to a
  // workshop_job block outside WorkshopService.reassign()'s own status guard.
  const canReassign =
    block.type === 'appointment' || (block.type === 'workshop_job' && WORKSHOP_JOB_REASSIGN_STATUSES.has(block.status));

  function handleReassign() {
    if (block.type === 'appointment') {
      onReassign({ kind: 'appointment-reassign', id: block.refId, label: block.refNumber, currentTechnicianId: block.technicianId });
    } else if (block.type === 'workshop_job') {
      onReassign({ kind: 'jobcard-reassign', id: block.refId, label: block.refNumber, currentTechnicianId: block.technicianId });
    }
  }

  return (
    <div
      className={`group relative mb-1 rounded border px-2 py-1 text-xs ${
        block.hasConflict ? 'border-red-400 bg-red-100 text-red-900 ring-1 ring-red-400' : BLOCK_COLORS[block.type]
      }`}
      style={{ marginLeft: `${left}%`, width: `${width}%` }}
      title={`${block.refNumber} · ${block.detail} · ${block.status}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{block.refNumber}</span>
        <span className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100">
          {canReassign && (
            <button
              onClick={handleReassign}
              className="rounded border border-current px-1 text-[10px] font-medium"
            >
              Reassign
            </button>
          )}
          {canAddHelper && (
            <button
              onClick={() => onAddHelper({ jobCardId: block.refId, jobCardNumber: block.refNumber })}
              className="rounded border border-current px-1 text-[10px] font-medium"
            >
              + Helper
            </button>
          )}
        </span>
      </div>
      <p className="truncate text-[10px] opacity-80">
        {block.detail}
        {block.ongoing && ' · ongoing'}
      </p>
    </div>
  );
}

function AddCrewHelperModal({
  jobCardId,
  jobCardNumber,
  candidates,
  currentlyOnJob,
  onClose,
  onAdded,
}: {
  jobCardId: string;
  jobCardNumber: string;
  candidates: { id: string; name: string }[];
  currentlyOnJob: Set<string>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [technicianId, setTechnicianId] = useState('');
  const { push } = useToast();

  const available = useMemo(() => candidates.filter((c) => !currentlyOnJob.has(c.id)), [candidates, currentlyOnJob]);

  const mutation = useMutation({
    mutationFn: () => addCrewHelper(jobCardId, { technicianId }),
    onSuccess: () => {
      push({ title: 'Crew helper added', description: `Added to ${jobCardNumber}.` });
      onAdded();
    },
    onError: (error: any) => {
      push({
        title: 'Could not add crew helper',
        description: error?.response?.data?.message ?? 'Something went wrong.',
      });
    },
  });

  return (
    <Modal open onClose={onClose} title={`Add crew helper — ${jobCardNumber}`}>
      <div className="space-y-4">
        <Field label="Technician" hint="Only active workshop technicians not already on this job are listed.">
          <select className={inputClass} value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
            <option value="">Select a technician…</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        {available.length === 0 && (
          <p className="text-xs text-slate-400">No other workshop technicians are available on this board today.</p>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            disabled={!technicianId || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {mutation.isPending ? 'Adding…' : 'Add helper'}
          </button>
        </div>
        <Link to={`/job-cards/journey?jobCardId=${jobCardId}`} className="block text-xs text-slate-400 underline underline-offset-2">
          View full job card journey →
        </Link>
      </div>
    </Modal>
  );
}

// Click-to-assign (2026-09-09, the-fool pre-mortem finding): the Redtra reference screenshot
// this feature was modelled on is itself tap-a-chip, not drag-and-drop - native HTML5 drag
// doesn't fire on touch devices at all (a real concern for a Team Leader on a tablet in the
// workshop) and needs a keyboard/click fallback regardless, so this is built as that fallback
// directly rather than as a thin wrapper around a drag interaction. One modal handles all four
// assign/reassign combinations (see AssignTarget's own doc comment) since they only differ in
// which technician pool to offer, whether to exclude the current assignee, and which mutation
// to call - the backend's own guards (availability, reservation custody, late-stage edit-lock)
// are the real source of truth either way, so a failed assign/reassign surfaces as a toast
// here rather than being pre-validated client-side.
function AssignTechnicianModal({
  target,
  fieldCandidates,
  workshopCandidates,
  onClose,
  onAssigned,
}: {
  target: AssignTarget;
  fieldCandidates: { id: string; name: string }[];
  workshopCandidates: { id: string; name: string }[];
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [technicianId, setTechnicianId] = useState('');
  const { push } = useToast();

  const isAppointment = target.kind === 'appointment-assign' || target.kind === 'appointment-reassign';
  const isReassign = target.kind === 'appointment-reassign' || target.kind === 'jobcard-reassign';
  const pool = isAppointment ? fieldCandidates : workshopCandidates;
  const excludeId = isReassign ? (target as { currentTechnicianId: string }).currentTechnicianId : undefined;
  const available = useMemo(() => pool.filter((c) => c.id !== excludeId), [pool, excludeId]);

  const mutation = useMutation({
    mutationFn: () => {
      switch (target.kind) {
        case 'appointment-assign':
          return assignTechnician(target.id, technicianId);
        case 'appointment-reassign':
          return updateAppointment(target.id, { technicianId });
        case 'jobcard-assign':
          return assignWorkshopTechnician(target.id, { technicianId });
        case 'jobcard-reassign':
          return reassignWorkshopTechnician(target.id, { technicianId });
      }
    },
    onSuccess: () => {
      push({ title: isReassign ? 'Technician reassigned' : 'Technician assigned', description: target.label });
      onAssigned();
    },
    onError: (error: any) => {
      push({
        title: isReassign ? 'Could not reassign technician' : 'Could not assign technician',
        description: error?.response?.data?.message ?? 'Something went wrong.',
      });
    },
  });

  const title = `${isReassign ? 'Reassign' : 'Assign'} technician — ${target.label}`;

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="space-y-4">
        <Field
          label="Technician"
          hint={
            isAppointment
              ? 'Active field technicians on this board.'
              : 'Active workshop technicians on this board.'
          }
        >
          <select className={inputClass} value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
            <option value="">Select a technician…</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        {available.length === 0 && (
          <p className="text-xs text-slate-400">No other {isAppointment ? 'field' : 'workshop'} technicians are available on this board today.</p>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            disabled={!technicianId || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {/* Deliberately "Confirm", not "Assign"/"Reassign" - those labels are already
                used by the trigger button on the block/unassigned-card that opened this
                modal, and both can be visible in the DOM at once. */}
            {mutation.isPending ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
