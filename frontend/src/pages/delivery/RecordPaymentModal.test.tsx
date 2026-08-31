import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeInvoice, makePayment } from '../../test/fixtures';

vi.mock('../../lib/invoicingApi', () => ({
  getInvoiceByJobCard: vi.fn(),
  getInvoice: vi.fn(),
  getPayments: vi.fn(),
  recordPayment: vi.fn(),
}));

import { getInvoice, getInvoiceByJobCard, getPayments, recordPayment } from '../../lib/invoicingApi';
import { RecordPaymentModal } from './RecordPaymentModal';

function renderModal(props: Partial<React.ComponentProps<typeof RecordPaymentModal>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecordPaymentModal open onClose={vi.fn()} jobCardId="jc-1" {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getInvoiceByJobCard).mockReset();
  vi.mocked(getInvoice).mockReset();
  vi.mocked(getPayments).mockReset();
  vi.mocked(getPayments).mockResolvedValue([]);
  vi.mocked(recordPayment).mockReset();
});

describe('RecordPaymentModal - fetch path', () => {
  it('looks up by job card id when no invoiceId is known (may lazily create a DRAFT)', async () => {
    vi.mocked(getInvoiceByJobCard).mockResolvedValue(makeInvoice());
    renderModal({ jobCardId: 'jc-1' });
    expect(await screen.findByText('INV-0001')).toBeInTheDocument();
    expect(getInvoiceByJobCard).toHaveBeenCalledWith('jc-1');
    expect(getInvoice).not.toHaveBeenCalled();
  });

  it('fetches directly by invoiceId when already known, skipping the job-card lookup', async () => {
    vi.mocked(getInvoice).mockResolvedValue(makeInvoice({ id: 'inv-9', invoiceNumber: 'INV-0009' }));
    renderModal({ jobCardId: 'jc-1', invoiceId: 'inv-9' });
    expect(await screen.findByText('INV-0009')).toBeInTheDocument();
    expect(getInvoice).toHaveBeenCalledWith('inv-9');
    expect(getInvoiceByJobCard).not.toHaveBeenCalled();
  });
});

describe('RecordPaymentModal - recording a payment', () => {
  it('submits the entered method/amount/reference and shows the PAID confirmation on success', async () => {
    vi.mocked(getInvoiceByJobCard).mockResolvedValue(makeInvoice({ status: 'DRAFT', amount: 367.5 }));
    vi.mocked(recordPayment).mockResolvedValue(makeInvoice({ status: 'PAID', amount: 367.5 }));
    const user = userEvent.setup();
    renderModal();

    await screen.findByText('INV-0001');
    await user.selectOptions(screen.getByLabelText(/Payment method/i), 'CARD');
    const amountInput = screen.getByLabelText(/Amount received/i);
    await user.clear(amountInput);
    await user.type(amountInput, '367.5');
    await user.type(screen.getByLabelText(/Reference/i), 'slip-42');
    await user.click(screen.getByRole('button', { name: /Record Payment/i }));

    expect(recordPayment).toHaveBeenCalledWith('inv-1', { method: 'CARD', amountReceived: 367.5, reference: 'slip-42' });
    expect(await screen.findByText(/now PAID/i)).toBeInTheDocument();
  });

  it('shows an already-settled notice instead of a form when the invoice is already PAID', async () => {
    vi.mocked(getInvoiceByJobCard).mockResolvedValue(makeInvoice({ status: 'PAID' }));
    renderModal();
    expect(await screen.findByText(/Already fully paid/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Record Payment/i })).not.toBeInTheDocument();
    // A settled invoice has no remaining balance to compute - the payments-history fetch
    // is skipped entirely (enabled: !settled), not just its result ignored.
    expect(getPayments).not.toHaveBeenCalled();
  });
});

describe('RecordPaymentModal - remaining-balance default (bug fix)', () => {
  it('defaults amountReceived to the full amount when no payments exist yet', async () => {
    vi.mocked(getInvoiceByJobCard).mockResolvedValue(makeInvoice({ id: 'inv-1', status: 'DRAFT', amount: 367.5 }));
    vi.mocked(getPayments).mockResolvedValue([]);
    renderModal();

    await screen.findByText('INV-0001');
    expect(getPayments).toHaveBeenCalledWith('inv-1');
    expect(await screen.findByLabelText(/Amount received/i)).toHaveValue(367.5);
  });

  it('defaults amountReceived to the REMAINING balance, not the full amount, once a partial payment already exists', async () => {
    vi.mocked(getInvoiceByJobCard).mockResolvedValue(makeInvoice({ id: 'inv-1', status: 'PARTIALLY_PAID', amount: 367.5 }));
    vi.mocked(getPayments).mockResolvedValue([makePayment({ invoiceId: 'inv-1', amount: 200 })]);
    renderModal();

    await screen.findByText('INV-0001');
    // The old behaviour defaulted this to 367.5 (the full amount) even though 200 was
    // already paid - a second payment at that default would have 400'd server-side
    // ("exceeds remaining balance"). It must now default to 167.5, the true remainder.
    const amountInput = await screen.findByLabelText(/Amount received/i);
    expect(amountInput).toHaveValue(167.5);
  });

  it('sums multiple partial payments, not just the latest one, when computing the remaining default', async () => {
    vi.mocked(getInvoiceByJobCard).mockResolvedValue(makeInvoice({ id: 'inv-1', status: 'PARTIALLY_PAID', amount: 500 }));
    vi.mocked(getPayments).mockResolvedValue([
      makePayment({ id: 'pay-1', invoiceId: 'inv-1', amount: 150 }),
      makePayment({ id: 'pay-2', invoiceId: 'inv-1', amount: 100 }),
    ]);
    renderModal();

    await screen.findByText('INV-0001');
    expect(await screen.findByLabelText(/Amount received/i)).toHaveValue(250);
  });
});
