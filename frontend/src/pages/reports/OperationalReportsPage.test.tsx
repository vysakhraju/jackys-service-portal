import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeSlaBreachReport, makeSpareConsumptionReport, makeTechnicianProductivityReport } from '../../test/fixtures';

// 2026-09-14 live-tested finding: moved from a hardcoded role list to the designation
// permission matrix's REPORTS_OPERATIONAL_VIEW capability - see ReportsPage.test.tsx's
// own comment for why (a Designation-access grant had no effect against a static list).
vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/reportsApi', () => ({
  getTechnicianProductivity: vi.fn(),
  getSlaBreach: vi.fn(),
  getSpareConsumption: vi.fn(),
}));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { getSlaBreach, getSpareConsumption, getTechnicianProductivity } from '../../lib/reportsApi';
import { OperationalReportsPage } from './OperationalReportsPage';

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

describe('OperationalReportsPage - access gate', () => {
  it('shows the access-denied notice and fires no queries for a role lacking REPORTS_OPERATIONAL_VIEW', async () => {
    mockCapabilities([]);
    renderPage();

    expect(await screen.findByText("You don't have access to Operational Reports yet.")).toBeInTheDocument();
    expect(getTechnicianProductivity).not.toHaveBeenCalled();
    expect(getSlaBreach).not.toHaveBeenCalled();
    expect(getSpareConsumption).not.toHaveBeenCalled();
  });

  it('permits a role holding REPORTS_OPERATIONAL_VIEW directly, and fullAccess separately', async () => {
    mockCapabilities(['REPORTS_OPERATIONAL_VIEW']);
    renderPage();
    await screen.findByText('BRD 18.4 Operational Reports');
    expect(screen.queryByText("You don't have access to Operational Reports yet.")).not.toBeInTheDocument();
  });

  it('permits fullAccess (SUPER_ADMIN/SERVICE_HEAD bypass) with an empty capability list', async () => {
    mockCapabilities([], true);
    renderPage();
    await screen.findByText('BRD 18.4 Operational Reports');
    expect(screen.queryByText("You don't have access to Operational Reports yet.")).not.toBeInTheDocument();
  });
});

describe('OperationalReportsPage - widgets', () => {
  it('renders Technician Productivity without a customer-rating column', async () => {
    mockCapabilities(['REPORTS_OPERATIONAL_VIEW']);
    renderPage();
    expect(await screen.findByText('Test Technician')).toBeInTheDocument();
    // The report's own note explains the omission in prose ("Customer rating is not
    // captured...") - that's expected. What must NOT exist is an actual table column for
    // it, which would silently claim data nothing in this app tracks.
    expect(screen.queryByRole('columnheader', { name: /customer rating/i })).not.toBeInTheDocument();
  });

  it('defaults the SLA Breach threshold to 48h and re-fetches on change', async () => {
    mockCapabilities(['REPORTS_OPERATIONAL_VIEW']);
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
    mockCapabilities(['REPORTS_OPERATIONAL_VIEW']);
    renderPage();
    expect(await screen.findByText('SP-001')).toBeInTheDocument();
    expect(screen.getByText('SP-002')).toBeInTheDocument();
  });
});
