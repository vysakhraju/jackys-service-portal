import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/amcApi', () => ({
  listAmcContracts: vi.fn(),
  getExpiringAmcContracts: vi.fn(),
  getAmcUpsellCandidates: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
import { listAmcContracts } from '../../lib/amcApi';
import { AmcLayout } from './AmcLayout';
import { ContractsPage } from './ContractsPage';

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
          <Route path="/amc" element={<AmcLayout />}>
            <Route path="contracts" element={<ContractsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AmcLayout - page-level role gate', () => {
  it('shows a restricted notice and never mounts the child route for a role outside AMC_VIEW_ROLES', async () => {
    mockUser('DRIVER');
    renderAt('/amc/contracts');
    expect(await screen.findByText(/restricted to Service Head \/ Super Admin \/ CCE \/ Technicians \/ Accountant \/ Finance Manager/i)).toBeInTheDocument();
    expect(listAmcContracts).not.toHaveBeenCalled();
  });

  it('mounts the child route and its query for a technician (view-only role in AMC_VIEW_ROLES)', async () => {
    mockUser('TECHNICIAN_FIELD');
    vi.mocked(listAmcContracts).mockResolvedValue([]);
    renderAt('/amc/contracts');
    expect(await screen.findByText('No AMC contracts match this filter.')).toBeInTheDocument();
    expect(listAmcContracts).toHaveBeenCalled();
    // Technicians can view but not manage - no "+ New Contract" button.
    expect(screen.queryByRole('button', { name: '+ New Contract' })).not.toBeInTheDocument();
  });

  it('shows the tabs and "+ New Contract" for SERVICE_HEAD', async () => {
    mockUser('SERVICE_HEAD');
    vi.mocked(listAmcContracts).mockResolvedValue([]);
    renderAt('/amc/contracts');
    expect(await screen.findByText('Contracts')).toBeInTheDocument();
    expect(screen.getByText('Expiring Soon')).toBeInTheDocument();
    expect(screen.getByText('Upsell Candidates')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ New Contract' })).toBeInTheDocument();
  });
});
