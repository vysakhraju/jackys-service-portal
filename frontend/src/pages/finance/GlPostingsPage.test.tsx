import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeGlPosting } from '../../test/fixtures';

vi.mock('../../lib/glLedgerApi', () => ({
  listGlPostings: vi.fn(),
}));

import { listGlPostings } from '../../lib/glLedgerApi';
import { GlPostingsPage } from './GlPostingsPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <GlPostingsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listGlPostings).mockReset();
});

describe('GlPostingsPage - basic rendering', () => {
  it('renders the posting count, total amount, and each row', async () => {
    vi.mocked(listGlPostings).mockResolvedValue([
      makeGlPosting({ id: 'gl-1', description: 'Payment received for INV-0001 (CASH)', amount: 250 }),
      makeGlPosting({ id: 'gl-2', description: 'Interdepartment recharge posted for DN-0001', sourceType: 'DEBIT_NOTE', amount: 60 }),
    ]);
    renderPage();

    expect(await screen.findByText('2 postings')).toBeInTheDocument();
    expect(screen.getByText('AED 310.00 total')).toBeInTheDocument();
    expect(screen.getByText('Payment received for INV-0001 (CASH)')).toBeInTheDocument();
    expect(screen.getByText('Interdepartment recharge posted for DN-0001')).toBeInTheDocument();
    // "Invoice Payment"/"Debit Note" also appear as <option> text in the source-type
    // filter, so scope these to the table itself to avoid an ambiguous match.
    const table = screen.getByRole('table');
    expect(within(table).getByText('Invoice Payment')).toBeInTheDocument();
    expect(within(table).getByText('Debit Note')).toBeInTheDocument();
  });

  it('uses singular "posting" for exactly one result', async () => {
    vi.mocked(listGlPostings).mockResolvedValue([makeGlPosting()]);
    renderPage();

    expect(await screen.findByText('1 posting')).toBeInTheDocument();
  });

  it('shows the empty message and no pagination controls when nothing matches', async () => {
    vi.mocked(listGlPostings).mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('No GL postings match this filter yet.')).toBeInTheDocument();
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });

  it('shows an error notice when the request fails', async () => {
    vi.mocked(listGlPostings).mockRejectedValue(new Error('network down'));
    renderPage();

    expect(await screen.findByText('network down')).toBeInTheDocument();
  });
});

describe('GlPostingsPage - sourceType filter', () => {
  it('calls listGlPostings with the selected sourceType', async () => {
    vi.mocked(listGlPostings).mockResolvedValue([]);
    renderPage();

    await screen.findByText('No GL postings match this filter yet.');
    expect(listGlPostings).toHaveBeenCalledWith(undefined);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Source type'), 'WARRANTY_CLAIM_CREDIT');

    expect(listGlPostings).toHaveBeenLastCalledWith('WARRANTY_CLAIM_CREDIT');
  });
});

describe('GlPostingsPage - client-side pagination (the-fool finding: unbounded backend list)', () => {
  const THIRTY_POSTINGS = Array.from({ length: 30 }, (_, i) =>
    makeGlPosting({ id: `gl-${i + 1}`, description: `Posting ${i + 1}`, amount: 10 }),
  );

  it('renders only the first 25 rows on page 1 and says so explicitly', async () => {
    vi.mocked(listGlPostings).mockResolvedValue(THIRTY_POSTINGS);
    renderPage();

    expect(await screen.findByText('Posting 1')).toBeInTheDocument();
    expect(screen.getByText('Posting 25')).toBeInTheDocument();
    expect(screen.queryByText('Posting 26')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 1-25 of 30/)).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    // Total/count reflect everything fetched, not just the visible page.
    expect(screen.getByText('30 postings')).toBeInTheDocument();
  });

  it('moves to the remaining rows on Next, without re-fetching', async () => {
    vi.mocked(listGlPostings).mockResolvedValue(THIRTY_POSTINGS);
    renderPage();
    await screen.findByText('Posting 1');
    vi.mocked(listGlPostings).mockClear();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Next/ }));

    expect(screen.getByText('Posting 26')).toBeInTheDocument();
    expect(screen.getByText('Posting 30')).toBeInTheDocument();
    expect(screen.queryByText('Posting 1')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 26-30 of 30/)).toBeInTheDocument();
    expect(listGlPostings).not.toHaveBeenCalled(); // pagination is purely client-side
  });

  it('resets to page 1 when the sourceType filter changes', async () => {
    vi.mocked(listGlPostings).mockResolvedValue(THIRTY_POSTINGS);
    renderPage();
    await screen.findByText('Posting 1');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByText('Posting 26')).toBeInTheDocument();

    vi.mocked(listGlPostings).mockResolvedValue([makeGlPosting({ id: 'gl-only', description: 'Only one' })]);
    await user.selectOptions(screen.getByLabelText('Source type'), 'DEBIT_NOTE');

    expect(await screen.findByText('Only one')).toBeInTheDocument();
  });
});
