import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/invoicingApi', () => ({
  listInvoices: vi.fn(),
  getB2bAging: vi.fn(),
  getInvoice: vi.fn(),
  getPayments: vi.fn(),
  recordPayment: vi.fn(),
  getInvoiceByJobCard: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
import { listInvoices } from '../../lib/invoicingApi';
import { FinanceLayout } from './FinanceLayout';
import { InvoicesPage } from './InvoicesPage';

function mockUser(roleName: string) {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      id: 'u1',
      firstName: 'Test',
      lastName: 'User',
      email: 'u1@jackys.com',
      employeeId: 'E1',
      status: 'ACTIVE',
      lastLoginAt: null,
      role: { id: 'r1', name: roleName, displayName: roleName },
    },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
  } as any);
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/finance" element={<FinanceLayout />}>
            <Route path="invoices" element={<InvoicesPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FinanceLayout - role gating', () => {
  it('shows a restricted notice and never mounts the child route for a role outside FINANCE_ROLES', async () => {
    mockUser('DRIVER');
    renderAt('/finance/invoices');
    expect(await screen.findByText(/restricted to Accountant \/ Finance Manager \/ Super Admin \/ Service Head/i)).toBeInTheDocument();
    // The whole point of gating at the layout, not the page: InvoicesPage never mounts,
    // so its listInvoices query is never even constructed for a non-privileged user.
    expect(listInvoices).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument();
  });

  it('renders the tab nav and the child route for FINANCE_MANAGER', async () => {
    mockUser('FINANCE_MANAGER');
    vi.mocked(listInvoices).mockResolvedValue([]);
    renderAt('/finance/invoices');
    expect(await screen.findByText('Invoices')).toBeInTheDocument();
    expect(listInvoices).toHaveBeenCalled();
  });

  it('renders for every role in FINANCE_ROLES', async () => {
    for (const role of ['ACCOUNTANT', 'FINANCE_MANAGER', 'SUPER_ADMIN', 'SERVICE_HEAD']) {
      mockUser(role);
      vi.mocked(listInvoices).mockResolvedValue([]);
      const { unmount } = renderAt('/finance/invoices');
      expect(await screen.findByText('B2B Aging Report')).toBeInTheDocument();
      unmount();
    }
  });
});
