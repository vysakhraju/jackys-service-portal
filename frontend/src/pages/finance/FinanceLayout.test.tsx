import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/invoicingApi', () => ({
  listInvoices: vi.fn(),
  getB2bAging: vi.fn(),
  getInvoice: vi.fn(),
  getPayments: vi.fn(),
  recordPayment: vi.fn(),
  getInvoiceByJobCard: vi.fn(),
}));
vi.mock('../../lib/glLedgerApi', () => ({
  listGlPostings: vi.fn(),
}));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { listInvoices } from '../../lib/invoicingApi';
import { listGlPostings } from '../../lib/glLedgerApi';
import { FinanceLayout } from './FinanceLayout';
import { InvoicesPage } from './InvoicesPage';
import { GlPostingsPage } from './GlPostingsPage';

// 2026-09-14: FinanceLayout now gates per-route on the real capability
// (useMyCapabilities) rather than a single hardcoded FINANCE_ROLES role array - see
// FinanceLayout.tsx's own comment. mockCapabilities replaces the old mockUser(roleName)
// role-array helper.
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

beforeEach(() => {
  vi.mocked(listInvoices).mockReset();
  vi.mocked(listGlPostings).mockReset();
});

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/finance" element={<FinanceLayout />}>
            <Route path="invoices" element={<InvoicesPage />} />
            <Route path="gl-postings" element={<GlPostingsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FinanceLayout - capability gating (2026-09-14: converted from a single hardcoded FINANCE_ROLES role array)', () => {
  it('shows a restricted notice and never mounts any child route for a caller with neither INVOICING_MANAGE nor GL_LEDGER_VIEW', async () => {
    mockCapabilities([]);
    renderAt('/finance/invoices');
    expect(await screen.findByText(/Finance is restricted to callers holding INVOICING_MANAGE or GL_LEDGER_VIEW/i)).toBeInTheDocument();
    // The whole point of gating at the layout, not the page: InvoicesPage never mounts,
    // so its listInvoices query is never even constructed for a non-privileged caller.
    expect(listInvoices).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument();
  });

  it('renders the tab nav and the child route for a caller holding INVOICING_MANAGE', async () => {
    mockCapabilities(['INVOICING_MANAGE']);
    vi.mocked(listInvoices).mockResolvedValue([]);
    renderAt('/finance/invoices');
    expect(await screen.findByText('Invoices')).toBeInTheDocument();
    expect(listInvoices).toHaveBeenCalled();
  });

  it('renders for a role granted INVOICING_MANAGE via Designation access, not just a default Accountant/Finance Manager role', async () => {
    // The whole point of this round's fix: a role with no default membership in
    // INVOICING_MANAGE sees the tab nav and Invoices page once Super Admin ticks the
    // capability for them - proven here by mocking the capability directly, independent
    // of role name.
    mockCapabilities(['INVOICING_MANAGE']);
    vi.mocked(listInvoices).mockResolvedValue([]);
    renderAt('/finance/invoices');
    expect(await screen.findByText('Invoices')).toBeInTheDocument();
    expect(await screen.findByText('B2B Aging Report')).toBeInTheDocument();
  });

  it('shows only the GL Postings tab, and hides Invoices, for a caller holding only GL_LEDGER_VIEW', async () => {
    mockCapabilities(['GL_LEDGER_VIEW']);
    vi.mocked(listGlPostings).mockResolvedValue([]);
    renderAt('/finance/gl-postings');
    expect(await screen.findByText('GL Postings')).toBeInTheDocument();
    expect(screen.queryByText('Invoices')).not.toBeInTheDocument();
    expect(screen.queryByText('B2B Aging Report')).not.toBeInTheDocument();
    expect(listGlPostings).toHaveBeenCalled();
  });

  it('blocks direct URL navigation to GL Postings for a caller who only holds INVOICING_MANAGE, without mounting GlPostingsPage', async () => {
    // Per-route check on the Outlet mount itself, not just the tab nav - a caller with
    // only one of the two capabilities can't reach the other's page via a direct URL
    // either, closing the query-safety gap the tab-nav-only check would leave open.
    mockCapabilities(['INVOICING_MANAGE']);
    renderAt('/finance/gl-postings');
    expect(await screen.findByText(/GL_LEDGER_VIEW capability, so this particular Finance tab is restricted/i)).toBeInTheDocument();
    expect(listGlPostings).not.toHaveBeenCalled();
    // The tab nav itself still renders (canViewSection is true), just without a GL
    // Postings entry.
    expect(screen.getByText('Invoices')).toBeInTheDocument();
    expect(screen.queryByText('GL Postings')).not.toBeInTheDocument();
  });

  it('renders for full-access callers (SUPER_ADMIN/SERVICE_HEAD bypass)', async () => {
    mockCapabilities([], true);
    vi.mocked(listInvoices).mockResolvedValue([]);
    const { unmount } = renderAt('/finance/invoices');
    expect(await screen.findByText('B2B Aging Report')).toBeInTheDocument();
    expect(screen.getByText('GL Postings')).toBeInTheDocument();
    unmount();
  });
});
