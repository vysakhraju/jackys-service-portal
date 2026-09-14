import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeEstimate, makeJobCard } from '../../test/fixtures';

vi.mock('../../lib/jobCardsApi', () => ({
  getJobCard: vi.fn(),
}));
vi.mock('../../lib/estimatesApi', () => ({
  createEstimate: vi.fn(),
  getEstimatesByJobCard: vi.fn(),
  recordResponse: vi.fn(),
  reviseEstimate: vi.fn(),
  sendEstimate: vi.fn(),
}));
vi.mock('../../lib/jobCardJourneyApi', () => ({
  searchJobCardJourney: vi.fn(),
}));
// 2026-09-14 (Group B): EstimatesPage had zero frontend capability check on its
// Send/Revise/RecordResponse actions - now gated on ESTIMATE_MANAGE / ESTIMATE_RECORD_RESPONSE
// (mirroring estimates.controller.ts's own @RequiresCapability() on those endpoints), same
// mockCapabilities pattern as SchedulePage.test.tsx.
vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));

import { getJobCard } from '../../lib/jobCardsApi';
import { getEstimatesByJobCard, recordResponse } from '../../lib/estimatesApi';
import { searchJobCardJourney } from '../../lib/jobCardJourneyApi';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { EstimatesPage } from './EstimatesPage';

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

function renderPage(jobCardId = 'jc-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/estimates?jobCardId=${jobCardId}`]}>
        <EstimatesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getJobCard).mockReset();
  vi.mocked(getEstimatesByJobCard).mockReset();
  vi.mocked(recordResponse).mockReset();
  vi.mocked(searchJobCardJourney).mockReset().mockResolvedValue([]);
  mockCapabilities([], true);
});

// #218/#251: the "paste the job card's id" input is now an AsyncSearchPicker backed by
// GET /job-card-journey/search.
describe('EstimatesPage - #218 name-based job card picker', () => {
  it('searches and selects a job card, then loads its estimate history', async () => {
    vi.mocked(searchJobCardJourney).mockResolvedValue([
      {
        jobCardId: 'jc-88',
        jobCardNumber: 'JC-0088',
        jobCardStatus: 'SN_VALIDATED',
        appointmentNumber: 'APT-0088',
        customerName: 'Ahmed Ali',
        customerPhone: '050-7654321',
        deliveryNumber: null,
      },
    ]);
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard({ id: 'jc-88', status: 'SN_VALIDATED', warrantyStatus: 'OOW' }));
    vi.mocked(getEstimatesByJobCard).mockResolvedValue([]);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/estimates']}>
          <EstimatesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.focus(screen.getByTestId('async-search-picker-input'));
    fireEvent.change(screen.getByTestId('async-search-picker-input'), { target: { value: 'JC-0088' } });
    fireEvent.click(await screen.findByText('JC-0088'));

    await waitFor(() => expect(getEstimatesByJobCard).toHaveBeenCalledWith('jc-88'));
  });
});

describe('EstimatesPage - Create gating (the-fool pre-mortem finding #1: no dead end after expiry)', () => {
  it('shows Create Estimate when there is no estimate at all yet', async () => {
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard());
    vi.mocked(getEstimatesByJobCard).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Create Estimate')).toBeInTheDocument();
  });

  it('still shows Create Estimate when the only estimate on file is EXPIRED (not list-emptiness gating)', async () => {
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard());
    vi.mocked(getEstimatesByJobCard).mockResolvedValue([makeEstimate({ id: 'old', status: 'EXPIRED' })]);
    renderPage();
    // The dead-end this guards against: an EXPIRED estimate must NOT block a fresh one -
    // gating must key off "no active (DRAFT/SENT/APPROVED) estimate", not "list is empty".
    expect(await screen.findByText('Create Estimate')).toBeInTheDocument();
    expect(screen.getByText('EXPIRED')).toBeInTheDocument();
  });

  it('hides Create Estimate while an active (DRAFT) estimate already exists', async () => {
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard());
    vi.mocked(getEstimatesByJobCard).mockResolvedValue([makeEstimate({ id: 'live', status: 'DRAFT' })]);
    renderPage();
    await screen.findByText('AED 367.50 total');
    expect(screen.queryByText('Create Estimate')).not.toBeInTheDocument();
  });
});

describe('EstimatesPage - Record Response prefill (the-fool pre-mortem finding #3)', () => {
  it('prefills the contact value with the phone on file instead of a blank input', async () => {
    const jobCard = makeJobCard();
    vi.mocked(getJobCard).mockResolvedValue(jobCard);
    vi.mocked(getEstimatesByJobCard).mockResolvedValue([makeEstimate({ status: 'SENT', accessToken: 'tok-abc' })]);
    renderPage();
    const contactInput = (await screen.findByLabelText(/Contact value/i)) as HTMLInputElement;
    expect(contactInput.value).toBe(jobCard.appointment!.customerPhone);
  });
});

