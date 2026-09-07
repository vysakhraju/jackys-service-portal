import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeSlaBreachReport, makeSpareConsumptionReport, makeTechnicianProductivityReport } from '../../test/fixtures';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/reportsApi', () => ({
  getTechnicianProductivity: vi.fn(),
  getSlaBreach: vi.fn(),
  getSpareConsumption: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
import { getSlaBreach, getSpareConsumption, getTechnicianProductivity } from '../../lib/reportsApi';
import { OperationalReportsPage } from './OperationalReportsPage';

function mockUser(roleName: string) {
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
      <OperationalReportsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getTechnicianProductivity).mockReset().mockResolvedValue(makeTechnicianProductivityReport());
  vi.mocked(getSlaBreach).mockReset().mockResolvedValue(makeSlaBreachReport());
  vi.mocked(getSpareConsumption).mockReset().mockResolvedValue(makeSpareConsumptionReport());
});

describe('OperationalReportsPage - role gate', () => {
  it('shows a restricted message and fires no queries for a disallowed role', async () => {
    mockUser('ACCOUNTANT');
    renderPage();

    expect(await screen.findByText(/restricted to Service Head/)).toBeInTheDocument();
    expect(getTechnicianProductivity).not.toHaveBeenCalled();
    expect(getSlaBreach).not.toHaveBeenCalled();
    expect(getSpareConsumption).not.toHaveBeenCalled();
  });

  it.each(['SERVICE_HEAD', 'SUPER_ADMIN', 'TECHNICAL_TEAM_LEADER'])('permits %s', async (role) => {
    mockUser(role);
    renderPage();
    await screen.findByText('BRD 18.4 Operational Reports');
    expect(screen.queryByText(/restricted to Service Head/)).not.toBeInTheDocument();
  });
});

describe('OperationalReportsPage - widgets', () => {
  it('renders Technician Productivity without a customer-rating column', async () => {
    mockUser('SERVICE_HEAD');
    renderPage();
    expect(await screen.findByText('Test Technician')).toBeInTheDocument();
    // The report's own note explains the omission in prose ("Customer rating is not
    // captured...") - that's expected. What must NOT exist is an actual table column for
    // it, which would silently claim data nothing in this app tracks.
    expect(screen.queryByRole('columnheader', { name: /customer rating/i })).not.toBeInTheDocument();
  });

  it('defaults the SLA Breach threshold to 48h and re-fetches on change', async () => {
    mockUser('SERVICE_HEAD');
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/1 breached past 48h/)).toBeInTheDocument();
    expect(getSlaBreach).toHaveBeenCalledWith(48);

    const input = screen.getByLabelText('Threshold (hours)');
    await user.clear(input);
    await user.type(input, '24');

    await waitFor(() => expect(getSlaBreach).toHaveBeenLastCalledWith(24));
  });

  it('renders Spare Parts Consumption top-by-quantity and top-by-value lists', async () => {
    mockUser('SERVICE_HEAD');
    renderPage();
    expect(await screen.findByText('SP-001')).toBeInTheDocument();
    expect(screen.getByText('SP-002')).toBeInTheDocument();
  });
});
