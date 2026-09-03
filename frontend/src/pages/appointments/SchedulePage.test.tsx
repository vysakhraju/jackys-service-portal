import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeAppointment, makeAppointmentDashboardStats } from '../../test/fixtures';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/appointmentsApi', () => ({
  assignTechnician: vi.fn(),
  cancelAppointment: vi.fn(),
  completeAppointment: vi.fn(),
  confirmAppointment: vi.fn(),
  createAppointment: vi.fn(),
  deleteAppointment: vi.fn(),
  getAppointmentDashboardStats: vi.fn(),
  getVisit: vi.fn(),
  listAppointments: vi.fn(),
  markAppointmentOnSite: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
import { getAppointmentDashboardStats, listAppointments } from '../../lib/appointmentsApi';
import { SchedulePage } from './SchedulePage';

// This page (unlike Finance/AMC) has no layout-level role gate at all - every logged-in
// user reaches it. Only the dashboard-stats widget it now renders is itself role-gated
// (DashboardStatsWidget checks canViewDashboardStats client-side), so most of this file's
// existing tests don't care who's logged in - default to a role that CAN see it so the
// widget's own query resolves quietly in the background rather than sitting disabled.
function mockUser(roleName = 'SUPER_ADMIN') {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'u1', firstName: 'T', lastName: 'U', email: 't@jackys.com', employeeId: 'E1', status: 'ACTIVE', lastLoginAt: null, role: { id: 'r1', name: roleName, displayName: roleName } },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
  } as any);
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listAppointments).mockReset();
  vi.mocked(getAppointmentDashboardStats).mockReset().mockResolvedValue(makeAppointmentDashboardStats());
  mockUser();
});

// Regression test for the-fool's most severe Frontend Phase 10 finding: an AMC-type,
// ON_SITE appointment used to show the same generic "Complete" button as everything else,
// which calls PUT /appointments/:id/complete and silently loses the visit's checklist/
// signature/extra-charge documentation forever (AmcService.completeVisit() refuses to run
// once status is already COMPLETED). The row action must instead be a link into the AMC
// module's own completion flow, and only for AMC rows - a non-AMC ON_SITE row must be
// completely unaffected.
describe('SchedulePage - AMC PM visit completion routing', () => {
  it('shows "Complete PM Visit ->" (not the generic Complete button) for an AMC-type ON_SITE row, linking to its contract', async () => {
    vi.mocked(listAppointments).mockResolvedValue({
      data: [
        makeAppointment({
          id: 'appt-amc-1',
          appointmentNumber: 'APT-0099',
          type: 'AMC',
          status: 'ON_SITE',
          amcContractId: 'contract-42',
        }),
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();

    await screen.findByText('APT-0099');

    const amcLink = screen.getByRole('link', { name: /Complete PM Visit/ });
    expect(amcLink).toHaveAttribute('href', '/amc/contracts?contractId=contract-42');
    expect(screen.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument();
  });

  it('still shows the generic Complete button for a non-AMC ON_SITE row, unaffected by the AMC routing', async () => {
    vi.mocked(listAppointments).mockResolvedValue({
      data: [
        makeAppointment({
          id: 'appt-oow-1',
          appointmentNumber: 'APT-0050',
          type: 'OUT_OF_WARRANTY',
          status: 'ON_SITE',
          amcContractId: null,
        }),
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();

    await screen.findByText('APT-0050');

    expect(screen.getByRole('button', { name: 'Complete' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Complete PM Visit/ })).not.toBeInTheDocument();
  });
});
