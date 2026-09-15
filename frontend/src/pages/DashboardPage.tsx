// Dashboard section modification (2026-09-15): the old page (a static "welcome" header +
// 6 user-detail InfoCards + a "Frontend build progress" checklist) is gone entirely per
// requirements #1/#2 of that request - the user-details grid moved into the new top-right
// UserMenu popup (see AppLayout.tsx), and the build-progress checklist was just deleted, it
// served no purpose once the app was actually built. What replaces it is a real,
// role-gated, interactive operational dashboard (#3/#4/#5/#6/#7) built from
// GET /dashboard/overview - each widget below renders only if the backend actually included
// it (DashboardService's own per-widget capability check - see that file's doc comment), so
// a plain technician with none of the four DASHBOARD_WIDGET_* grants sees a clean empty
// state, never a wall of "access denied" cards.
//
// Deliberately reuses Reports & Dashboards' own underlying data (Kanban summary, SLA
// breach, spare consumption) and the Workshop Queue board's data, but is its own new
// screen - the user's own locked decision was "leave Reports untouched", not a new tab
// inside it. Every widget click navigates to the existing page that already shows that
// data in full (Kanban board / Workshop Queue / Operational Reports) rather than
// duplicating filtering logic here - see this file's own widget components for exactly
// which page each one targets.
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { getDashboardOverview } from '../lib/dashboardApi';
import {
  JobsByStatusChart,
  WorkshopQueueChart,
  SlaBreachCard,
  SpareConsumptionChart,
} from '../components/dashboard/DashboardWidgets';

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const overviewQuery = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: getDashboardOverview,
    // Same live-updating reasoning as the Workshop page's own 15s poll (App.tsx's
    // QueryClient disables refetchOnWindowFocus app-wide) - a dashboard that only updates on
    // a manual reload defeats the point of a landing-page "what's happening right now" view.
    refetchInterval: 30_000,
  });

  const widgets = overviewQuery.data?.widgets ?? {};
  const hasAnyWidget = Object.keys(widgets).length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-8 py-8">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Welcome, {user?.firstName}</h1>
        <p className="mt-1 text-sm text-slate-500">Here's what's happening across the shop floor right now.</p>
      </div>

      {overviewQuery.isLoading && <p className="text-sm text-slate-400">Loading your dashboard…</p>}

      {overviewQuery.data && !hasAnyWidget && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
          No dashboard widgets are enabled for your role yet - ask a Super Admin to grant one
          under Users → Designation Access → Dashboard.
        </div>
      )}

      {(widgets.jobsByStatus || widgets.workshopQueue) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {widgets.jobsByStatus && (
            <JobsByStatusChart data={widgets.jobsByStatus} onOpenReports={() => navigate('/reports')} />
          )}
          {widgets.workshopQueue && (
            <WorkshopQueueChart
              data={widgets.workshopQueue}
              onOpen={() => navigate('/technician-schedule/workshop-queue')}
            />
          )}
        </div>
      )}

      {(widgets.slaBreach || widgets.spareConsumption) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {widgets.slaBreach && (
            <SlaBreachCard
              data={widgets.slaBreach}
              onOpen={() => navigate('/reports/operational')}
              onOpenJob={(jobCardId) => navigate(`/job-cards/journey?jobCardId=${jobCardId}`)}
            />
          )}
          {widgets.spareConsumption && (
            <SpareConsumptionChart data={widgets.spareConsumption} onOpen={() => navigate('/reports/operational')} />
          )}
        </div>
      )}
    </div>
  );
}
