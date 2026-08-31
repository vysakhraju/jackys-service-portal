import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeInvoice } from '../../test/fixtures';

vi.mock('../../lib/invoicingApi', () => ({
  getInvoiceByJobCard: vi.fn(),
  getInvoice: vi.fn(),
  recordPayment: vi.fn(),
}));

import { getInvoice, getInvoiceByJobCard, recordPayment } from '../../lib/invoicingApi';
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
  });
});
