import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  makeApprovalAgingReport,
  makeDashboardOverview,
  makeFirstTimeFixRateReport,
  makeKanbanBoard,
  makeServiceEfficiencyReport,
} from '../../test/fixtures';

// 2026-09-14 live-tested finding: this page's access gate moved from a hardcoded
// REPORTS_VIEW_ROLES role list to the designation permission matrix's
// REPORTS_DASHBOARD_VIEW capability (useMyCapabilities()) - a Super Admin granting it via
// Designation access had no effect while the page still checked a static role list. Tests
// below mock the capability directly rather than a role name.
vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/reportsApi', () => ({
  getDashboardOverview: vi.fn(),
  getServiceEfficiency: vi.fn(),
  getFirstTimeFixRate: vi.fn(),
}));
vi.mock('../../lib/useReportsSocket', () => ({ useReportsSocket: vi.fn() }));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { getDashboardOverview, getFirstTimeFixRate, getServiceEfficiency } from '../../lib/reportsApi';
import { useReportsSocket } from '../../lib/useReportsSocket';
import { ReportsPage } from './ReportsPage';

function mockCapabilities(capabilities: string[], fullAccess = false) {
  vi.mocked(useMyCapabilities).mockReturnValue({
    loading: false,
    error: null,
    fullAccess,
    capabilities,
    has: (key: string) => fullAccess || capabilities.includes(key),
    hasAny: (keys: string[]) => fullAccess || keys.some((k) => capabilities.includes(k)),
  });
}

function mockSocket(overrides: Partial<ReturnType<typeof useReportsSocket>> = {}) {
  vi.mocked(useReportsSocket).mockReturnValue({
    status: 'connecting',
    kanban: null,
    approvalAging: null,
    ...overrides,
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReportsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getDashboardOverview).mockReset().mockResolvedValue(makeDashboardOverview());
  vi.mocked(getServiceEfficiency).mockReset().mockResolvedValue(makeServiceEfficiencyReport());
  vi.mocked(getFirstTimeFixRate).mockReset().mockResolvedValue(makeFirstTimeFixRateReport());
  vi.mocked(useReportsSocket).mockReset();
  mockSocket();
});

describe('ReportsPage - access gate', () => {
  it('shows the access-denied notice and fires no queries or socket connection for a role lacking REPORTS_DASHBOARD_VIEW', async () => {
    mockCapabilities([]);
    renderPage();

    expect(await screen.findByText("You don't have access to the Live Job Status Board yet.")).toBeInTheDocument();
    expect(getDashboardOverview).not.toHaveBeenCalled();
    expect(getServiceEfficiency).not.toHaveBeenCalled();
    expect(getFirstTimeFixRate).not.toHaveBeenCalled();
    // The page must pass `false` through to the socket hook for a disallowed role - the
    // hook itself (see useReportsSocket.test.ts) guarantees `enabled: false` never opens
    // a connection.
    expect(useReportsSocket).toHaveBeenCalledWith(false);
  });

  it('does not show the access-denied notice once REPORTS_DASHBOARD_VIEW is held, and enables the socket', async () => {
    mockCapabilities(['REPORTS_DASHBOARD_VIEW']);
    renderPage();

    await screen.findByText('Live Job Status Board');
    expect(screen.queryByText("You don't have access to the Live Job Status Board yet.")).not.toBeInTheDocument();
    expect(useReportsSocket).toHaveBeenCalledWith(true);
  });

  it('also permits fullAccess (SUPER_ADMIN/SERVICE_HEAD bypass) with an empty capability list', async () => {
    mockCapabilities([], true);
    renderPage();
    await screen.findByText('Live Job Status Board');
    expect(screen.queryByText("You don't have access to the Live Job Status Board yet.")).not.toBeInTheDocument();
  });
});

describe('ReportsPage - connection pill', () => {
  it('shows "Live" when the socket status is live', async () => {
    mockCapabilities(['REPORTS_DASHBOARD_VIEW']);
    mockSocket({ status: 'live', kanban: makeKanbanBoard() });
    renderPage();
    // 'Live' also appears as the Approval Aging card's "data source" tag, so this must be
    // scoped to the connection pill itself (identified by its emerald "live" styling) -
    // not just any element with this text.
    expect(await screen.findByText('Live', { selector: '.text-emerald-700' })).toBeInTheDocument();
  });

  it('shows the offline message when the socket status is offline', async () => {
    mockCapabilities(['REPORTS_DASHBOARD_VIEW']);
    mockSocket({ status: 'offline' });
    renderPage();
    expect(await screen.findByText(/Offline - live updates paused/)).toBeInTheDocument();
  });

  it('shows "Reconnecting…" when the socket status is reconnecting', async () => {
    mockCapabilities(['REPORTS_DASHBOARD_VIEW']);
    mockSocket({ status: 'reconnecting' });
    renderPage();
    expect(await screen.findByText('Reconnecting…')).toBeInTheDocument();
  });
});

