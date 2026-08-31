import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeAgingBucket, makeInvoice } from '../../test/fixtures';

vi.mock('../../lib/invoicingApi', () => ({
  getB2bAging: vi.fn(),
}));

import { getB2bAging } from '../../lib/invoicingApi';
import { AgingReportPage } from './AgingReportPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AgingReportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getB2bAging).mockReset();
});

describe('AgingReportPage', () => {
  it('renders the total outstanding and all 4 buckets, even the empty ones', async () => {
    vi.mocked(getB2bAging).mockResolvedValue({
      totalOutstanding: 1200,
      buckets: [
        makeAgingBucket({ label: '0-30 days', totalOutstanding: 500, invoices: [makeInvoice({ id: 'inv-1', invoiceNumber: 'INV-0001' })] }),
        makeAgingBucket({ label: '31-60 days' }),
        makeAgingBucket({ label: '61-90 days' }),
        makeAgingBucket({ label: '90+ days', totalOutstanding: 700, invoices: [makeInvoice({ id: 'inv-2', invoiceNumber: 'INV-0002' })] }),
      ],
    });
    renderPage();

    expect(await screen.findByText('AED 1200.00')).toBeInTheDocument();
    expect(screen.getByText('0-30 days')).toBeInTheDocument();
    expect(screen.getByText('31-60 days')).toBeInTheDocument();
    expect(screen.getByText('61-90 days')).toBeInTheDocument();
    expect(screen.getByText('90+ days')).toBeInTheDocument();
    expect(screen.getAllByText('Nothing in this bucket.')).toHaveLength(2); // the two empty buckets
    expect(screen.getByText('INV-0001')).toBeInTheDocument();
    expect(screen.getByText('INV-0002')).toBeInTheDocument();
  });

  it('links each invoice row to the Invoices tab detail view via ?invoiceId=', async () => {
    vi.mocked(getB2bAging).mockResolvedValue({
      totalOutstanding: 500,
      buckets: [
        makeAgingBucket({ label: '0-30 days', totalOutstanding: 500, invoices: [makeInvoice({ id: 'inv-1', invoiceNumber: 'INV-0001' })] }),
        makeAgingBucket({ label: '31-60 days' }),
        makeAgingBucket({ label: '61-90 days' }),
        makeAgingBucket({ label: '90+ days' }),
      ],
    });
    renderPage();

    const link = await screen.findByRole('link', { name: /View/ });
    expect(link).toHaveAttribute('href', '/finance/invoices?invoiceId=inv-1');
  });
});
