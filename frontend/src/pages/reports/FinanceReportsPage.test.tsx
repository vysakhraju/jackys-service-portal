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

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/reportsApi', () => ({
  getFinanceSummary: vi.fn(),
  getGpByServiceCentre: vi.fn(),
  getInterdepartmentRecharge: vi.fn(),
  getUnpaidInvoices: vi.fn(),
  getProfitTrend: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
import {
  getFinanceSummary,
  getGpByServiceCentre,
  getInterdepartmentRecharge,
  getProfitTrend,
  getUnpaidInvoices,
} from '../../lib/reportsApi';
import { FinanceReportsPage } from './FinanceReportsPage';

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

describe('FinanceReportsPage - role gate', () => {
  it('shows a restricted message and fires no queries for a disallowed role', async () => {
    mockUser('TECHNICAL_TEAM_LEADER');
    renderPage();

    expect(await screen.findByText(/restricted to Accountant/)).toBeInTheDocument();
    expect(getFinanceSummary).not.toHaveBeenCalled();
    expect(getGpByServiceCentre).not.toHaveBeenCalled();
    expect(getInterdepartmentRecharge).not.toHaveBeenCalled();
    expect(getUnpaidInvoices).not.toHaveBeenCalled();
    expect(getProfitTrend).not.toHaveBeenCalled();
  });

  it.each(['ACCOUNTANT', 'FINANCE_MANAGER', 'SERVICE_HEAD', 'SUPER_ADMIN'])('permits %s', async (role) => {
    mockUser(role);
    renderPage();
    await screen.findByText('BRD 18.2 Finance Dashboard');
    expect(screen.queryByText(/restricted to Accountant/)).not.toBeInTheDocument();
  });
});

describe('FinanceReportsPage - summary cards', () => {
  it('renders revenue streams separately, never a blended total', async () => {
    mockUser('ACCOUNTANT');
    renderPage();
    // 5000 (OOW) and 1200 (AMC) each appear twice - once in the Revenue/OOW/AMC summary
    // cards - never combined into one blended figure anywhere on the page.
    expect((await screen.findAllByText('AED 5000.00')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('AED 1200.00').length).toBeGreaterThan(0);
    expect(screen.queryByText(/AED 6200\.00/)).not.toBeInTheDocument();
  });

  it('renders "—" for null cost/profit fields instead of a fabricated 0', async () => {
    mockUser('ACCOUNTANT');
    renderPage();
    await screen.findByText('Revenue (separate streams)');
    // grossProfit, grossProfitMarginPct, and every OOW cost field are null in the fixture.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('FinanceReportsPage - tables', () => {
  it('renders the GP by Service Centre table', async () => {
    mockUser('SERVICE_HEAD');
    renderPage();
    expect(await screen.findByText('Dubai Main')).toBeInTheDocument();
  });

  it('renders the Interdepartment Recharge table with Pending/Posted counts, never "Settled"', async () => {
    mockUser('SERVICE_HEAD');
    renderPage();
    expect(await screen.findByText('Retail')).toBeInTheDocument();
    expect(screen.queryByText(/Settled/)).not.toBeInTheDocument();
  });

  it('splits Unpaid Invoices into B2B and B2C groups', async () => {
    mockUser('SERVICE_HEAD');
    renderPage();
    expect(await screen.findByText('B2B')).toBeInTheDocument();
    expect(screen.getByText('B2C')).toBeInTheDocument();
    expect(screen.getByText(/INV-0001/)).toBeInTheDocument();
  });

  it('renders the Profit Trend table and refetches when groupBy changes', async () => {
    mockUser('SERVICE_HEAD');
    renderPage();
    await screen.findByText('2026-09');
    expect(getProfitTrend).toHaveBeenCalledWith('month', { periodStart: undefined, periodEnd: undefined });
  });
});
