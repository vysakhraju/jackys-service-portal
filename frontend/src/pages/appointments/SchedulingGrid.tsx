// New Appointment scheduling grid (2026-09-09) - "i want the appointment calender to be
// exact same as retra look and logic": a per-technician grid of tappable 15-minute chips
// (green = free, grey = "Busy"), replacing the old plain datetime-local input + a raw
// pasted technician id. Tapping a run of consecutive green chips on ONE technician picks
// that technician, the visit's start time, AND its duration (15 min × however many chips
// are selected) all in one motion - there's no separate "estimated duration" field to fill
// in any more, the chip count IS the duration.
//
// Hours come from GET /appointments/scheduling-grid, which reflects the selected Service
// Centre's own schedule for that weekday (not a fixed "Mon-Sat 08:00-16:00" constant - see
// appointment-scheduling-grid.util.ts on the backend for why: this app has no per-technician
// shift/roster table, only what ServiceCentre.schedule already stores). A chip is "Busy" for
// one of three reasons: it overlaps that technician's own existing appointment that day, it
// falls in the centre's break window, or the technician has already hit the daily cap
// (6 appointments) - in which case their whole row greys out even where the timeline still
// shows a gap.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSchedulingGrid } from '../../lib/appointmentsApi';
import { ErrorNotice } from '../../components/DataTable';
import { inputClass } from '../../components/Field';
import type { SchedulingGridTechnician } from '../../lib/appointmentsTypes';

export interface SchedulingSelection {
  technicianId: string;
  technicianName: string;
  scheduledAt: string;
  estimatedDurationMinutes: number;
}

interface Selection {
  technicianId: string;
  /** Where the tap-range started - stays fixed while extending/shrinking the same run;
   * only moves when a fresh selection starts (a different technician, or a tap on the far
   * side of a busy chip that breaks contiguity). */
  anchorIdx: number;
  endIdx: number;
}

function formatHour(time: string): string {
  const [hStr, mStr] = time.split(':');
  const h = Number(hStr);
  if (mStr !== '00') return '';
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${ampm}`;
}

// Whether every slot between the anchor and a candidate index (inclusive, in either
// direction) is available - i.e. whether extending/shrinking the current run to include
// `idx` is actually a valid contiguous green run, not one that would jump over a busy chip.
function isContiguousFreeRun(slots: { available: boolean }[], anchorIdx: number, idx: number): boolean {
  const lo = Math.min(anchorIdx, idx);
  const hi = Math.max(anchorIdx, idx);
  for (let i = lo; i <= hi; i++) {
    if (!slots[i]?.available) return false;
  }
  return true;
}

export function SchedulingGridPicker({
  serviceCentreId,
  date,
  onDateChange,
  onChange,
}: {
  serviceCentreId: string;
  date: string;
  onDateChange: (date: string) => void;
  onChange: (value: SchedulingSelection | null) => void;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);

  const gridQuery = useQuery({
    queryKey: ['appointments', 'scheduling-grid', serviceCentreId, date],
    queryFn: () => getSchedulingGrid(serviceCentreId, date),
    enabled: !!serviceCentreId && !!date,
  });

  // A selection made against one service centre/date stops meaning anything once either
  // changes (the grid it was picked from no longer exists) - clear it rather than silently
  // submitting a stale technician/time pairing from a previous grid.
  useEffect(() => {
    setSelection(null);
    onChange(null);
    // onChange is a fresh closure from the parent's render, not a dependency of "did the
    // grid identity change" - only serviceCentreId/date actually mean that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceCentreId, date]);

  function selectChip(tech: SchedulingGridTechnician, idx: number) {
    const slot = tech.slots[idx];
    if (!slot.available) return;

    const next: Selection =
      selection && selection.technicianId === tech.id && isContiguousFreeRun(tech.slots, selection.anchorIdx, idx)
        ? { technicianId: tech.id, anchorIdx: selection.anchorIdx, endIdx: idx }
        : { technicianId: tech.id, anchorIdx: idx, endIdx: idx };
    setSelection(next);

    const lo = Math.min(next.anchorIdx, next.endIdx);
    const hi = Math.max(next.anchorIdx, next.endIdx);
    onChange({
      technicianId: tech.id,
      technicianName: tech.name,
      scheduledAt: tech.slots[lo].iso,
      estimatedDurationMinutes: (hi - lo + 1) * 15,
    });
  }

  function clearSelection() {
    setSelection(null);
    onChange(null);
  }

  if (!serviceCentreId) {
    return <p className="rounded-md border border-dashed border-slate-200 p-4 text-sm text-slate-400">Paste a service centre id above to see technician availability.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Date</span>
          <input type="date" className={`${inputClass} w-40`} value={date} onChange={(e) => onDateChange(e.target.value)} />
        </label>
        {gridQuery.data && (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
            {gridQuery.data.rosterLabel} <span className="text-slate-400">Roster</span>
          </p>
        )}
        {selection && (
          <button type="button" onClick={clearSelection} className="text-xs font-medium text-slate-400 underline underline-offset-2 hover:text-slate-600">
            Clear selection
          </button>
        )}
      </div>

      {gridQuery.isLoading && <p className="text-sm text-slate-400">Loading availability…</p>}
      {gridQuery.error && <ErrorNotice error={gridQuery.error} />}

      {gridQuery.data && !gridQuery.data.isOpen && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          This service centre is closed on this date - pick a different date.
        </p>
      )}

      {gridQuery.data && gridQuery.data.isOpen && gridQuery.data.technicians.length === 0 && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
          No field technicians are assigned to this service centre yet - assign some from Master Data first.
        </p>
      )}

      {gridQuery.data && gridQuery.data.isOpen && gridQuery.data.technicians.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="w-40 shrink-0 border-b border-slate-100 bg-slate-50 p-2 text-left font-medium text-slate-500">Technician</th>
                {gridQuery.data.technicians[0].slots.map((s) => (
                  <th key={s.time} className="border-b border-slate-100 bg-slate-50 px-0.5 py-1 text-center font-normal text-slate-400">
                    {formatHour(s.time)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gridQuery.data.technicians.map((tech) => (
                <tr key={tech.id} className="border-b border-slate-50 last:border-0">
                  <td className="p-2 align-middle">
                    <p className="font-medium text-slate-900">{tech.name}</p>
                    {tech.atDailyCap ? (
                      <p className="text-[10px] font-medium text-red-500">At daily cap ({tech.appointmentCount} today)</p>
                    ) : (
                      <p className="text-[10px] text-slate-400">{tech.appointmentCount} today</p>
                    )}
                  </td>
                  {tech.slots.map((slot, idx) => {
                    const inSelection =
                      selection &&
                      selection.technicianId === tech.id &&
                      idx >= Math.min(selection.anchorIdx, selection.endIdx) &&
                      idx <= Math.max(selection.anchorIdx, selection.endIdx);
                    return (
                      <td key={slot.time} className="p-0.5 text-center">
                        <button
                          type="button"
                          disabled={!slot.available}
                          onClick={() => selectChip(tech, idx)}
                          title={`${tech.name} · ${slot.time}${slot.available ? '' : ' · Busy'}`}
                          data-testid={`chip-${tech.id}-${slot.time}`}
                          className={`h-6 w-6 rounded border text-[9px] ${
                            inSelection
                              ? 'border-sky-600 bg-sky-500 text-white'
                              : slot.available
                                ? 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100'
                                : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-300'
                          }`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400">Tap consecutive green chips on one technician - total visit length = number of 15-min slots.</p>
    </div>
  );
}
