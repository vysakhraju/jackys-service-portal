import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeAppointmentDashboardStats } from '../../test/fixtures';

vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/appointmentsApi', () => ({
  getAppointmentDashboardStats: vi.fn(),
}));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { getAppointmentDashboardStats } from '../../lib/appointmentsApi';
import { DashboardStatsWidget } from './DashboardStatsWidget';

// 2026-09-14 (Group B): canViewDashboardStats() now gates on the real SCHEDULE_VIEW_UPDATE
// capability rather than a hardcoded DASHBOARD_STATS_ROLES array - see appointmentsTypes.ts's
// own comment. mockCapabilities replaces the old mockUser(roleName) role-array helper.
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

function renderWidget(
  serviceCentreId?: string,
  props: { activeStatus?: string; onSelectStatus?: (status: string) => void } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardStatsWidget serviceCentreId={serviceCentreId} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getAppointmentDashboardStats).mockReset();
});

describe('DashboardStatsWidget - capability gating', () => {
  it('never calls getAppointmentDashboardStats and renders nothing for a caller with no SCHEDULE_VIEW_UPDATE capability', () => {
    mockCapabilities([]);
    const { container } = renderWidget();
    expect(container).toBeEmptyDOMElement();
    expect(getAppointmentDashboardStats).not.toHaveBeenCalled();
  });

  it('fetches and renders stats for a full-access caller (SUPER_ADMIN/SERVICE_HEAD bypass)', async () => {
    mockCapabilities([], true);
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(makeAppointmentDashboardStats());
    renderWidget();

    await waitFor(() => expect(getAppointmentDashboardStats).toHaveBeenCalledWith(undefined));
    expect(await screen.findByText('2')).toBeInTheDocument(); // scheduled
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText('On Site')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  // req.txt Issue C - the 3 COLLECTED_TO_WS sub-stage tiles must always render, not just
  // the original 5, so a workshop-bound backlog is visible on this widget too.
  it('renders all 8 glance tiles, including the 3 COLLECTED_TO_WS sub-stages', async () => {
    mockCapabilities([], true);
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(
      makeAppointmentDashboardStats({
        today: { scheduled: 2, confirmed: 3, onSite: 1, completed: 4, cancelled: 0, collectedToWs: 5, markedReceived: 6, pendingJobCreation: 7 },
      }),
    );
    renderWidget();

    expect(await screen.findByText('Collected to WS')).toBeInTheDocument();
    expect(screen.getByText('Marked Received')).toBeInTheDocument();
    expect(screen.getByText('Pending Job Creation')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('fetches and renders stats for a role granted SCHEDULE_VIEW_UPDATE via Designation access, not just a default role', async () => {
    // The whole point of this round's fix: a role with no default membership in
    // SCHEDULE_VIEW_UPDATE sees the widget once Super Admin ticks the capability for
    // them - proven here by mocking the capability directly, independent of role name.
    mockCapabilities(['SCHEDULE_VIEW_UPDATE']);
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(makeAppointmentDashboardStats());
    renderWidget();

    await waitFor(() => expect(getAppointmentDashboardStats).toHaveBeenCalledWith(undefined));
    expect(await screen.findByText('2')).toBeInTheDocument(); // scheduled
  });
});

describe('DashboardStatsWidget - "last 7 days" accuracy (the-fool finding)', () => {
  it('labels the week figure "Last 7 days", never "This week" - the backend computes a rolling 7-day window, not a calendar week', async () => {
    mockCapabilities([], true);
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(makeAppointmentDashboardStats({ week: { total: 17, byStatus: {} } }));
    renderWidget();

    expect(await screen.findByText(/Last 7 days/)).toBeInTheDocument();
    expect(screen.getByText('17 appointments')).toBeInTheDocument();
    expect(screen.queryByText(/This week/i)).not.toBeInTheDocument();
  });

  it('uses singular "appointment" for a total of exactly 1', async () => {
    mockCapabilities([], true);
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(makeAppointmentDashboardStats({ week: { total: 1, byStatus: {} } }));
    renderWidget();

    expect(await screen.findByText('1 appointment')).toBeInTheDocument();
  });
});

describe('DashboardStatsWidget - service centre filter passthrough', () => {
  it('passes serviceCentreId through to the query when provided', async () => {
    mockCapabilities([], true);
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(makeAppointmentDashboardStats());
    renderWidget('sc-42');

    await waitFor(() => expect(getAppointmentDashboardStats).toHaveBeenCalledWith('sc-42'));
    expect(await screen.findByText(/filtered by service centre id/)).toBeInTheDocument();
  });

  it('passes undefined (not an empty string) when no serviceCentreId filter is set', async () => {
    mockCapabilities([], true);
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(makeAppointmentDashboardStats());
    renderWidget(undefined);

    await waitFor(() => expect(getAppointmentDashboardStats).toHaveBeenCalledWith(undefined));
  });
});

describe('DashboardStatsWidget - refetch policy (the-fool staleness finding)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refetches roughly every 60s rather than fetching once and going stale', async () => {
    mockCapabilities([], true);
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(makeAppointmentDashboardStats());
    renderWidget();

    await vi.waitFor(() => expect(getAppointmentDashboardStats).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(getAppointmentDashboardStats).toHaveBeenCalledTimes(2));
  });
});

// req.txt Issue D - clicking a glance box should drive SchedulePage's Status filter.
// DashboardStatsWidget itself is deliberately dumb about filtering/URL state - it just
// reports the clicked tile's status value up via onSelectStatus, same/toggle-off included.
describe('DashboardStatsWidget - click-to-filter (req.txt Issue D)', () => {
  it('reports the clicked tile\'s status value via onSelectStatus', async () => {
    mockCapabilities([], true);
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(makeAppointmentDashboardStats());
    const onSelectStatus = vi.fn();
    renderWidget(undefined, { onSelectStatus });

    fireEvent.click(await screen.findByText('Completed'));

    expect(onSelectStatus).toHaveBeenCalledWith('COMPLETED');
  });

  it('clicking the already-active tile again clears the filter (empty string)', async () => {
    mockCapabilities([], true);
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(makeAppointmentDashboardStats());
    const onSelectStatus = vi.fn();
    renderWidget(undefined, { activeStatus: 'COMPLETED', onSelectStatus });

    fireEvent.click(await screen.findByText('Completed'));

    expect(onSelectStatus).toHaveBeenCalledWith('');
  });

  it('marks the active tile with aria-pressed=true and every other tile aria-pressed=false', async () => {
    mockCapabilities([], true);
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(makeAppointmentDashboardStats());
    renderWidget(undefined, { activeStatus: 'CANCELLED' });

    const cancelledTile = (await screen.findByText('Cancelled')).closest('button')!;
    const scheduledTile = screen.getByText('Scheduled').closest('button')!;
    expect(cancelledTile).toHaveAttribute('aria-pressed', 'true');
    expect(scheduledTile).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows no "Clear filter" chip when no status is active', async () => {
    mockCapabilities([], true);
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(makeAppointmentDashboardStats());
    renderWidget();

    await screen.findByText('Scheduled');
    expect(screen.queryByText(/Clear filter/)).not.toBeInTheDocument();
  });

  it('shows a "Clear filter" chip when a status is active, and clicking it clears the filter', async () => {
    mockCapabilities([], true);
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(makeAppointmentDashboardStats());
    const onSelectStatus = vi.fn();
    renderWidget(undefined, { activeStatus: 'SCHEDULED', onSelectStatus });

    const clearChip = await screen.findByText(/Clear filter/);
    fireEvent.click(clearChip);
    expect(onSelectStatus).toHaveBeenCalledWith('');
  });
});
