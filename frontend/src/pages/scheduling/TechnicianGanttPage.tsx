// Gantt-style technician assignment board (2026-09-09) - today's #1 build priority, the
// last remaining item from the Redtra360 competitor review. One row per active
// TECHNICIAN_FIELD/TECHNICIAN_WORKSHOP user, a horizontal timeline of their day's field
// appointments and workshop assignments, double-booking conflicts flagged in red by the
// backend (technician-schedule.util.ts), an "Add crew helper" action on any workshop block
// that's still actively assigned, an "Unassigned" panel of appointments/job cards still
// needing a technician, and (2026-09-09, third pass) native HTML5 drag-and-drop for
// assign/reassign - drag an unassigned card, or an existing timeline block, onto a
// technician's row.
//
// This was click-to-assign for one round (see git history) on an earlier the-fool
// pre-mortem finding that drag doesn't fire on touch devices. That finding no longer
// applies: this board is desktop-web-only - Customer Care Executives and Team Leaders use
// it from a desk, never a phone/tablet, and the mobile app is technician-only for their own
// separate on-the-job workflow (receiving/updating their own assignments, not making them).
// Click-to-assign also had a real bug: it never let the user set an appointment's time, so a
// freshly assigned appointment kept whatever scheduledAt it already had (frequently reading
// as "defaults to 7am" once clamped onto this board's 07:00-21:00 axis). Drag-and-drop fixes
// that at the root - the drop position on the timeline IS the requested time, computed by
// computeDropTime() below (the inverse of timeToPercent()), so there's no default to get
// wrong.
//
// Deliberately reuses the technician list already embedded in the Gantt response for every
// technician picker on this page (crew helper, technician filter) instead of calling GET
// /users: that endpoint is restricted to SUPER_ADMIN/SERVICE_HEAD (UsersController's
// USER_ADMIN_ROLES), but this board is also open to TECHNICAL_TEAM_LEADER, who would
// otherwise hit a 403 trying to populate any of these pickers.
import { useMemo, useState, type DragEvent } from 'react';
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
const DRAG_MIME = 'application/x-jackys-schedule-item';

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const BLOCK_COLORS: Record<ScheduleBlock['type'], string> = {
  appointment: 'bg-sky-100 border-sky-300 text-sky-900',
  workshop_job: 'bg-emerald-100 border-emerald-300 text-emerald-900',
  crew_helper: 'bg-violet-100 border-violet-300 text-violet-900',
};

const CREW_HELPER_ELIGIBLE_STATUSES = new Set(['WORKSHOP_ASSIGNED', 'IN_PROGRESS', 'SPARE_PENDING']);

// Mirrors WorkshopService.reassign()'s own status guard - only let a block be dragged for
// reassignment when the backend would actually accept the call, rather than a drag that
// always ends in a 400 toast.
const WORKSHOP_JOB_REASSIGN_STATUSES = new Set(['WORKSHOP_ASSIGNED', 'IN_PROGRESS', 'SPARE_PENDING', 'READY_FOR_QC']);

// What's carried in dataTransfer while dragging - an unassigned card, or an existing
// timeline block being re-dragged. `currentTechnicianId: null` means "not assigned yet",
// which is what tells handleDrop() whether to call the initial-assign endpoint (which also
// transitions status) or the plain update/reassign endpoint (status already progressed).
type DragPayload =
  | { entityType: 'appointment'; id: string; label: string; currentTechnicianId: string | null }
  | { entityType: 'jobcard'; id: string; label: string; currentTechnicianId: string | null };

type DropAction =
  | { kind: 'appointment-assign'; id: string; technicianId: string; scheduledAt: string; label: string }
  | { kind: 'appointment-reassign'; id: string; technicianId: string; scheduledAt: string; label: string }
  | { kind: 'jobcard-assign'; id: string; technicianId: string; label: string }
  | { kind: 'jobcard-reassign'; id: string; technicianId: string; label: string };

function startDrag(payload: DragPayload) {
  return (e: DragEvent<HTMLElement>) => {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  };
}

