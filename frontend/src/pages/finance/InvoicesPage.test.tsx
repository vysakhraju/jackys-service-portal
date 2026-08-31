import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeInvoice, makePayment } from '../../test/fixtures';

vi.mock('../../lib/invoicingApi', () => ({
  listInvoices: vi.fn(),
  getInvoice: vi.fn(),
  getPayments: vi.fn(),
  recordPayment: vi.fn(),
  getInvoiceByJobCard: vi.fn(),
}));

import { getInvoice, getPayments, listInvoices } from '../../lib/invoicingApi';
import { InvoicesPage } from './InvoicesPage';

function renderPage(initialEntry = '/finance/invoices') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <InvoicesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listInvoices).mockReset();
  vi.mocked(getInvoice).mockReset();
  vi.mocked(getPayments).mockReset();
  vi.mocked(getPayments).mockResolvedValue([]);
});

describe('InvoicesPage - list + filters', () => {
  it('lists invoices with no filters applied by default', async () => {
    vi.mocked(listInvoices).mockResolvedValue([makeInvoice()]);
    renderPage();
    expect(await screen.findByText('INV-0001')).toBeInTheDocument();
    expect(listInvoices).toHaveBeenCalledWith({ status: undefined, customerType: undefined });
  });

  it('refetches with the status filter when a status button is clicked', async () => {
    vi.mocked(listInvoices).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No invoices match this filter.');
    await user.click(screen.getByRole('button', { name: 'Paid' }));
    await waitFor(() => expect(listInvoices).toHaveBeenLastCalledWith({ status: 'PAID', customerType: undefined }));
  });

  it('refetches with the customerType filter when the select changes', async () => {
    vi.mocked(listInvoices).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No invoices match this filter.');
    await user.selectOptions(screen.getByRole('combobox'), 'B2B');
    await waitFor(() => expect(listInvoices).toHaveBeenLastCalledWith({ status: undefined, customerType: 'B2B' }));
  });
});

describe('InvoicesPage - detail panel', () => {
  it('opens the detail panel with payment history and a Record Payment button when a row is selected', async () => {
    vi.mocked(listInvoices).mockResolvedValue([makeInvoice({ id: 'inv-1', status: 'PARTIALLY_PAID', amount: 500 })]);
    vi.mocked(getInvoice).mockResolvedValue(makeInvoice({ id: 'inv-1', status: 'PARTIALLY_PAID', amount: 500 }));
    vi.mocked(getPayments).mockResolvedValue([makePayment({ invoiceId: 'inv-1', amount: 200, method: 'CASH' })]);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('INV-0001');
    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(getInvoice).toHaveBeenCalledWith('inv-1');
    const paidSoFar = await screen.findByText(/Paid so far/);
    expect(paidSoFar).toHaveTextContent('AED 200.00');
    const remaining = screen.getByText(/^Remaining/);
    expect(remaining).toHaveTextContent('AED 300.00');
    expect(screen.getAllByText(/AED 200.00/).length).toBeGreaterThanOrEqual(1); // also in payment history
    expect(screen.getByRole('button', { name: 'Record Payment' })).toBeInTheDocument();
  });

  it('deep-links straight to the detail panel via ?invoiceId= without clicking a row', async () => {
    vi.mocked(listInvoices).mockResolvedValue([makeInvoice({ id: 'inv-9', invoiceNumber: 'INV-0009' })]);
    vi.mocked(getInvoice).mockResolvedValue(makeInvoice({ id: 'inv-9', invoiceNumber: 'INV-0009' }));
    renderPage('/finance/invoices?invoiceId=inv-9');
    expect(await screen.findByText(/Paid so far/)).toBeInTheDocument();
    expect(getInvoice).toHaveBeenCalledWith('inv-9');
  });

  it('hides Record Payment once the invoice is fully paid', async () => {
    vi.mocked(listInvoices).mockResolvedValue([makeInvoice({ id: 'inv-1', status: 'PAID' })]);
    vi.mocked(getInvoice).mockResolvedValue(makeInvoice({ id: 'inv-1', status: 'PAID' }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('INV-0001');
    await user.click(screen.getByRole('button', { name: 'View' }));
    await screen.findByText(/Paid so far/);
    expect(screen.queryByRole('button', { name: 'Record Payment' })).not.toBeInTheDocument();
  });
});
