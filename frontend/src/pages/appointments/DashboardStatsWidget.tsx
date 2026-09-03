import { useQuery } from '@tanstack/react-query';
import { COLOR_BY_STATUS } from '../../components/StatusBadge';
import { useAuth } from '../../lib/auth';
import { getAppointmentDashboardStats } from '../../lib/appointmentsApi';
import { canViewDashboardStats } from '../../lib/appointmentsTypes';

const TODAY_TILES: { key: 'scheduled' | 'confirmed' | 'onSite' | 'completed' | 'cancelled'; label: string; statusColor: string }[] = [
  { key: 'scheduled', label: 'Scheduled', statusColor: 'SCHEDULED' },
  { key: 'confirmed', label: 'Confirmed', statusColor: 'CONFIRMED' },
  { key: 'onSite', label: 'On Site', statusColor: 'ON_SITE' },
  { key: 'completed', label: 'Completed', statusColor: 'COMPLETED' },
  { key: 'cancelled', label: 'Cancelled', statusColor: 'CANCELLED' },
];

// GET /appointments/dashboard/stats - typed on the frontend since an earlier phase
// (getAppointmentDashboardStats / AppointmentDashboardStats) but never wired to a screen
// until now (STATUS_TRACKER's "known issues to fix later" list). Gated client-side exactly
// like every other role-restricted query in this app (Finance, Reports): a role outside
// canViewDashboardStats() never even constructs this query, not just refused server-side.
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
export function DashboardStatsWidget({ serviceCentreId }: { serviceCentreId?: string }) {
  const { user } = useAuth();
  const canView = canViewDashboardStats(user?.role.name);

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

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Today at a glance</p>
        <p className="text-xs text-slate-400">
          Last 7 days: <span className="font-medium text-slate-600">{week.total} appointment{week.total === 1 ? '' : 's'}</span>
          {serviceCentreId ? ' (filtered by service centre id above)' : ''}
        </p>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {TODAY_TILES.map((tile) => {
          const colorClass = COLOR_BY_STATUS[tile.statusColor] ?? 'bg-slate-100 text-slate-600';
          return (
            <div key={tile.key} className={`rounded-md px-3 py-2 ${colorClass}`}>
              <p className="text-lg font-semibold leading-tight">{today[tile.key]}</p>
              <p className="text-xs font-medium opacity-80">{tile.label}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
