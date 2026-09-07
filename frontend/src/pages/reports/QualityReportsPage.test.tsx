import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeProductFailureRatioRow, makeRepeatComplaintItem, makeRwrAnalysisRow } from '../../test/fixtures';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/reportsApi', () => ({
  getProductFailureRatio: vi.fn(),
  getRepeatComplaints: vi.fn(),
  getRwrAnalysis: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
import { getProductFailureRatio, getRepeatComplaints, getRwrAnalysis } from '../../lib/reportsApi';
import { QualityReportsPage } from './QualityReportsPage';

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
      <QualityReportsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getProductFailureRatio).mockReset().mockResolvedValue([makeProductFailureRatioRow()]);
  vi.mocked(getRepeatComplaints).mockReset().mockResolvedValue([makeRepeatComplaintItem()]);
  vi.mocked(getRwrAnalysis).mockReset().mockResolvedValue([makeRwrAnalysisRow()]);
});

describe('QualityReportsPage - role gate', () => {
  it('shows a restricted message and fires no queries for a disallowed role', async () => {
    mockUser('ACCOUNTANT');
    renderPage();

    expect(await screen.findByText(/restricted to Service Head/)).toBeInTheDocument();
    expect(getProductFailureRatio).not.toHaveBeenCalled();
    expect(getRepeatComplaints).not.toHaveBeenCalled();
    expect(getRwrAnalysis).not.toHaveBeenCalled();
  });

  it.each(['SERVICE_HEAD', 'SUPER_ADMIN', 'TECHNICAL_TEAM_LEADER'])('permits %s', async (role) => {
    mockUser(role);
    renderPage();
    await screen.findByText('BRD 18.3 Quality / Product Dashboard');
    expect(screen.queryByText(/restricted to Service Head/)).not.toBeInTheDocument();
  });
});

describe('QualityReportsPage - widgets', () => {
  it('renders the Product Failure Ratio table', async () => {
    mockUser('SERVICE_HEAD');
    renderPage();
    // "WM-500" is also the RWR Analysis fixture's model, so this page legitimately shows
    // it twice once both widgets have loaded - assert at least one, not exactly one.
    expect((await screen.findAllByText('WM-500')).length).toBeGreaterThan(0);
    expect(screen.getByText('Samsung')).toBeInTheDocument();
  });

  it('flags a repeat complaint within 30 days', async () => {
    mockUser('SERVICE_HEAD');
    renderPage();
    expect(await screen.findByText('SN-000123')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
  });

  it('renders the RWR Analysis table with free-text reason', async () => {
    mockUser('SERVICE_HEAD');
    renderPage();
    expect(await screen.findByText('Customer declined repair cost')).toBeInTheDocument();
  });

  it('shows an empty state, not an error, when no repeat complaints exist', async () => {
    mockUser('SERVICE_HEAD');
    vi.mocked(getRepeatComplaints).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No repeat complaints on record.')).toBeInTheDocument();
  });
});
