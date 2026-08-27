import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

import { getJobCard } from '../../lib/jobCardsApi';
import { getEstimatesByJobCard, recordResponse } from '../../lib/estimatesApi';
import { EstimatesPage } from './EstimatesPage';

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
