import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

function renderWidget(serviceCentreId?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardStatsWidget serviceCentreId={serviceCentreId} />
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
