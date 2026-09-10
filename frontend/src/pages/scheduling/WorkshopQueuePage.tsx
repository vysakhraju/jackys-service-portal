// Workshop Queue board (2026-09-10, field/workshop scheduling split) - the workshop half
// of the old combined Assignment Board (TechnicianGanttPage), pulled out into its own
// purpose-built view. Per your decision this session: no time-of-day concept at all - a
// workshop technician's queue is just their actively-assigned Job Cards in FIFO order
// (oldest workshopAssignedAt first), and a capacity that's a PLANNING GAUGE ONLY - a
// technician already at capacity still accepts new Job Cards, they simply queue as
// backlog. Nothing here ever blocks an assignment; overCapacity just turns the gauge
// amber/red so a Team Leader can see the backlog building up.
//
// v1 scope, deliberately: this page is view + capacity-gauge control only. Assigning a
// Job Card to a workshop technician for the first time, or reassigning one, still happens
// on the existing Technician Assignment Board (drag-and-drop) - that logic already works
// and isn't duplicated here. A "Assign on the Assignment Board →" link covers that,
// consistent with the-fool's migration-risk finding: don't break the CCE/TL's existing
// day-one workflow while this new view beds in.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ErrorNotice } from '../../components/DataTable';
import { inputClass } from '../../components/Field';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { getWorkshopQueue, setWorkshopCapacity } from '../../lib/technicianScheduleApi';
import type { WorkshopQueueJob, WorkshopQueueTechnicianRow } from '../../lib/technicianScheduleTypes';

// Mirrors WORKSHOP_ASSIGN's own defaultRoles in capability-catalog.ts (Team Leader) plus
// the two roles that always bypass the matrix (MATRIX_LOCKED_ROLES) - a client-side hint
// only, the backend guard is what actually enforces this on the PATCH below.
const CAPACITY_EDIT_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER'];

export function WorkshopQueuePage() {
  const { user } = useAuth();
  const canEditCapacity = !!user && CAPACITY_EDIT_ROLES.includes(user.role.name);
  const queryClient = useQueryClient();
  const { push } = useToast();

  const boardQuery = useQuery({
    queryKey: ['technician-schedule', 'workshop-queue'],
    queryFn: getWorkshopQueue,
  });

  const capacityMutation = useMutation({
    mutationFn: ({ technicianId, capacity }: { technicianId: string; capacity: number }) =>
      setWorkshopCapacity(technicianId, capacity),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['technician-schedule', 'workshop-queue'] });
    },
    onError: (error: any) => {
      push({
        title: 'Could not update capacity',
        description: error?.response?.data?.message ?? 'Something went wrong.',
      });
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Workshop Queue</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            No appointment times here - a workshop technician repairs whatever's assigned to them, oldest job first.
            Capacity is a planning gauge only: a technician over capacity still takes the next job, it just queues as
            backlog.
          </p>
        </div>
        <Link
          to="/technician-schedule"
          className="shrink-0 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Assign on the Assignment Board →
        </Link>
      </div>

      {boardQuery.isLoading && <p className="text-sm text-slate-400">Loading the queue…</p>}
      {boardQuery.error && <ErrorNotice error={boardQuery.error} />}

      {boardQuery.data && (
        <>
          {boardQuery.data.technicians.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
              No active workshop technicians found.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {boardQuery.data.technicians.map((t) => (
                <TechnicianQueueCard
                  key={t.id}
                  technician={t}
                  canEditCapacity={canEditCapacity}
                  onSaveCapacity={(capacity) => capacityMutation.mutate({ technicianId: t.id, capacity })}
                  saving={capacityMutation.isPending && capacityMutation.variables?.technicianId === t.id}
                />
              ))}
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Job cards needing a workshop technician</h2>
            {boardQuery.data.unassignedJobCards.length === 0 ? (
              <p className="mt-2 text-xs text-slate-400">No workshop job cards are waiting on a technician.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {boardQuery.data.unassignedJobCards.map((j) => (
                  <li key={j.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <p className="font-medium text-slate-900">{j.jobCardNumber}</p>
                      <p className="text-xs text-slate-400">
                        {j.faultCode}/{j.symptomCode} · {j.warrantyStatus.replaceAll('_', ' ')}
                      </p>
                    </div>
                    <Link to={`/job-cards/journey?jobCardId=${j.id}`} className="text-xs text-slate-400 underline underline-offset-2">
                      View journey →
                    </Link>
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

function CapacityGauge({ activeCount, capacity, overCapacity }: { activeCount: number; capacity: number; overCapacity: boolean }) {
  const pct = capacity > 0 ? Math.min((activeCount / capacity) * 100, 100) : activeCount > 0 ? 100 : 0;
  const barColor = overCapacity ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      {overCapacity && (
        <p className="mt-1 text-xs font-medium text-red-600">
          {activeCount} of {capacity} - over capacity, queuing as backlog
        </p>
      )}
    </div>
  );
}

function TechnicianQueueCard({
  technician,
  canEditCapacity,
  onSaveCapacity,
  saving,
}: {
  technician: WorkshopQueueTechnicianRow;
  canEditCapacity: boolean;
  onSaveCapacity: (capacity: number) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draftCapacity, setDraftCapacity] = useState(String(technician.capacity));

  return (
    <div className={`rounded-lg border bg-white p-4 ${technician.overCapacity ? 'border-red-200' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">{technician.name}</p>
          <p className="text-xs text-slate-400">
            {technician.activeCount} active job{technician.activeCount === 1 ? '' : 's'}
            {!technician.overCapacity && ` of ${technician.capacity} capacity`}
          </p>
        </div>
        {canEditCapacity &&
          (editing ? (
            <div className="flex shrink-0 items-center gap-1">
              <input
                type="number"
                min={0}
                step={1}
                className={`${inputClass} w-16 px-2 py-1`}
                value={draftCapacity}
                onChange={(e) => setDraftCapacity(e.target.value)}
                autoFocus
              />
              <button
                disabled={saving || draftCapacity === ''}
                onClick={() => {
                  const parsed = Number(draftCapacity);
                  if (!Number.isInteger(parsed) || parsed < 0) return;
                  onSaveCapacity(parsed);
                  setEditing(false);
                }}
                className="rounded border border-slate-900 bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                {saving ? '…' : 'Save'}
              </button>
              <button
                onClick={() => {
                  setDraftCapacity(String(technician.capacity));
                  setEditing(false);
                }}
                className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setDraftCapacity(String(technician.capacity));
                setEditing(true);
              }}
              className="shrink-0 rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Edit capacity
            </button>
          ))}
      </div>

      <div className="mt-3">
        <CapacityGauge activeCount={technician.activeCount} capacity={technician.capacity} overCapacity={technician.overCapacity} />
      </div>

      <ul className="mt-3 space-y-1.5">
        {technician.jobs.length === 0 && <li className="text-xs text-slate-300">No jobs queued</li>}
        {technician.jobs.map((job, i) => (
          <QueueJobRow key={job.id} job={job} position={i + 1} />
        ))}
      </ul>
    </div>
  );
}

function QueueJobRow({ job, position }: { job: WorkshopQueueJob; position: number }) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs">
      <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 font-medium text-slate-600">#{position}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-900">{job.jobCardNumber}</p>
        <p className="truncate text-slate-400">
          {job.faultCode}/{job.symptomCode} · {job.warrantyStatus.replaceAll('_', ' ')} · {job.status.replaceAll('_', ' ')}
        </p>
      </div>
    </li>
  );
}