export function TechnicianGanttPage() {
  const [date, setDate] = useState(todayIsoDate());
  const [technicianFilter, setTechnicianFilter] = useState('');
  const [helperTarget, setHelperTarget] = useState<{ jobCardId: string; jobCardNumber: string } | null>(null);
  const [dragOverTechnicianId, setDragOverTechnicianId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { push } = useToast();

  const boardQuery = useQuery({
    queryKey: ['technician-schedule', 'gantt', date],
    queryFn: () => getGanttBoard(date),
  });

  const conflictCount = boardQuery.data?.rows.filter((r) => r.hasConflict).length ?? 0;

  const visibleRows = useMemo(() => {
    const rows = boardQuery.data?.rows ?? [];
    return technicianFilter ? rows.filter((r) => r.technicianId === technicianFilter) : rows;
  }, [boardQuery.data, technicianFilter]);

  function invalidateBoard() {
    queryClient.invalidateQueries({ queryKey: ['technician-schedule', 'gantt', date] });
  }

  const dropMutation = useMutation({
    mutationFn: async (action: DropAction) => {
      switch (action.kind) {
        case 'appointment-assign':
          // One atomic call - assignTechnician() now optionally accepts scheduledAt (backend
          // change, 2026-09-09) so the technician assignment and the drop-computed time land
          // together. This used to be two sequential calls (assign, then update); a the-fool
          // pre-mortem on this exact drag-and-drop rework flagged that as the top-severity
          // risk - a network blip or a capacity conflict surfacing only on the second call
          // would leave the appointment assigned to a technician but still sitting on its old
          // (often misleading) time, with no way to tell from the toast alone. A single call
          // means it either fully succeeds or fully fails - see AssignTechnicianDto's own doc
          // comment on the backend side.
          return assignTechnician(action.id, action.technicianId, action.scheduledAt);
        case 'appointment-reassign':
          return updateAppointment(action.id, { technicianId: action.technicianId, scheduledAt: action.scheduledAt });
        case 'jobcard-assign':
          return assignWorkshopTechnician(action.id, { technicianId: action.technicianId });
        case 'jobcard-reassign':
          return reassignWorkshopTechnician(action.id, { technicianId: action.technicianId });
      }
    },
    onSuccess: (_data, action) => {
      const title =
        action.kind === 'appointment-assign' || action.kind === 'jobcard-assign' ? 'Technician assigned' : 'Reassigned';
      push({ title, description: action.label });
      invalidateBoard();
    },
    onError: (error: any) => {
      push({
        title: 'Could not complete the drop',
        description: error?.response?.data?.message ?? 'Something went wrong.',
      });
      // Refetch even on failure (same the-fool pre-mortem, race-condition finding): the board
      // the user is looking at could already be stale by the time they dragged (someone else's
      // action, or the technician's own mobile-app update), which is part of why the drop was
      // rejected in the first place - re-pull the real state rather than leaving a now-known-
      // stale board on screen for the next drag attempt.
      invalidateBoard();
    },
  });

  function handleDrop(e: DragEvent<HTMLDivElement>, targetRow: TechnicianScheduleRow) {
    e.preventDefault();
    setDragOverTechnicianId(null);
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    let payload: DragPayload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    if (payload.entityType === 'appointment') {
      if (targetRow.role !== 'TECHNICIAN_FIELD') {
        push({
          title: 'Wrong technician type',
          description: `${payload.label} is a field appointment - drop it on a field technician's row.`,
        });
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const scheduledAt = computeDropTime(date, e.clientX, rect);
      dropMutation.mutate(
        payload.currentTechnicianId
          ? { kind: 'appointment-reassign', id: payload.id, technicianId: targetRow.technicianId, scheduledAt, label: payload.label }
          : { kind: 'appointment-assign', id: payload.id, technicianId: targetRow.technicianId, scheduledAt, label: payload.label },
      );
      return;
    }

    if (targetRow.role !== 'TECHNICIAN_WORKSHOP') {
      push({
        title: 'Wrong technician type',
        description: `${payload.label} is a workshop job card - drop it on a workshop technician's row.`,
      });
      return;
    }
    if (payload.currentTechnicianId === targetRow.technicianId) {
      push({ title: 'Already assigned', description: `${payload.label} is already on ${targetRow.technicianName}.` });
      return;
    }
    dropMutation.mutate(
      payload.currentTechnicianId
        ? { kind: 'jobcard-reassign', id: payload.id, technicianId: targetRow.technicianId, label: payload.label }
        : { kind: 'jobcard-assign', id: payload.id, technicianId: targetRow.technicianId, label: payload.label },
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-8 py-8">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Technician Assignment Board</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          One day, every technician - field appointments and workshop assignments on one timeline, plus appointments
          and job cards still waiting on a technician below. Drag a card onto a technician's row to assign it; drag
          an existing block to a different row to reassign it. Double bookings are flagged in red.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <Field label="Date">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Technician">
          <select className={inputClass} value={technicianFilter} onChange={(e) => setTechnicianFilter(e.target.value)}>
            <option value="">All technicians</option>
            {(boardQuery.data?.rows ?? []).map((r) => (
              <option key={r.technicianId} value={r.technicianId}>
                {r.technicianName}
              </option>
            ))}
          </select>
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
          <UnassignedAppointmentsPanel items={boardQuery.data.unassignedAppointments} />
          <UnassignedJobCardsPanel items={boardQuery.data.unassignedJobCards} />
        </div>
      )}

      {boardQuery.data && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <TimeAxis />
          <div className="divide-y divide-slate-100">
            {visibleRows.length === 0 && (
              <p className="p-4 text-sm text-slate-400">
                {boardQuery.data.rows.length === 0 ? 'No active field or workshop technicians found.' : 'No technician matches this filter.'}
              </p>
            )}
            {visibleRows.map((row) => (
              <TechnicianRow
                key={row.technicianId}
                row={row}
                isDragOver={dragOverTechnicianId === row.technicianId}
                onAddHelper={(t) => setHelperTarget(t)}
                onDragEnter={() => setDragOverTechnicianId(row.technicianId)}
                onDragLeave={() => setDragOverTechnicianId((current) => (current === row.technicianId ? null : current))}
                onDrop={(e) => handleDrop(e, row)}
              />
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
    </div>
  );
}

function UnassignedAppointmentsPanel({ items }: { items: UnassignedAppointment[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Appointments needing a technician</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">Every scheduled appointment today has a technician.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((a) => (
            <li
              key={a.id}
              draggable
              onDragStart={startDrag({ entityType: 'appointment', id: a.id, label: a.appointmentNumber, currentTechnicianId: null })}
              className="cursor-grab rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm active:cursor-grabbing"
              title="Drag onto a field technician's row to assign"
            >
              <p className="truncate font-medium text-slate-900">
                {a.appointmentNumber} <span className="font-normal text-slate-500">· {a.customerName}</span>
              </p>
              <p className="text-xs text-slate-400">{new Date(a.scheduledAt).toLocaleString()}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UnassignedJobCardsPanel({ items }: { items: UnassignedJobCard[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Job cards needing a workshop technician</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">No workshop job cards are waiting on a technician.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((j) => (
            <li
              key={j.id}
              draggable
              onDragStart={startDrag({ entityType: 'jobcard', id: j.id, label: j.jobCardNumber, currentTechnicianId: null })}
              className="cursor-grab rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm active:cursor-grabbing"
              title="Drag onto a workshop technician's row to assign"
            >
              <p className="truncate font-medium text-slate-900">{j.jobCardNumber}</p>
              <p className="text-xs text-slate-400">
                {j.faultCode}/{j.symptomCode} · {j.warrantyStatus.replaceAll('_', ' ')}
              </p>
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
  isDragOver,
  onAddHelper,
  onDragEnter,
  onDragLeave,
  onDrop,
}: {
  row: TechnicianScheduleRow;
  isDragOver: boolean;
  onAddHelper: (t: { jobCardId: string; jobCardNumber: string }) => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div className={`flex items-stretch ${row.hasConflict ? 'bg-red-50/50' : ''}`}>
      <div className="w-48 shrink-0 border-r border-slate-100 p-2">
        <p className="text-sm font-medium text-slate-900">{row.technicianName}</p>
        <p className="text-xs text-slate-400">{row.role === 'TECHNICIAN_FIELD' ? 'Field' : 'Workshop'}</p>
        {row.hasConflict && <p className="mt-1 text-xs font-medium text-red-600">Double-booked</p>}
      </div>
      <div
        data-testid={`drop-zone-${row.technicianId}`}
        className={`relative flex-1 py-2 ${isDragOver ? 'bg-sky-50 outline-dashed outline-2 outline-sky-300' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {row.blocks.length === 0 && <p className="px-2 text-xs text-slate-300">No assignments today</p>}
        {row.blocks.map((block) => (
          <BlockBar key={block.id} block={block} onAddHelper={onAddHelper} />
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

// Inverse of timeToPercent() - where on the row (in pixels, relative to the drop target's
// own bounding box) becomes a UTC time-of-day on the board's selected date, snapped to the
// nearest 15 minutes and clamped to the 07:00-21:00 board window. Same UTC-hours convention
// as timeToPercent() throughout, deliberately: the board renders every time in UTC (there is
// no per-technician timezone concept in this app), so the drop position must invert with the
// exact same convention it was rendered with or every dropped time would be off by whatever
// the browser's local UTC offset happens to be.
function computeDropTime(dateStr: string, clientX: number, rect: DOMRect): string {
  const rawPercent = rect.width > 0 ? ((clientX - rect.left) / rect.width) * 100 : 0;
  const clampedPercent = Math.min(Math.max(rawPercent, 0), 100);
  const hoursFloat = DAY_START_HOUR + (clampedPercent / 100) * TOTAL_HOURS;
  const totalMinutes = Math.round((hoursFloat * 60) / 15) * 15;
  const clampedMinutes = Math.min(Math.max(totalMinutes, DAY_START_HOUR * 60), DAY_END_HOUR * 60);
  const hh = String(Math.floor(clampedMinutes / 60)).padStart(2, '0');
  const mm = String(clampedMinutes % 60).padStart(2, '0');
  return `${dateStr}T${hh}:${mm}:00.000Z`;
}

function BlockBar({
  block,
  onAddHelper,
}: {
  block: ScheduleBlock;
  onAddHelper: (t: { jobCardId: string; jobCardNumber: string }) => void;
}) {
  const left = timeToPercent(block.startAt);
  const right = timeToPercent(block.endAt);
  const width = Math.max(right - left, 2);
  const canAddHelper = block.type === 'workshop_job' && CREW_HELPER_ELIGIBLE_STATUSES.has(block.status);
  // Reassignment-by-drag doesn't apply to a crew_helper block (that's the "remove helper"
  // flow, out of scope for this page - see this page's own top doc comment) or to a
  // workshop_job block outside WorkshopService.reassign()'s own status guard.
  const canDrag = block.type === 'appointment' || (block.type === 'workshop_job' && WORKSHOP_JOB_REASSIGN_STATUSES.has(block.status));
  const dragPayload: DragPayload | null = canDrag
    ? block.type === 'appointment'
      ? { entityType: 'appointment', id: block.refId, label: block.refNumber, currentTechnicianId: block.technicianId }
      : { entityType: 'jobcard', id: block.refId, label: block.refNumber, currentTechnicianId: block.technicianId }
    : null;

  return (
    <div
      draggable={canDrag}
      onDragStart={dragPayload ? startDrag(dragPayload) : undefined}
      className={`group relative mb-1 rounded border px-2 py-1 text-xs ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''} ${
        block.hasConflict ? 'border-red-400 bg-red-100 text-red-900 ring-1 ring-red-400' : BLOCK_COLORS[block.type]
      }`}
      style={{ marginLeft: `${left}%`, width: `${width}%` }}
      title={`${block.refNumber} · ${block.detail} · ${block.status}${canDrag ? ' · drag to reassign' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{block.refNumber}</span>
        {canAddHelper && (
          <span className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100">
            <button
              onClick={() => onAddHelper({ jobCardId: block.refId, jobCardNumber: block.refNumber })}
              className="rounded border border-current px-1 text-[10px] font-medium"
            >
              + Helper
            </button>
          </span>
        )}
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
