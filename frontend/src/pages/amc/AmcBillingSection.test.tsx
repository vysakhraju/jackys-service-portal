import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeAmcBillingInvoice } from '../../test/fixtures';

vi.mock('../../lib/amcApi', () => ({
  getAmcBillingInvoicesForContract: vi.fn(),
  generateAmcBillingInvoice: vi.fn(),
  recordAmcBillingPayment: vi.fn(),
}));

import { generateAmcBillingInvoice, getAmcBillingInvoicesForContract, recordAmcBillingPayment } from '../../lib/amcApi';
import { AmcBillingSection } from './AmcBillingSection';

function renderSection(canBill = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AmcBillingSection contractId="contract-1" canBill={canBill} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getAmcBillingInvoicesForContract).mockReset();
  vi.mocked(generateAmcBillingInvoice).mockReset();
  vi.mocked(recordAmcBillingPayment).mockReset();
});

describe('AmcBillingSection', () => {
  it('hides "Generate invoice" for a non-billing role', async () => {
    vi.mocked(getAmcBillingInvoicesForContract).mockResolvedValue([]);
    renderSection(false);
    await screen.findByText('No billing invoices generated yet.');
    expect(screen.queryByText('+ Generate invoice')).not.toBeInTheDocument();
  });

  it('the generate-invoice form has only a period label field, no amount input', async () => {
    vi.mocked(getAmcBillingInvoicesForContract).mockResolvedValue([]);
    const user = userEvent.setup();
    renderSection(true);
    await screen.findByText('No billing invoices generated yet.');
    await user.click(screen.getByText('+ Generate invoice'));

    expect(screen.getByLabelText(/Period label/i)).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument(); // no number input anywhere in this form
  });

  it('submits the generate form with the typed period label', async () => {
    vi.mocked(getAmcBillingInvoicesForContract).mockResolvedValue([]);
    vi.mocked(generateAmcBillingInvoice).mockResolvedValue(makeAmcBillingInvoice());
    const user = userEvent.setup();
    renderSection(true);
    await screen.findByText('No billing invoices generated yet.');
    await user.click(screen.getByText('+ Generate invoice'));
    await user.type(screen.getByLabelText(/Period label/i), 'Q1 2026');
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    expect(generateAmcBillingInvoice).toHaveBeenCalledWith('contract-1', 'Q1 2026');
  });

  it('only shows "Record payment" for a DRAFT invoice, not a PAID one', async () => {
    vi.mocked(getAmcBillingInvoicesForContract).mockResolvedValue([
      makeAmcBillingInvoice({ id: 'bi-1', invoiceNumber: 'AMCINV-0001', status: 'DRAFT' }),
      makeAmcBillingInvoice({ id: 'bi-2', invoiceNumber: 'AMCINV-0002', status: 'PAID', paymentMethod: 'CASH', paidAt: '2026-08-01T08:00:00Z' }),
    ]);
    renderSection(true);
    await screen.findByText('AMCINV-0001');
    expect(screen.getAllByRole('button', { name: 'Record payment' })).toHaveLength(1);
    expect(screen.getByText(/Paid via CASH/i)).toBeInTheDocument();
  });

  it('the payment form has method + reference but no amount field (full-amount-only settlement)', async () => {
    vi.mocked(getAmcBillingInvoicesForContract).mockResolvedValue([
      makeAmcBillingInvoice({ id: 'bi-1', invoiceNumber: 'AMCINV-0001', status: 'DRAFT' }),
    ]);
    const user = userEvent.setup();
    renderSection(true);
    await screen.findByText('AMCINV-0001');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(screen.getByLabelText(/Method/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Reference/i)).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.getByText(/no partial-payment concept/i)).toBeInTheDocument();
  });

  it('submits the payment form with method + reference (no amount)', async () => {
    vi.mocked(getAmcBillingInvoicesForContract).mockResolvedValue([
      makeAmcBillingInvoice({ id: 'bi-1', invoiceNumber: 'AMCINV-0001', status: 'DRAFT' }),
    ]);
    vi.mocked(recordAmcBillingPayment).mockResolvedValue(makeAmcBillingInvoice({ status: 'PAID' }));
    const user = userEvent.setup();
    renderSection(true);
    await screen.findByText('AMCINV-0001');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    await user.selectOptions(screen.getByLabelText(/Method/i), 'BANK_TRANSFER');
    await user.type(screen.getByLabelText(/Reference/i), 'txn-99');
    await user.click(screen.getByRole('button', { name: 'Mark paid' }));

    expect(recordAmcBillingPayment).toHaveBeenCalledWith('bi-1', 'BANK_TRANSFER', 'txn-99');
  });
});
