import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/amcApi', () => ({
  listAmcContracts: vi.fn(),
  getExpiringAmcContracts: vi.fn(),
  getAmcUpsellCandidates: vi.fn(),
}));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { listAmcContracts } from '../../lib/amcApi';
import { AmcLayout } from './AmcLayout';
import { ContractsPage } from './ContractsPage';

// 2026-09-14: AmcLayout/ContractsPage now gate on the real capability
// (useMyCapabilities) rather than four hardcoded role arrays - see amcTypes.ts's own
// comment. mockCapabilities replaces the old mockUser(roleName) role-array helper.
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

describe('AmcLayout - capability gate (2026-09-14: converted from a hardcoded AMC_VIEW_ROLES array)', () => {
  it('shows a restricted notice and never mounts the child route for a caller with no AMC_VIEW capability', async () => {
    mockCapabilities([]);
    renderAt('/amc/contracts');
    expect(await screen.findByText(/restricted to Service Head \/ Super Admin \/ CCE \/ Technicians \/ Accountant \/ Finance Manager/i)).toBeInTheDocument();
    expect(listAmcContracts).not.toHaveBeenCalled();
  });

  it('mounts the child route and its query for a caller holding only AMC_VIEW + AMC_TECHNICIAN_VISIT (view-only, technician-shaped)', async () => {
    mockCapabilities(['AMC_VIEW', 'AMC_TECHNICIAN_VISIT']);
    vi.mocked(listAmcContracts).mockResolvedValue([]);
    renderAt('/amc/contracts');
    expect(await screen.findByText('No AMC contracts match this filter.')).toBeInTheDocument();
    expect(listAmcContracts).toHaveBeenCalled();
    // Can view but not manage - no "+ New Contract" button.
    expect(screen.queryByRole('button', { name: '+ New Contract' })).not.toBeInTheDocument();
  });

  it('shows the tabs and "+ New Contract" for a full-access caller (SUPER_ADMIN/SERVICE_HEAD bypass)', async () => {
    mockCapabilities([], true);
    vi.mocked(listAmcContracts).mockResolvedValue([]);
    renderAt('/amc/contracts');
    expect(await screen.findByText('Contracts')).toBeInTheDocument();
    expect(screen.getByText('Expiring Soon')).toBeInTheDocument();
    expect(screen.getByText('Upsell Candidates')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ New Contract' })).toBeInTheDocument();
  });

  it('shows "+ New Contract" for a role granted AMC_MANAGE via Designation access, not just a default role', async () => {
    // The whole point of this round's fix: a role with no default membership in
    // AMC_MANAGE sees the button once Super Admin ticks the capability for them - proven
    // here by mocking the capability directly, independent of role name.
    mockCapabilities(['AMC_VIEW', 'AMC_MANAGE']);
    vi.mocked(listAmcContracts).mockResolvedValue([]);
    renderAt('/amc/contracts');
    expect(await screen.findByText('Contracts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ New Contract' })).toBeInTheDocument();
  });
});
