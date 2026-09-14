import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeJobCard } from '../../test/fixtures';

vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/jobCardsApi', () => ({
  getJobCard: vi.fn(),
  qcApprove: vi.fn(),
  qcReject: vi.fn(),
}));
vi.mock('../../lib/jobCardJourneyApi', () => ({
  searchJobCardJourney: vi.fn(),
}));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { getJobCard, qcApprove, qcReject } from '../../lib/jobCardsApi';
import { searchJobCardJourney } from '../../lib/jobCardJourneyApi';
import { QcPage } from './QcPage';

function renderPage(jobCardId = 'jc-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/qc-permissions/qc?jobCardId=${jobCardId}`]}>
        <QcPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// 2026-09-14: QcPage now gates on the real capability (useMyCapabilities) rather than a
// hardcoded QC_GATE_ROLES role array - see QcPage.tsx's own comment. mockCapabilities
// replaces the old mockUser(roleName) role-array helper.
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
  vi.mocked(getJobCard).mockReset();
  vi.mocked(qcApprove).mockReset();
  vi.mocked(qcReject).mockReset();
  vi.mocked(searchJobCardJourney).mockReset().mockResolvedValue([]);
});

// #218/#251: the "paste the job card's id" input is now an AsyncSearchPicker backed by
// GET /job-card-journey/search - this covers the search-then-select path itself, distinct
// from every other test in this file which deep-links straight in via ?jobCardId=.
describe('QcPage - #218 name-based job card picker', () => {
  it('searches and selects a job card, then loads it', async () => {
    mockCapabilities(['QC_GATE_ACCESS']);
    vi.mocked(searchJobCardJourney).mockResolvedValue([
      {
        jobCardId: 'jc-77',
        jobCardNumber: 'JC-0077',
        jobCardStatus: 'READY_FOR_QC',
        appointmentNumber: 'APT-0077',
        customerName: 'Fatima Noor',
        customerPhone: '050-1234567',
        deliveryNumber: null,
      },
    ]);
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard({ id: 'jc-77', status: 'READY_FOR_QC' }));

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/qc-permissions/qc']}>
          <QcPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.focus(screen.getByTestId('async-search-picker-input'));
    fireEvent.change(screen.getByTestId('async-search-picker-input'), { target: { value: 'JC-0077' } });
    fireEvent.click(await screen.findByText('JC-0077'));

    await waitFor(() => expect(getJobCard).toHaveBeenCalledWith('jc-77'));
    expect(await screen.findByText('JC-0077')).toBeInTheDocument();
  });
});

describe('QcPage - capability-floor gating (2026-09-14: converted from a hardcoded QC_GATE_ROLES role array; the-fool pre-mortem finding #1)', () => {
  it('hides Approve/Reject and explains why for a caller with no QC_GATE_ACCESS capability', async () => {
    mockCapabilities([]);
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard({ status: 'READY_FOR_QC' }));
    renderPage();
    expect(await screen.findByText(/won't allow you to attempt QC approval\/rejection/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve → QC Passed/i })).not.toBeInTheDocument();
  });

  it('shows Approve/Reject for a caller holding QC_GATE_ACCESS (grant itself is checked server-side, not here)', async () => {
    mockCapabilities(['QC_GATE_ACCESS']);
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard({ status: 'READY_FOR_QC' }));
    renderPage();
    expect(await screen.findByRole('button', { name: /Approve → QC Passed/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Reject$/i })).toBeInTheDocument();
  });

  it('shows Approve/Reject for a role granted QC_GATE_ACCESS via Designation access, not just a default QC_GATE_ROLES role', async () => {
    // The whole point of this round's fix: a role with no default membership in
    // QC_GATE_ACCESS (e.g. WAREHOUSE_CLERK) sees the buttons once Super Admin ticks the
    // capability for them - proven here by mocking the capability directly, independent
    // of role name.
    mockCapabilities(['QC_GATE_ACCESS']);
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard({ status: 'READY_FOR_QC' }));
    renderPage();
    expect(await screen.findByRole('button', { name: /Approve → QC Passed/i })).toBeInTheDocument();
  });
});

describe('QcPage - phase boundaries', () => {
  it('links back to Workshop for a job not yet READY_FOR_QC', async () => {
    mockCapabilities(['QC_GATE_ACCESS']);
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard({ status: 'IN_PROGRESS' }));
    renderPage();
    expect(await screen.findByText(/not yet READY_FOR_QC/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve → QC Passed/i })).not.toBeInTheDocument();
  });

  it('shows a past-this-screen note for a QC_PASSED job', async () => {
    mockCapabilities(['QC_GATE_ACCESS']);
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard({ status: 'QC_PASSED' }));
    renderPage();
    expect(await screen.findByText(/past what this screen covers/i)).toBeInTheDocument();
  });
});

describe('QcPage - Approve (the-fool pre-mortem finding #2: structured 409 blockers)', () => {
  it('renders each blocker from a 409 stock-shortfall response, not just the raw message', async () => {
    mockCapabilities(['QC_GATE_ACCESS']);
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard({ status: 'READY_FOR_QC' }));
    vi.mocked(qcApprove).mockRejectedValue({
      response: {
        status: 409,
        data: {
          message: 'Insufficient stock to consume reservations',
          blockers: [{ reservationId: 'res-1', sparePartId: 'sp-1', quantityRequested: 3, quantityReserved: 1 }],
        },
      },
    });
    const user = userEvent.setup();
    renderPage();
    const approveButton = await screen.findByRole('button', { name: /Approve → QC Passed/i });
    await user.click(approveButton);
    expect(await screen.findByText(/Blocked - stock isn't there to consume for 1 reservation/i)).toBeInTheDocument();
    expect(screen.getByText(/reserved 1 of 3 requested/i)).toBeInTheDocument();
    expect(screen.getByText(/Go to the Workshop screen to top up or resolve/i)).toBeInTheDocument();
  });

  it('calls qcApprove with the job card id on click', async () => {
    mockCapabilities(['QC_GATE_ACCESS']);
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard({ id: 'jc-42', status: 'READY_FOR_QC' }));
    vi.mocked(qcApprove).mockResolvedValue(makeJobCard({ id: 'jc-42', status: 'QC_PASSED' }));
    const user = userEvent.setup();
    renderPage('jc-42');
    const approveButton = await screen.findByRole('button', { name: /Approve → QC Passed/i });
    await user.click(approveButton);
    await waitFor(() => expect(qcApprove).toHaveBeenCalledWith('jc-42'));
  });
});

describe('QcPage - Reject (the-fool pre-mortem finding #3: no dead end)', () => {
  it('shows a link back to Workshop after a successful reject, not a dead end', async () => {
    mockCapabilities(['QC_GATE_ACCESS']);
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard({ id: 'jc-9', status: 'READY_FOR_QC' }));
    vi.mocked(qcReject).mockResolvedValue(makeJobCard({ id: 'jc-9', status: 'IN_PROGRESS', qcRejectionCount: 1 }));
    const user = userEvent.setup();
    renderPage('jc-9');
    const reasonInput = await screen.findByLabelText(/Rejection reason/i);
    await user.type(reasonInput, 'Drum still noisy');
    await user.click(screen.getByRole('button', { name: /^Reject$/i }));
    expect(await screen.findByText(/back to IN_PROGRESS/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Workshop screen/i })).toHaveAttribute(
      'href',
      '/workshop-inventory/workshop?jobCardId=jc-9',
    );
    expect(qcReject).toHaveBeenCalledWith('jc-9', { reason: 'Drum still noisy' });
  });
});
