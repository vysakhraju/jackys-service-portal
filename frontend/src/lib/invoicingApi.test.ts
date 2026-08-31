import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from './api';
import { getB2bAging, getInvoice, getInvoiceByJobCard, getPayments, listInvoices, recordPayment } from './invoicingApi';

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
});

describe('invoicingApi', () => {
  it('getInvoiceByJobCard fetches GET /invoicing/job-card/:jobCardId', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await getInvoiceByJobCard('jc-1');
    expect(api.get).toHaveBeenCalledWith('/invoicing/job-card/jc-1');
  });

  it('getInvoice fetches GET /invoicing/:id', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await getInvoice('inv-1');
    expect(api.get).toHaveBeenCalledWith('/invoicing/inv-1');
  });

  it('getPayments fetches GET /invoicing/:id/payments', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await getPayments('inv-1');
    expect(api.get).toHaveBeenCalledWith('/invoicing/inv-1/payments');
  });

  it('recordPayment posts to /invoicing/:id/record-payment with the payment payload', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    const input = { method: 'CASH' as const, amountReceived: 367.5, reference: 'slip-42' };
    await recordPayment('inv-1', input);
    expect(api.post).toHaveBeenCalledWith('/invoicing/inv-1/record-payment', input);
  });

  // Frontend Phase 9 additions - the two read primitives Phase 8 deliberately deferred.
  it('listInvoices fetches GET /invoicing with no params when called with nothing', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await listInvoices();
    expect(api.get).toHaveBeenCalledWith('/invoicing', { params: undefined });
  });

  it('listInvoices passes status/customerType through as query params', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await listInvoices({ status: 'PARTIALLY_PAID', customerType: 'B2B' });
    expect(api.get).toHaveBeenCalledWith('/invoicing', { params: { status: 'PARTIALLY_PAID', customerType: 'B2B' } });
  });

  it('getB2bAging fetches GET /invoicing/b2b-aging', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { buckets: [], totalOutstanding: 0 } });
    await getB2bAging();
    expect(api.get).toHaveBeenCalledWith('/invoicing/b2b-aging');
  });
});
