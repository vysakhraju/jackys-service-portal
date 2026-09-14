// #218/#250: a shared technician name-list source for NamePicker call sites (SchedulePage's
// Assign Technician modal + filters, ContractsPage's assigned-technician field, WorkshopPage's
// assign-technician form). There is deliberately no new backend endpoint here - unlike
// Driver/Approver (#246/#247), which had zero accessible source and needed one built,
// GET /technician-schedule/gantt already lists every active field+workshop technician by
// name (technicianId/technicianName/role), it's just gated TECHNICIAN_SCHEDULE_GANTT
// (Team Leader only). Reusing it means this picker works out of the box for TL (e.g.
// WorkshopPage's assign-technician form, itself WORKSHOP_ASSIGN/TL-gated), and gracefully
// degrades to the old raw-paste input for any other role it 403s for (e.g. CCE on
// SchedulePage) - see useTechnicianOptions()'s `accessible` flag.
import { useQuery } from '@tanstack/react-query';
import { getGanttBoard } from './technicianScheduleApi';
import type { NamePickerOption } from '../components/pickers/NamePicker';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function useTechnicianOptions(roleFilter?: 'TECHNICIAN_FIELD' | 'TECHNICIAN_WORKSHOP'): {
  options: NamePickerOption[];
  loading: boolean;
  /** false once the gantt board request has failed (typically a 403 for non-TL roles) -
   * callers should fall back to a raw-paste input rather than show a picker with no data. */
  accessible: boolean;
} {
  const query = useQuery({
    queryKey: ['technician-options', 'gantt-board-for-picker'],
    queryFn: () => getGanttBoard(todayIso()),
    retry: false,
    staleTime: 60_000,
  });

  const options = (query.data?.rows ?? [])
    .filter((row) => !roleFilter || row.role === roleFilter)
    .map((row) => ({ id: row.technicianId, name: row.technicianName }));

  return {
    options,
    loading: query.isLoading,
    accessible: !query.isError,
  };
}
