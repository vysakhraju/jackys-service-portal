import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorNotice } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../lib/auth';
import { getDashboardOverview, getFirstTimeFixRate, getServiceEfficiency } from '../../lib/reportsApi';
import {
  KANBAN_COLUMNS,
  canViewReports,
  formatAsOf,
  type ApprovalAgingReport,
  type FirstTimeFixRateReport,
  type KanbanCard,
  type KanbanColumnData,
  type ReportsConnectionStatus,
  type ServiceEfficiencyReport,
} from '../../lib/reportsTypes';
import { useReportsSocket } from '../../lib/useReportsSocket';

// BRD 18.1 "Service Manager Dashboard" / FR-20 / NFR-02. The last frontend phase, and the
// first purely read-only one in the app - there's no create/update/delete anywhere on this
// page, so there's exactly one role check (can this user see the board at all), not the
// per-action fragmentation every earlier module needed its own *Permissions() helper for.
//
// This page's design carries all five of the-fool's pre-mortem mitigations for this phase:
//  1. useReportsSocket() re-reads the auth token fresh on every (re)connection attempt and
//     forces a token refresh before manually reconnecting after a server-initiated drop.
//  2. The connection status pill below never lets a dropped socket look like a quiet
//     moment - staleness is always visible, never silent.
//  3. Every card shows its own `asOf` (formatAsOf()), so "current" vs "a few seconds
//     behind" vs "this is a point-in-time report" is always legible, not implied.
//  4. Service Efficiency and First-Time Fix Rate - the two reports the backend's gateway
//     never pushes updates for - are fetched on their own, captured-at-fetch `asOf`, with
//     their own manual Refresh buttons, and are visually a distinct "report" style rather
//     than blending into the live feed above them.
//  5. The role gate runs before ANY network activity - no overview fetch, no socket
//     connect - for anyone outside REPORTS_VIEW_ROLES, via the `canView` checks below.
export function ReportsPage() {
  const { user } = useAuth();
  const canView = canViewReports(user?.role.name);

  const overviewQuery = useQuery({
    queryKey: ['reports', 'overview'],
    queryFn: getDashboardOverview,
    enabled: canView,
    // Purely a first-paint placeholder until the socket's own snapshot arrives (it sends
    // one immediately on every successful connect) - not refetched afterwards, since the
    // live section below is driven by the socket from that point on.
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });

  const { status, kanban, approvalAging } = useReportsSocket(canView);

  const serviceEfficiencyQuery = useQuery({
    queryKey: ['reports', 'service-efficiency'],
    queryFn: getServiceEfficiency,
    enabled: canView,
    refetchOnWindowFocus: false,
  });
  const firstTimeFixQuery = useQuery({
    queryKey: ['reports', 'first-time-fix-rate'],
    queryFn: getFirstTimeFixRate,
    enabled: canView,
    refetchOnWindowFocus: false,
  });

  if (!canView) {
    return (
      <div className="px-8 py-6">
        <p className="max-w-2xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          The live operations dashboard is restricted to Service Head / Super Admin /
          Technical Team Leader - every endpoint and the WebSocket channel behind it are
          role-gated server-side too.
        </p>
      </div>
    );
  }

  // Prefer the socket's own board (full job-card detail, live) once it's arrived; fall
  // back to the overview's counts-only summary (no jobCards yet) for the very first paint.
  const columns: KanbanColumnData[] = kanban
    ? kanban.columns
    : overviewQuery.data
      ? overviewQuery.data.kanbanSummary.columns.map((c) => ({ ...c, jobCards: [] }))
      : KANBAN_COLUMNS.map((key) => ({ key, label: key, count: 0, jobCards: [] }));
  const totalActiveJobs = kanban?.totalActiveJobs ?? overviewQuery.data?.kanbanSummary.totalActiveJobs ?? 0;
  const kanbanAsOf = kanban?.asOf ?? overviewQuery.data?.asOf;

  return (
    <div className="px-8 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Reports &amp; Dashboards
          </p>
          <h1 className="mt-0.5 text-xl font-semibold text-slate-900">
            Live Job Status Board
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Updates arrive within a few seconds of a status change, not instantly - this
            polls the backend every 5 seconds and only pushes when something actually
            changed. Approval aging refreshes every 15 minutes, matching BRD 18.1.
          </p>
        </div>
        <ConnectionPill status={status} asOf={kanbanAsOf} />
      </div>

      <ErrorNotice error={overviewQuery.error} />

      <div className="mt-5 flex items-center gap-4 text-sm text-slate-500">
        <span>
          <span className="font-semibold text-slate-900">{totalActiveJobs}</span> active jobs
        </span>
      </div>

      <div className="mt-3 overflow-x-auto pb-2">
        <div className="flex min-w-max gap-3">
          {columns.map((column) => (
            <KanbanColumn key={column.key} column={column} />
          ))}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <ApprovalAgingCard asOf={approvalAging?.asOf} report={approvalAging} />
        <ServiceEfficiencyCard
          data={serviceEfficiencyQuery.data}
          isFetching={serviceEfficiencyQuery.isFetching}
          error={serviceEfficiencyQuery.error}
          onRefresh={() => void serviceEfficiencyQuery.refetch()}
        />
        <FirstTimeFixRateCard
          data={firstTimeFixQuery.data}
          isFetching={firstTimeFixQuery.isFetching}
          error={firstTimeFixQuery.error}
          onRefresh={() => void firstTimeFixQuery.refetch()}
        />
      </div>
    </div>
  );
}

