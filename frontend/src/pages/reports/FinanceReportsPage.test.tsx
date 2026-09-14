import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  makeFinanceSummary,
  makeGpByServiceCentreRow,
  makeInterdepartmentRechargeRow,
  makeProfitTrendPoint,
  makeUnpaidInvoicesReport,
} from '../../test/fixtures';

// 2026-09-14 live-tested finding: moved from a hardcoded role list to the designation
// permission matrix's REPORTS_FINANCE_VIEW capability - see ReportsPage.test.tsx's own
// comment for why (a Designation-access grant had no effect against a static list).
vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/reportsApi', () => ({
  getFinanceSummary: vi.fn(),
  getGpByServiceCentre: vi.fn(),
  getInterdepartmentRecharge: vi.fn(),
  getUnpaidInvoices: vi.fn(),
  getProfitTrend: vi.fn(),
}));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import {
  getFinanceSummary,
  getGpByServiceCentre,
  getInterdepartmentRecharge,
  getProfitTrend,
  getUnpaidInvoices,
} from '../../lib/reportsApi';
import { FinanceReportsPage } from './FinanceReportsPage';

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
      <FinanceReportsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getFinanceSummary).mockReset().mockResolvedValue(makeFinanceSummary());
  vi.mocked(getGpByServiceCentre).mockReset().mockResolvedValue([makeGpByServiceCentreRow()]);
  vi.mocked(getInterdepartmentRecharge).mockReset().mockResolvedValue([makeInterdepartmentRechargeRow()]);
  vi.mocked(getUnpaidInvoices).mockReset().mockResolvedValue(makeUnpaidInvoicesReport());
  vi.mocked(getProfitTrend).mockReset().mockResolvedValue([makeProfitTrendPoint()]);
});

describe('FinanceReportsPage - access gate', () => {
  it('shows the access-denied notice and fires no queries for a role lacking REPORTS_FINANCE_VIEW', async () => {
    mockCapabilities([]);
    renderPage();

    expect(await screen.findByText("You don't have access to the Finance dashboard yet.")).toBeInTheDocument();
    expect(getFinanceSummary).not.toHaveBeenCalled();
    expect(getGpByServiceCentre).not.toHaveBeenCalled();
    expect(getInterdepartmentRecharge).not.toHaveBeenCalled();
    expect(getUnpaidInvoices).not.toHaveBeenCalled();
    expect(getProfitTrend).not.toHaveBeenCalled();
  });

  it('permits a role holding REPORTS_FINANCE_VIEW directly, and fullAccess separately', async () => {
    mockCapabilities(['REPORTS_FINANCE_VIEW']);
    renderPage();
    await screen.findByText('BRD 18.2 Finance Dashboard');
    expect(screen.queryByText("You don't have access to the Finance dashboard yet.")).not.toBeInTheDocument();
  });

  it('permits fullAccess (SUPER_ADMIN/SERVICE_HEAD bypass) with an empty capability list', async () => {
    mockCapabilities([], true);
    renderPage();
    await screen.findByText('BRD 18.2 Finance Dashboard');
    expect(screen.queryByText("You don't have access to the Finance dashboard yet.")).not.toBeInTheDocument();
  });
});

describe('FinanceReportsPage - summary cards', () => {
  it('renders revenue streams separately, never a blended total', async () => {
    mockCapabilities(['REPORTS_FINANCE_VIEW']);
    renderPage();
    // 5000 (OOW) and 1200 (AMC) each appear twice - once in the Revenue/OOW/AMC summary
    // cards - never combined into one blended figure anywhere on the page.
    expect((await screen.findAllByText('AED 5000.00')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('AED 1200.00').length).toBeGreaterThan(0);
    expect(screen.queryByText(/AED 6200\.00/)).not.toBeInTheDocument();
  });

  it('renders "—" for null cost/profit fields instead of a fabricated 0', async () => {
    mockCapabilities(['REPORTS_FINANCE_VIEW']);
    renderPage();
    await screen.findByText('Revenue (separate streams)');
    // grossProfit, grossProfitMarginPct, and every OOW cost field are null in the fixture.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('FinanceReportsPage - tables', () => {
  it('renders the GP by Service Centre table', async () => {
    mockCapabilities(['REPORTS_FINANCE_VIEW']);
    renderPage();
    expect(await screen.findByText('Dubai Main')).toBeInTheDocument();
  });

  it('renders the Interdepartment Recharge table with Pending/Posted counts, never "Settled"', async () => {
    mockCapabilities(['REPORTS_FINANCE_VIEW']);
    renderPage();
    expect(await screen.findByText('Retail')).toBeInTheDocument();
    expect(screen.queryByText(/Settled/)).not.toBeInTheDocument();
  });

  it('splits Unpaid Invoices into B2B and B2C groups', async () => {
    mockCapabilities(['REPORTS_FINANCE_VIEW']);
    renderPage();
    expect(await screen.findByText('B2B')).toBeInTheDocument();
    expect(screen.getByText('B2C')).toBeInTheDocument();
    expect(screen.getByText(/INV-0001/)).toBeInTheDocument();
  });

  it('renders the Profit Trend table and refetches when groupBy changes', async () => {
    mockCapabilities(['REPORTS_FINANCE_VIEW']);
    renderPage();
    await screen.findByText('2026-09');
    expect(getProfitTrend).toHaveBeenCalledWith('month', { periodStart: undefined, periodEnd: undefined });
  });
});
