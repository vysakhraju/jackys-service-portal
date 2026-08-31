import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { makePortalInvoiceView, makePortalSummaryView, makePortalTrackView } from '../../test/fixtures';

vi.mock('../../lib/customerPortalApi', () => ({
  trackJob: vi.fn(),
  getPortalInvoice: vi.fn(),
  getPortalSummary: vi.fn(),
}));

import { getPortalInvoice, getPortalSummary, trackJob } from '../../lib/customerPortalApi';
import { CustomerPortalPage } from './CustomerPortalPage';

function renderPage(token = 'tok-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/track/${token}`]}>
        <Routes>
          <Route path="/track/:token" element={<CustomerPortalPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function notFoundError() {
  const err = new AxiosError('Not Found');
  err.response = { status: 404 } as any;
  return err;
}

beforeEach(() => {
  vi.mocked(trackJob).mockReset();
  vi.mocked(getPortalInvoice).mockReset();
  vi.mocked(getPortalSummary).mockReset();
});

describe('CustomerPortalPage - track (eager)', () => {
  it('shows a friendly status and never fetches the other two tabs on initial load', async () => {
    vi.mocked(trackJob).mockResolvedValue(makePortalTrackView({ jobCardNumber: 'JC-0042', status: 'IN_PROGRESS' }));
    renderPage();

    expect(await screen.findByText('Being repaired')).toBeInTheDocument();
    expect(screen.getByText(/JC-0042/)).toBeInTheDocument();
    expect(trackJob).toHaveBeenCalledWith('tok-1');
    // Lazy tabs (the-fool pre-mortem: never eagerly hit a customer-facing endpoint the
    // customer hasn't asked to see) - neither should fire until its tab is opened.
    expect(getPortalInvoice).not.toHaveBeenCalled();
    expect(getPortalSummary).not.toHaveBeenCalled();
  });

  it("shows an unrecognized-link message for a 404 (unknown or expired token)", async () => {
    vi.mocked(trackJob).mockRejectedValue(notFoundError());
    renderPage();
    expect(await screen.findByText(/couldn't find that tracking link/i)).toBeInTheDocument();
  });

  it('shows a generic error message for a non-404 failure', async () => {
    const err = new AxiosError('Server Error');
    err.response = { status: 500 } as any;
    vi.mocked(trackJob).mockRejectedValue(err);
    renderPage();
    expect(await screen.findByText(/Something went wrong loading your repair status/i)).toBeInTheDocument();
  });
});

describe('CustomerPortalPage - What You Owe tab (lazy)', () => {
  async function openInvoiceTab() {
    vi.mocked(trackJob).mockResolvedValue(makePortalTrackView());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/JC-0001/);
    await user.click(screen.getByRole('button', { name: 'What You Owe' }));
    return user;
  }

  it('fetches only once the tab is opened, and shows amount due + the manual-payment notice', async () => {
    vi.mocked(getPortalInvoice).mockResolvedValue(makePortalInvoiceView({ amountDue: 167.5 }));
    await openInvoiceTab();

    expect(getPortalInvoice).toHaveBeenCalledWith('tok-1');
    expect(await screen.findByText(/AED 167.50/)).toBeInTheDocument();
    expect(screen.getByText(/contact your service centre/i)).toBeInTheDocument();
    // No pay-now control anywhere on this tab - FR-14 is manual-only, no online gateway.
    expect(screen.queryByRole('button', { name: /pay/i })).not.toBeInTheDocument();
  });

  it('shows the in-warranty message when not applicable', async () => {
    vi.mocked(getPortalInvoice).mockResolvedValue({ applicable: false, message: 'This job is covered by warranty - there is nothing to pay.' });
    await openInvoiceTab();
    expect(await screen.findByText(/covered by warranty/i)).toBeInTheDocument();
  });

  it('shows the no-invoice-yet message when applicable but not yet created', async () => {
    vi.mocked(getPortalInvoice).mockResolvedValue({ applicable: true, invoiceCreated: false, message: 'No invoice has been generated yet.' });
    await openInvoiceTab();
    expect(await screen.findByText(/No invoice has been generated yet/i)).toBeInTheDocument();
  });

  it('shows a fully-paid confirmation with no owe-copy when amountDue is 0', async () => {
    vi.mocked(getPortalInvoice).mockResolvedValue(makePortalInvoiceView({ amountDue: 0, amountPaid: 367.5 }));
    await openInvoiceTab();
    expect(await screen.findByText(/Fully paid/i)).toBeInTheDocument();
    expect(screen.queryByText(/contact your service centre/i)).not.toBeInTheDocument();
  });
});

describe('CustomerPortalPage - Download Summary tab (lazy)', () => {
  it('fetches only once opened and renders estimate line items + a print button', async () => {
    vi.mocked(trackJob).mockResolvedValue(makePortalTrackView());
    vi.mocked(getPortalSummary).mockResolvedValue(makePortalSummaryView());
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(/JC-0001/);
    expect(getPortalSummary).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Download Summary' }));

    expect(getPortalSummary).toHaveBeenCalledWith('tok-1');
    expect(await screen.findByText(/Drum Motor Assembly/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Print/i })).toBeInTheDocument();
  });
});
