// Field Technician Schedule board (2026-09-10, field/workshop scheduling split) - the
// field half of the old combined Assignment Board, pulled out into its own view. Per your
// decision this session: dragging a job to reorder it changes ONLY what the technician
// sees first in their mobile app (a new priority order) - it never touches the customer's
// actual promised appointment time. This page is deliberately an ordered list per
// technician, not a time-grid, so there's no clock to misread: position in the list IS
// the priority, top to bottom.
//
// v1 scope, deliberately: reordering (drag within one technician's own list) is built
// here. Assigning an appointment to a field technician for the first time, or moving one
// to a different technician, still happens on the existing Technician Assignment Board -
// that logic already works and isn't duplicated here. Every reorder is DB-audit-logged
// server-side (AuditAction.FIELD_SCHEDULE_REORDER) - nothing to do on this page for that,
// it's automatic on every successful drop.
import { useEffect, useState, type DragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ErrorNotice } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { useToast } from '../../lib/toast';
import { getFieldSchedule, reorderFieldSchedule } from '../../lib/technicianScheduleApi';
import type { FieldScheduleAppointment, FieldScheduleTechnicianRow } from '../../lib/technicianScheduleTypes';

const REORDER_MIME = 'application/x-jackys-field-reorder';

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatUtcTime(iso: string): string {
  const d = new Date(iso);
  const minute = d.getUTCMinutes();
  let hour = d.getUTCHours();
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${String(minute).padStart(2, '0')} ${ampm}`;
}

interface DragPayload {
  technicianId: string;
  appointmentId: string;
}

export function FieldSchedulePage() {
  const [date, setDate] = useState(todayIsoDate());
  // Local per-technician ordering, seeded from the server and updated immediately on drag
  // for responsive feedback - see the effect below for how it re-syncs with fresh data.
  const [order, setOrder] = useState<Record<string, string[]>>({});
  const [dragOverAppointmentId, setDragOverAppointmentId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { push } = useToast();

  const boardQuery = useQuery({
    queryKey: ['technician-schedule', 'field-schedule', date],
    queryFn: () => getFieldSchedule(date),
  });

  // Re-seed local order whenever fresh board data arrives (initial load, date change, or a
  // refetch after a reorder/error) - the server's order is always the source of truth.
  useEffect(() => {
    if (!boardQuery.data) return;
    const next: Record<string, string[]> = {};
    for (const t of boardQuery.data.technicians) {
      next[t.id] = t.appointments.map((a) => a.id);
    }
    setOrder(next);
  }, [boardQuery.data]);

  function invalidateBoard() {
    queryClient.invalidateQueries({ queryKey: ['technician-schedule', 'field-schedule', date] });
  }

  const reorderMutation = useMutation({
    mutationFn: ({ technicianId, orderedAppointmentIds }: { technicianId: string; orderedAppointmentIds: string[] }) =>
      reorderFieldSchedule(technicianId, orderedAppointmentIds),
    onError: (error: any) => {
      push({
        title: 'Could not save the new order',
        description: error?.response?.data?.message ?? 'Something went wrong.',
      });
      // The board the user was looking at is now out of sync with the server - refetch to
      // reset the local order to reality rather than leaving a drag result on screen that
      // never actually saved.
      invalidateBoard();
    },
  });

  function moveWithinTechnician(technicianId: string, fromId: string, toId: string) {
    if (fromId === toId) return;
    const current = order[technicianId] ?? [];
    const fromIndex = current.indexOf(fromId);
    const toIndex = current.indexOf(toId);
    if (fromIndex === -1 || toIndex === -1) return;
    const next = [...current];
    next.splice(fromIndex, 1);
    next.splice(toIndex, 0, fromId);
    setOrder((prev) => ({ ...prev, [technicianId]: next }));
    reorderMutation.mutate({ technicianId, orderedAppointmentIds: next });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Field Technician Schedule</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Drag a job up or down within a technician's list to change what they see first in the mobile app. This
            never changes the customer's promised appointment time - only the order. Every reorder is logged.
          </p>
        </div>
        <Link
          to="/technician-schedule"
          className="shrink-0 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Assign on the Assignment Board →
        </Link>
      </div>

      <Field label="Date">
        <input type="date" className={`${inputClass} max-w-xs`} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

      {boardQuery.isLoading && <p className="text-sm text-slate-400">Loading the schedule…</p>}
      {boardQuery.error && <ErrorNotice error={boardQuery.error} />}

      {boardQuery.data && (
        <>
          {boardQuery.data.technicians.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
              No active field technicians found.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {boardQuery.data.technicians.map((t) => (
                <TechnicianScheduleCard
                  key={t.id}
                  technician={t}
                  orderedIds={order[t.id] ?? t.appointments.map((a) => a.id)}
                  dragOverAppointmentId={dragOverAppointmentId}
                  onDragOverAppointment={setDragOverAppointmentId}
                  onDrop={(fromId, toId) => moveWithinTechnician(t.id, fromId, toId)}
                />
              ))}
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Appointments needing a field technician</h2>
            {boardQuery.data.unassignedAppointments.length === 0 ? (
              <p className="mt-2 text-xs text-slate-400">Every scheduled appointment today has a technician.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {boardQuery.data.unassignedAppointments.map((a) => (
                  <li key={a.id} className="py-2 text-sm">
                    <p className="font-medium text-slate-900">
                      {a.appointmentNumber} <span className="font-normal text-slate-500">· {a.customerName}</span>
                    </p>
                    <p className="text-xs text-slate-400">{formatUtcTime(a.scheduledAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TechnicianScheduleCard({
  technician,
  orderedIds,
  dragOverAppointmentId,
  onDragOverAppointment,
  onDrop,
}: {
  technician: FieldScheduleTechnicianRow;
  orderedIds: string[];
  dragOverAppointmentId: string | null;
  onDragOverAppointment: (id: string | null) => void;
  onDrop: (fromId: string, toId: string) => void;
}) {
  const byId = new Map(technician.appointments.map((a) => [a.id, a]));
  const orderedAppointments = orderedIds.map((id) => byId.get(id)).filter((a): a is FieldScheduleAppointment => !!a);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm font-medium text-slate-900">{technician.name}</p>
      <p className="text-xs text-slate-400">
        {orderedAppointments.length} job{orderedAppointments.length === 1 ? '' : 's'} today
      </p>

      <ol className="mt-3 space-y-1.5">
        {orderedAppointments.length === 0 && <li className="text-xs text-slate-300">No jobs scheduled</li>}
        {orderedAppointments.map((appt, i) => (
          <AppointmentRow
            key={appt.id}
            appointment={appt}
            position={i + 1}
            technicianId={technician.id}
            isDragOver={dragOverAppointmentId === appt.id}
            onDragOverAppointment={onDragOverAppointment}
            onDrop={onDrop}
          />
        ))}
      </ol>
    </div>
  );
}

function AppointmentRow({
  appointment,
  position,
  technicianId,
  isDragOver,
  onDragOverAppointment,
  onDrop,
}: {
  appointment: FieldScheduleAppointment;
  position: number;
  technicianId: string;
  isDragOver: boolean;
  onDragOverAppointment: (id: string | null) => void;
  onDrop: (fromId: string, toId: string) => void;
}) {
  function handleDragStart(e: DragEvent<HTMLLIElement>) {
    const payload: DragPayload = { technicianId, appointmentId: appointment.id };
    e.dataTransfer.setData(REORDER_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: DragEvent<HTMLLIElement>) {
    if (!e.dataTransfer.types.includes(REORDER_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    onDragOverAppointment(appointment.id);
  }

  function handleDrop(e: DragEvent<HTMLLIElement>) {
    e.preventDefault();
    onDragOverAppointment(null);
    const raw = e.dataTransfer.getData(REORDER_MIME);
    if (!raw) return;
    let payload: DragPayload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    // Reordering only makes sense within the same technician's own list - the reorder
    // endpoint requires the full set of that technician's current appointments, so a
    // cross-technician drop here is silently ignored (moving to a different technician is
    // still the Assignment Board's job, not this page's).
    if (payload.technicianId !== technicianId) return;
    onDrop(payload.appointmentId, appointment.id);
  }

  return (
    <li
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={() => onDragOverAppointment(null)}
      onDrop={handleDrop}
      onDragEnd={() => onDragOverAppointment(null)}
      data-testid={`field-appt-${appointment.id}`}
      className={`flex cursor-grab items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs active:cursor-grabbing ${
        isDragOver ? 'border-sky-400 bg-sky-50' : 'border-slate-100 bg-slate-50'
      }`}
      title="Drag to reprioritize - never changes the promised appointment time"
    >
      <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 font-medium text-slate-600">#{position}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-900">
          {appointment.appointmentNumber} <span className="font-normal text-slate-500">· {appointment.customerName}</span>
        </p>
        <p className="truncate text-slate-400">
          {formatUtcTime(appointment.scheduledAt)} · {appointment.status.replaceAll('_', ' ')}
        </p>
      </div>
    </li>
  );
}
