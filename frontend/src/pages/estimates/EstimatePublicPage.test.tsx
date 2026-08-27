import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/estimatesApi', () => ({
  getPublicEstimate: vi.fn(),
  respondToPublicEstimate: vi.fn(),
}));

import { getPublicEstimate, respondToPublicEstimate } from '../../lib/estimatesApi';
import { EstimatePublicPage } from './EstimatePublicPage';

function renderPublicPage(token = 'tok-abc') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/estimate/${token}`]}>
        <Routes>
          <Route path="/estimate/:token" element={<EstimatePublicPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getPublicEstimate).mockReset();
  vi.mocked(respondToPublicEstimate).mockReset();
});

describe('EstimatePublicPage - error states are customer-safe and specific', () => {
  it('shows a clear message on 404 (unknown token)', async () => {
    vi.mocked(getPublicEstimate).mockRejectedValue({ response: { status: 404 } });
    renderPublicPage();
    expect(await screen.findByText(/couldn't find that estimate link/i)).toBeInTheDocument();
  });

  it('shows a clear message on 410 (expired or already responded to)', async () => {
    vi.mocked(getPublicEstimate).mockRejectedValue({ response: { status: 410 } });
    renderPublicPage();
    expect(await screen.findByText(/no longer active/i)).toBeInTheDocument();
  });
});

describe('EstimatePublicPage - happy path', () => {
  it('renders line items and totals, and lets the customer approve', async () => {
    const user = userEvent.setup();
    vi.mocked(getPublicEstimate).mockResolvedValue({
      jobCardNumber: 'JC-0001',
      brand: 'Samsung',
      lineItems: [{ description: 'Drum Motor Assembly', quantity: 1, unitPrice: 350 }],
      subtotal: 350,
      vatAmount: 17.5,
      totalAmount: 367.5,
      tokenExpiresAt: '2026-08-08T00:00:00Z',
    });
    vi.mocked(respondToPublicEstimate).mockResolvedValue({ id: 'e1', status: 'APPROVED' } as never);

    renderPublicPage();
    expect(await screen.findByText('JC-0001', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('AED 367.50')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/you've approved this estimate/i)).toBeInTheDocument();
    expect(respondToPublicEstimate).toHaveBeenCalledWith('tok-abc', { approved: true });
  });
});

describe('EstimatePublicPage - response race (the-fool pre-mortem finding #4)', () => {
  it('shows an "already responded" message on a 409 from the respond call, not a generic error', async () => {
    const user = userEvent.setup();
    vi.mocked(getPublicEstimate).mockResolvedValue({
      jobCardNumber: 'JC-0001',
      brand: null,
      lineItems: [{ description: 'Labor', quantity: 1, unitPrice: 100 }],
      subtotal: 100,
      vatAmount: 5,
      totalAmount: 105,
      tokenExpiresAt: null,
    });
    vi.mocked(respondToPublicEstimate).mockRejectedValue({ response: { status: 409 } });

    renderPublicPage();
    await screen.findByText('JC-0001', { exact: false });
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(screen.getByText(/already been responded to/i)).toBeInTheDocument();
    });
  });
});
