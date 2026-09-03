import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeAppointmentDashboardStats } from '../../test/fixtures';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/appointmentsApi', () => ({
  getAppointmentDashboardStats: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
import { getAppointmentDashboardStats } from '../../lib/appointmentsApi';
import { DashboardStatsWidget } from './DashboardStatsWidget';

function mockUser(roleName: string | undefined) {
  vi.mocked(useAuth).mockReturnValue({
    user: roleName
      ? { id: 'u1', firstName: 'T', lastName: 'U', email: 't@jackys.com', employeeId: 'E1', status: 'ACTIVE', lastLoginAt: null, role: { id: 'r1', name: roleName, displayName: roleName } }
      : null,
    isLoading: false,
    isAuthenticated: !!roleName,
    login: vi.fn(),
    logout: vi.fn(),
  } as any);
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

describe('DashboardStatsWidget - role gating', () => {
  it('never calls getAppointmentDashboardStats and renders nothing for a role outside canViewDashboardStats', () => {
    mockUser('TECHNICIAN_FIELD');
    const { container } = renderWidget();
    expect(container).toBeEmptyDOMElement();
    expect(getAppointmentDashboardStats).not.toHaveBeenCalled();
  });

  it('never calls getAppointmentDashboardStats for an unauthenticated user', () => {
    mockUser(undefined);
    const { container } = renderWidget();
    expect(container).toBeEmptyDOMElement();
    expect(getAppointmentDashboardStats).not.toHaveBeenCalled();
  });

  it('fetches and renders stats for an allowed role (SERVICE_HEAD)', async () => {
    mockUser('SERVICE_HEAD');
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
});

describe('DashboardStatsWidget - "last 7 days" accuracy (the-fool finding)', () => {
  it('labels the week figure "Last 7 days", never "This week" - the backend computes a rolling 7-day window, not a calendar week', async () => {
    mockUser('SUPER_ADMIN');
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(makeAppointmentDashboardStats({ week: { total: 17, byStatus: {} } }));
    renderWidget();

    expect(await screen.findByText(/Last 7 days/)).toBeInTheDocument();
    expect(screen.getByText('17 appointments')).toBeInTheDocument();
    expect(screen.queryByText(/This week/i)).not.toBeInTheDocument();
  });

  it('uses singular "appointment" for a total of exactly 1', async () => {
    mockUser('SUPER_ADMIN');
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(makeAppointmentDashboardStats({ week: { total: 1, byStatus: {} } }));
    renderWidget();

    expect(await screen.findByText('1 appointment')).toBeInTheDocument();
  });
});

describe('DashboardStatsWidget - service centre filter passthrough', () => {
  it('passes serviceCentreId through to the query when provided', async () => {
    mockUser('SUPER_ADMIN');
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(makeAppointmentDashboardStats());
    renderWidget('sc-42');

    await waitFor(() => expect(getAppointmentDashboardStats).toHaveBeenCalledWith('sc-42'));
    expect(await screen.findByText(/filtered by service centre id/)).toBeInTheDocument();
  });

  it('passes undefined (not an empty string) when no serviceCentreId filter is set', async () => {
    mockUser('SUPER_ADMIN');
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
    mockUser('SUPER_ADMIN');
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(makeAppointmentDashboardStats());
    renderWidget();

    await vi.waitFor(() => expect(getAppointmentDashboardStats).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(getAppointmentDashboardStats).toHaveBeenCalledTimes(2));
  });
});
