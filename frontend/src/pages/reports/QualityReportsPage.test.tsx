import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeProductFailureRatioRow, makeRepeatComplaintItem, makeRwrAnalysisRow } from '../../test/fixtures';

// 2026-09-14 live-tested finding: moved from a hardcoded role list to the designation
// permission matrix's REPORTS_QUALITY_VIEW capability - see ReportsPage.test.tsx's own
// comment for why (a Designation-access grant had no effect against a static list).
vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/reportsApi', () => ({
  getProductFailureRatio: vi.fn(),
  getRepeatComplaints: vi.fn(),
  getRwrAnalysis: vi.fn(),
}));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { getProductFailureRatio, getRepeatComplaints, getRwrAnalysis } from '../../lib/reportsApi';
import { QualityReportsPage } from './QualityReportsPage';

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
      <MemoryRouter>
        <QualityReportsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getProductFailureRatio).mockReset().mockResolvedValue([makeProductFailureRatioRow()]);
  vi.mocked(getRepeatComplaints).mockReset().mockResolvedValue([makeRepeatComplaintItem()]);
  vi.mocked(getRwrAnalysis).mockReset().mockResolvedValue([makeRwrAnalysisRow()]);
});

describe('QualityReportsPage - access gate', () => {
  it('shows the access-denied notice and fires no queries for a role lacking REPORTS_QUALITY_VIEW', async () => {
    mockCapabilities([]);
    renderPage();

    expect(await screen.findByText("You don't have access to the Quality/Product dashboard yet.")).toBeInTheDocument();
    expect(getProductFailureRatio).not.toHaveBeenCalled();
    expect(getRepeatComplaints).not.toHaveBeenCalled();
    expect(getRwrAnalysis).not.toHaveBeenCalled();
  });

  it('permits a role holding REPORTS_QUALITY_VIEW directly, and fullAccess separately', async () => {
    mockCapabilities(['REPORTS_QUALITY_VIEW']);
    renderPage();
    await screen.findByText('BRD 18.3 Quality / Product Dashboard');
    expect(screen.queryByText("You don't have access to the Quality/Product dashboard yet.")).not.toBeInTheDocument();
  });

  it('permits fullAccess (SUPER_ADMIN/SERVICE_HEAD bypass) with an empty capability list', async () => {
    mockCapabilities([], true);
    renderPage();
    await screen.findByText('BRD 18.3 Quality / Product Dashboard');
    expect(screen.queryByText("You don't have access to the Quality/Product dashboard yet.")).not.toBeInTheDocument();
  });
});

describe('QualityReportsPage - widgets', () => {
  it('renders the Product Failure Ratio table', async () => {
    mockCapabilities(['REPORTS_QUALITY_VIEW']);
    renderPage();
    // "WM-500" is also the RWR Analysis fixture's model, so this page legitimately shows
    // it twice once both widgets have loaded - assert at least one, not exactly one.
    expect((await screen.findAllByText('WM-500')).length).toBeGreaterThan(0);
    expect(screen.getByText('Samsung')).toBeInTheDocument();
  });

  it('flags a repeat complaint within 30 days', async () => {
    mockCapabilities(['REPORTS_QUALITY_VIEW']);
    renderPage();
    expect(await screen.findByText('SN-000123')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
  });

  it('#220: each job card in a Repeat Complaints row links straight to its own Journey view', async () => {
    mockCapabilities(['REPORTS_QUALITY_VIEW']);
    renderPage();
    await screen.findByText('SN-000123');

    // The fixture's two job cards (JC-0001/jc-1, JC-0002/jc-2) must each get their own
    // link - not a single link covering the whole comma-joined cell, since only one
    // jobCardId could ever be encoded in that case.
    const first = screen.getByRole('link', { name: 'JC-0001' });
    const second = screen.getByRole('link', { name: 'JC-0002' });
    expect(first).toHaveAttribute('href', '/job-cards/journey?jobCardId=jc-1');
    expect(second).toHaveAttribute('href', '/job-cards/journey?jobCardId=jc-2');
  });

  it('renders the RWR Analysis table with free-text reason', async () => {
    mockCapabilities(['REPORTS_QUALITY_VIEW']);
    renderPage();
    expect(await screen.findByText('Customer declined repair cost')).toBeInTheDocument();
  });

  it('shows an empty state, not an error, when no repeat complaints exist', async () => {
    mockCapabilities(['REPORTS_QUALITY_VIEW']);
    vi.mocked(getRepeatComplaints).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No repeat complaints on record.')).toBeInTheDocument();
  });
});