describe('ReportsPage - Kanban board', () => {
  it("renders counts-only columns from the overview summary before the socket's board arrives", async () => {
    mockCapabilities(['REPORTS_DASHBOARD_VIEW']);
    mockSocket({ status: 'live', kanban: null });
    renderPage();

    // The overview fixture has 1 job in WIP and 0 everywhere else - but with no socket
    // board yet, no actual job-card tile should render (the summary carries counts only).
    await screen.findByText('WIP');
    expect(screen.queryByText('JC-0001')).not.toBeInTheDocument();
  });

  it('switches to the full board (with job cards) once the socket delivers one', async () => {
    mockCapabilities(['REPORTS_DASHBOARD_VIEW']);
    mockSocket({ status: 'live', kanban: makeKanbanBoard() });
    renderPage();

    expect(await screen.findByText('JC-0001')).toBeInTheDocument();
  });
});

describe('ReportsPage - Approval Aging', () => {
  it('shows a waiting message before any approval-aging:update has arrived', async () => {
    mockCapabilities(['REPORTS_DASHBOARD_VIEW']);
    mockSocket({ status: 'live', approvalAging: null });
    renderPage();
    expect(await screen.findByText('Waiting for the live feed…')).toBeInTheDocument();
  });

  it('renders items and a breached-count summary once data arrives', async () => {
    mockCapabilities(['REPORTS_DASHBOARD_VIEW']);
    mockSocket({ status: 'live', approvalAging: makeApprovalAgingReport() });
    renderPage();

    expect(await screen.findByText('JC-0001')).toBeInTheDocument();
    expect(await screen.findByText('1 past threshold')).toBeInTheDocument();
  });
});

describe('ReportsPage - Service Efficiency', () => {
  it('shows a zero-state when sampleSize is 0', async () => {
    mockCapabilities(['REPORTS_DASHBOARD_VIEW']);
    vi.mocked(getServiceEfficiency).mockResolvedValue(
      makeServiceEfficiencyReport({ sampleSize: 0, overallAvgHours: null, byTechnician: [], byCategory: [] }),
    );
    renderPage();
    expect(await screen.findAllByText('No completed jobs yet.')).not.toHaveLength(0);
  });

  it('renders the overall average and technician breakdown when data is present', async () => {
    mockCapabilities(['REPORTS_DASHBOARD_VIEW']);
    renderPage();
    expect(await screen.findByText('Test Technician')).toBeInTheDocument();
    // The fixture's overall average and its (only) technician's average happen to be the
    // same number, so this must be scoped to the headline stat specifically, not the
    // per-technician breakdown line below it.
    expect(screen.getByText(/3\.50/, { selector: '.text-2xl' })).toBeInTheDocument();
  });

  it('clicking Refresh re-fetches Service Efficiency', async () => {
    mockCapabilities(['REPORTS_DASHBOARD_VIEW']);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Service Efficiency');

    // The button reads "Refreshing…" while the initial fetch is still in flight, so wait
    // for it to settle into "Refresh" rather than grabbing it synchronously.
    const buttons = await screen.findAllByRole('button', { name: 'Refresh' });
    await user.click(buttons[0]);

    await waitFor(() => expect(getServiceEfficiency).toHaveBeenCalledTimes(2));
  });
});

describe('ReportsPage - First-Time Fix Rate', () => {
  it('shows a zero-state when totalCompletedJobs is 0', async () => {
    mockCapabilities(['REPORTS_DASHBOARD_VIEW']);
    vi.mocked(getFirstTimeFixRate).mockResolvedValue(
      makeFirstTimeFixRateReport({ totalCompletedJobs: 0, onSiteOnlyCompletedJobs: 0, rate: null }),
    );
    renderPage();
    expect(await screen.findAllByText('No completed jobs yet.')).not.toHaveLength(0);
  });

  it('renders the rate as a percentage when data is present', async () => {
    mockCapabilities(['REPORTS_DASHBOARD_VIEW']);
    renderPage();
    expect(await screen.findByText('60.0%')).toBeInTheDocument();
    expect(screen.getByText('6 of 10 completed jobs')).toBeInTheDocument();
  });

  it('clicking Refresh re-fetches First-Time Fix Rate', async () => {
    mockCapabilities(['REPORTS_DASHBOARD_VIEW']);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('First-Time Fix Rate');

    // Same "Refreshing…" -> "Refresh" settling issue as the Service Efficiency card above.
    const buttons = await screen.findAllByRole('button', { name: 'Refresh' });
    await user.click(buttons[1]);

    await waitFor(() => expect(getFirstTimeFixRate).toHaveBeenCalledTimes(2));
  });
});
