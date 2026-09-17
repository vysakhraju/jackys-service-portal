import { useQuery } from '@tanstack/react-query';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { getAppointmentDashboardStats } from '../../lib/appointmentsApi';
import { canViewDashboardStats, GLANCE_TILES, type EffectiveAppointmentStatusValue } from '../../lib/appointmentsTypes';

// req.txt Issue C - distinct, accessible color per glance box. Deliberately its own palette
// rather than StatusBadge's shared COLOR_BY_STATUS: the user's brief specifies exact colors
// for this one widget (e.g. teal for Collected to WS, where the appointment table's own
// badge stays violet), and reusing COLOR_BY_STATUS here would either fight that brief or
// require changing the badge color everywhere else COLLECTED_TO_WS appears.
const TILE_COLOR: Record<string, string> = {
  SCHEDULED: 'bg-slate-100 text-slate-700',
  CONFIRMED: 'bg-sky-50 text-sky-700',
  ON_SITE: 'bg-amber-50 text-amber-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  CANCELLED: 'bg-red-50 text-red-700',
  COLLECTED_TO_WS: 'bg-teal-50 text-teal-700',
  MARKED_RECEIVED: 'bg-purple-50 text-purple-700',
  PENDING_JOB_CREATION: 'bg-orange-50 text-orange-700',
};

// GET /appointments/dashboard/stats - typed on the frontend since an earlier phase
// (getAppointmentDashboardStats / AppointmentDashboardStats) but never wired to a screen
// until now (STATUS_TRACKER's "known issues to fix later" list). Gated client-side on the
// real SCHEDULE_VIEW_UPDATE capability (via canViewDashboardStats(), converted 2026-09-14):
// a caller without it never even constructs this query, not just refused server-side.
//
// Two the-fool pre-mortem findings baked in: (1) the backend's "week" is a rolling 7-day
// window ending today, not a calendar week (see AppointmentDashboardStats's own doc
// comment) - labelled "Last 7 days" here, deliberately not "This week", so it can't be
// misread against a manual count of the table below. (2) no refetch policy would let a
// long-open tab show a stale "Today" count well into the next day - refetchInterval below
// overrides this app's usual refetchOnWindowFocus:false/no-polling default specifically for
// this widget, since a live-feeling dashboard tile is exactly the case that default doesn't
// fit (Reports' own Kanban board uses a websocket for the same reason; a 60s poll is the
// low-effort equivalent for a plain REST stat query that doesn't warrant its own socket).
//
// req.txt (2026-09-17) Issues A/C/D fixed on this pass:
//   A - counters were already computed from this separate, unfiltered-by-the-list backend
//       query (not a client-side array) - the missing piece was recounting after a
//       create/update/delete, which SchedulePage's shared `invalidate()` now covers by also
//       invalidating this widget's own query key.
//   C - all 8 statuses now shown (5 real + the 3 COLLECTED_TO_WS sub-stages), in a
//       responsive auto-fit grid so boxes wrap instead of overlapping at narrow widths.
//   D - every tile is now a clickable, keyboard-operable button: `onSelectStatus` reports
//       the clicked tile's status value (or '' to clear, when the SAME tile that's already
//       active is clicked again) back up to SchedulePage, which drives the Status filter/URL.
export function DashboardStatsWidget({
  serviceCentreId,
  activeStatus = '',
  onSelectStatus,
}: {
  serviceCentreId?: string;
  /** The Status filter's current value, so the matching tile can render as "active". */
  activeStatus?: string;
  /** Called with the clicked tile's status value, or '' when the active tile is clicked again (clear). */
  onSelectStatus?: (status: EffectiveAppointmentStatusValue | '') => void;
}) {
  const { has } = useMyCapabilities();
  const canView = canViewDashboardStats(has);

  const query = useQuery({
    queryKey: ['appointment-dashboard-stats', serviceCentreId],
    queryFn: () => getAppointmentDashboardStats(serviceCentreId || undefined),
    enabled: canView,
    refetchInterval: 60_000,
  });

  if (!canView) return null;
  if (query.isLoading) {
    return <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-400">Loading today's stats…</div>;
  }
  if (query.error || !query.data) return null;

  const { today, week } = query.data;

  function handleTileClick(statusValue: EffectiveAppointmentStatusValue) {
    if (!onSelectStatus) return;
    onSelectStatus(activeStatus === statusValue ? '' : statusValue);
  }

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Today at a glance</p>
          {activeStatus ? (
            <button
              type="button"
              onClick={() => onSelectStatus?.('')}
              className="rounded-full border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700"
            >
              ✕ Clear filter
            </button>
          ) : null}
        </div>
        <p className="text-xs text-slate-400">
          Last 7 days: <span className="font-medium text-slate-600">{week.total} appointment{week.total === 1 ? '' : 's'}</span>
          {serviceCentreId ? ' (filtered by service centre id above)' : ''}
        </p>
      </div>
      {/* req.txt Issue C - repeat(auto-fit, minmax(160px, 1fr)) so tiles reflow to however
          many columns fit rather than overlapping at narrow widths, unlike the old fixed
          sm:grid-cols-5. */}
      <div className="mt-2 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        {GLANCE_TILES.map((tile) => {
          const value = today[tile.key];
          const colorClass = TILE_COLOR[tile.statusValue] ?? 'bg-slate-100 text-slate-600';
          const isActive = activeStatus === tile.statusValue;
          return (
            <button
              key={tile.key}
              type="button"
              onClick={() => handleTileClick(tile.statusValue)}
              aria-pressed={isActive}
              title={`Filter the list to ${tile.label}`}
              className={`min-w-0 rounded-md px-3 py-2 text-left transition ${colorClass} ${
                isActive ? 'ring-2 ring-offset-1 ring-slate-500' : 'hover:brightness-95'
              } ${onSelectStatus ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <p className="text-lg font-semibold leading-tight tabular-nums">{value}</p>
              <p className="text-xs font-medium leading-snug opacity-80" style={{ overflowWrap: 'break-word' }}>{tile.label}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