describe('EstimatesPage - 409 handling on record-response (the-fool pre-mortem finding #4)', () => {
  it('refetches the estimate history instead of leaving a stale form on a 409 conflict', async () => {
    const user = userEvent.setup();
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard());
    vi.mocked(getEstimatesByJobCard).mockResolvedValue([makeEstimate({ status: 'SENT', accessToken: 'tok-abc' })]);
    vi.mocked(recordResponse).mockRejectedValue({
      response: { status: 409, data: { message: 'This estimate was already responded to at 2026-08-01T10:00:00.000Z via CUSTOMER_LINK.' } },
    });

    renderPage();
    await screen.findByLabelText(/Contact value/i);

    const callsBefore = vi.mocked(getEstimatesByJobCard).mock.calls.length;
    await user.type(screen.getByLabelText('Notes', { exact: false }), 'Attempted to record over the phone');
    await user.click(screen.getByRole('button', { name: 'Record Decision' }));

    await waitFor(() => {
      expect(vi.mocked(getEstimatesByJobCard).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});

// 2026-09-14 (Group B): Create/Send/Revise used to render for every logged-in user with no
// capability check at all - now gated on ESTIMATE_MANAGE, mirroring POST / , POST /:id/send
// and POST /:id/revise's own @RequiresCapability('ESTIMATE_MANAGE'). Record Response is
// gated separately on ESTIMATE_RECORD_RESPONSE, mirroring POST /:id/record-response.
describe('EstimatesPage - Group B capability gating', () => {
  it('hides Create Estimate for a caller without ESTIMATE_MANAGE, even with no active estimate', async () => {
    mockCapabilities([]);
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard());
    vi.mocked(getEstimatesByJobCard).mockResolvedValue([]);
    renderPage();

    await screen.findByText('Samsung', { exact: false });
    expect(screen.queryByText('Create Estimate')).not.toBeInTheDocument();
  });

  it('shows Create Estimate once ESTIMATE_MANAGE is granted to any role via Designation access', async () => {
    mockCapabilities(['ESTIMATE_MANAGE']);
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard());
    vi.mocked(getEstimatesByJobCard).mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('Create Estimate')).toBeInTheDocument();
  });

  it('hides the Send to customer action on a DRAFT estimate for a caller without ESTIMATE_MANAGE', async () => {
    mockCapabilities([]);
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard());
    vi.mocked(getEstimatesByJobCard).mockResolvedValue([makeEstimate({ id: 'live', status: 'DRAFT' })]);
    renderPage();

    await screen.findByText('AED 367.50 total');
    expect(screen.queryByText('Send to customer')).not.toBeInTheDocument();
  });

  // NOTE (2026-09-14, found while adding this gate): the "Revise" ActionCard's own render
  // condition (`estimate.status === 'REJECTED'`) is pre-existing, unrelated-to-this-round dead
  // code - ACTIVE_STATUSES (line 43) deliberately excludes REJECTED, so a REJECTED estimate is
  // never `activeEstimate` and is always rendered as a HistoricalEstimateRow instead of an
  // ActiveEstimateCard (see the estimates.map at line ~177). There is therefore no reachable
  // scenario in which the Revise ActionCard renders at all today, gated or not - added the
  // `&& canManage` guard to it anyway for consistency/safety, but it can't be exercised by a
  // test without also fixing that pre-existing reachability bug, which is out of scope for
  // this capability-gating pass.

  it('hides the Record Response card on a SENT estimate for a caller without ESTIMATE_RECORD_RESPONSE, while still showing the customer link', async () => {
    mockCapabilities([]);
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard());
    vi.mocked(getEstimatesByJobCard).mockResolvedValue([makeEstimate({ status: 'SENT', accessToken: 'tok-abc' })]);
    renderPage();

    await screen.findByText('Customer link');
    expect(screen.queryByLabelText(/Contact value/i)).not.toBeInTheDocument();
  });

  it('shows the Record Response card once ESTIMATE_RECORD_RESPONSE is granted via Designation access, independent of ESTIMATE_MANAGE', async () => {
    mockCapabilities(['ESTIMATE_RECORD_RESPONSE']);
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard());
    vi.mocked(getEstimatesByJobCard).mockResolvedValue([makeEstimate({ status: 'SENT', accessToken: 'tok-abc' })]);
    renderPage();

    expect(await screen.findByLabelText(/Contact value/i)).toBeInTheDocument();
  });
});