const STATUS_PILL: Record<ReportsConnectionStatus, { label: string; className: string; dot: string }> = {
  connecting: { label: 'Connecting…', className: 'bg-slate-100 text-slate-500', dot: 'bg-slate-400' },
  live: { label: 'Live', className: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  reconnecting: { label: 'Reconnecting…', className: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  offline: { label: 'Offline - live updates paused', className: 'bg-red-50 text-red-700', dot: 'bg-red-500' },
};

function ConnectionPill({ status, asOf }: { status: ReportsConnectionStatus; asOf: string | undefined }) {
  const pill = STATUS_PILL[status];
  return (
    <div className="flex flex-col items-end gap-1">
      <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${pill.className}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
        {pill.label}
      </span>
      <span className="text-xs text-slate-400">{formatAsOf(asOf)}</span>
    </div>
  );
}

function KanbanColumn({ column }: { column: KanbanColumnData }) {
  return (
    <div className="flex w-64 shrink-0 flex-col rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <span className="text-sm font-semibold text-slate-800">{column.label}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
          {column.count}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 py-2" style={{ maxHeight: '26rem' }}>
        {column.jobCards.length === 0 ? (
          <p className="px-1 py-2 text-xs text-slate-400">No jobs</p>
        ) : (
          column.jobCards.map((card) => <KanbanCardTile key={card.jobCardId} card={card} />)
        )}
      </div>
    </div>
  );
}

function KanbanCardTile({ card }: { card: KanbanCard }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-800">{card.jobCardNumber}</span>
        <StatusBadge status={card.warrantyStatus} />
      </div>
      <p className="mt-1 text-slate-500">
        {card.serialNumber}
        {card.brand ? ` · ${card.brand}` : ''}
      </p>
      {card.deliveryNumber && (
        <p className="mt-1 text-slate-400">Delivery {card.deliveryNumber}</p>
      )}
      <p className="mt-1 text-slate-400">
        Updated {new Date(card.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </p>
    </div>
  );
}

function ApprovalAgingCard({
  asOf,
  report,
}: {
  asOf: string | undefined;
  report: ApprovalAgingReport | null;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Pending Approval Aging</h2>
          <p className="text-xs text-slate-400">
            OOW estimates awaiting customer response - red past {report?.thresholdHours ?? 4}h
          </p>
        </div>
        <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
          Live
        </span>
      </div>
      <p className="mt-2 text-xs text-slate-400">{formatAsOf(asOf)}</p>
      {!report ? (
        <p className="mt-4 text-xs text-slate-400">Waiting for the live feed…</p>
      ) : report.items.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Nothing awaiting a response.</p>
      ) : (
        <ul className="mt-3 max-h-60 space-y-1.5 overflow-y-auto">
          {report.items.map((item) => (
            <li
              key={item.estimateId}
              className={`flex items-center justify-between rounded-md px-2 py-1.5 text-xs ${
                item.breached ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-600'
              }`}
            >
              <span className="font-medium">{item.jobCardNumber}</span>
              <span>{item.ageHours.toFixed(1)}h</span>
            </li>
          ))}
        </ul>
      )}
      {report && report.breachedCount > 0 && (
        <p className="mt-2 text-xs font-medium text-red-600">{report.breachedCount} past threshold</p>
      )}
    </div>
  );
}

function ReportCardShell({
  title,
  subtitle,
  asOf,
  isFetching,
  error,
  onRefresh,
  children,
}: {
  title: string;
  subtitle: string;
  asOf: string | undefined;
  isFetching: boolean;
  error: unknown;
  onRefresh: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <p className="text-xs text-slate-400">{subtitle}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
          Report
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-slate-400">{formatAsOf(asOf)}</p>
        <button
          onClick={onRefresh}
          disabled={isFetching}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
        >
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {error ? <ErrorNotice error={error} /> : null}
      {children}
    </div>
  );
}

function ServiceEfficiencyCard({
  data,
  isFetching,
  error,
  onRefresh,
}: {
  data: ServiceEfficiencyReport | undefined;
  isFetching: boolean;
  error: unknown;
  onRefresh: () => void;
}) {
  return (
    <ReportCardShell
      title="Service Efficiency"
      subtitle="Avg time Login → QC Completed"
      asOf={data?.asOf}
      isFetching={isFetching}
      error={error}
      onRefresh={onRefresh}
    >
      {!data || data.sampleSize === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No completed jobs yet.</p>
      ) : (
        <>
          <p className="mt-3 text-2xl font-semibold text-slate-900">
            {data.overallAvgHours?.toFixed(2)}
            <span className="ml-1 text-sm font-normal text-slate-400">avg hrs ({data.sampleSize} jobs)</span>
          </p>
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-400">By technician</p>
          <ul className="mt-1 space-y-1 text-xs text-slate-600">
            {data.byTechnician.slice(0, 5).map((row) => (
              <li key={row.key} className="flex items-center justify-between">
                <span>{row.label}</span>
                <span className="tabular-nums text-slate-400">
                  {row.avgHours.toFixed(2)}h ({row.jobCount})
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </ReportCardShell>
  );
}

function FirstTimeFixRateCard({
  data,
  isFetching,
  error,
  onRefresh,
}: {
  data: FirstTimeFixRateReport | undefined;
  isFetching: boolean;
  error: unknown;
  onRefresh: () => void;
}) {
  return (
    <ReportCardShell
      title="First-Time Fix Rate"
      subtitle="On-site-only completions / total completed"
      asOf={data?.asOf}
      isFetching={isFetching}
      error={error}
      onRefresh={onRefresh}
    >
      {!data || data.totalCompletedJobs === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No completed jobs yet.</p>
      ) : (
        <>
          <p className="mt-3 text-2xl font-semibold text-slate-900">
            {data.rate !== null ? `${(data.rate * 100).toFixed(1)}%` : '—'}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {data.onSiteOnlyCompletedJobs} of {data.totalCompletedJobs} completed jobs
          </p>
        </>
      )}
    </ReportCardShell>
  );
}
