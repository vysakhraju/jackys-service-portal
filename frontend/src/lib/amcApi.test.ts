import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from './api';
import {
  cancelAmcContract,
  completeAmcVisit,
  createAmcContract,
  generateAmcBillingInvoice,
  getAmcBillingInvoice,
  getAmcBillingInvoicesForContract,
  getAmcContract,
  getAmcContractByNumber,
  getAmcSchedule,
  getAmcUpsellCandidates,
  getAmcVisitCompletion,
  getExpiringAmcContracts,
  listAmcContracts,
  recordAmcBillingPayment,
  renewAmcContract,
  sendAmcRenewalReminder,
} from './amcApi';

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
});

describe('amcApi', () => {
  it('createAmcContract posts to /amc/contracts with the payload', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    const input = { customerName: 'Jane', customerPhone: '+971500000000' } as any;
    await createAmcContract(input);
    expect(api.post).toHaveBeenCalledWith('/amc/contracts', input);
  });

  it('listAmcContracts fetches GET /amc/contracts with an optional status param', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await listAmcContracts('ACTIVE');
    expect(api.get).toHaveBeenCalledWith('/amc/contracts', { params: { status: 'ACTIVE' } });

    await listAmcContracts();
    expect(api.get).toHaveBeenCalledWith('/amc/contracts', { params: {} });
  });

  it('getExpiringAmcContracts fetches GET /amc/contracts/expiring with withinDays (default 30)', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await getExpiringAmcContracts();
    expect(api.get).toHaveBeenCalledWith('/amc/contracts/expiring', { params: { withinDays: 30 } });

    await getExpiringAmcContracts(60);
    expect(api.get).toHaveBeenCalledWith('/amc/contracts/expiring', { params: { withinDays: 60 } });
  });

  it('getAmcUpsellCandidates fetches GET /amc/upsell-candidates', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await getAmcUpsellCandidates();
    expect(api.get).toHaveBeenCalledWith('/amc/upsell-candidates');
  });

  it('getAmcContractByNumber fetches GET /amc/contracts/number/:contractNumber (URL-encoded)', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await getAmcContractByNumber('AMC-0001');
    expect(api.get).toHaveBeenCalledWith('/amc/contracts/number/AMC-0001');
  });

  it('getAmcContract fetches GET /amc/contracts/:id', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await getAmcContract('contract-1');
    expect(api.get).toHaveBeenCalledWith('/amc/contracts/contract-1');
  });

  it('getAmcSchedule fetches GET /amc/contracts/:id/schedule', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await getAmcSchedule('contract-1');
    expect(api.get).toHaveBeenCalledWith('/amc/contracts/contract-1/schedule');
  });

  it('renewAmcContract posts to /amc/contracts/:id/renew with the payload', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    const input = { startDate: '2027-09-01', endDate: '2028-08-31', totalAmount: 5000 } as any;
    await renewAmcContract('contract-1', input);
    expect(api.post).toHaveBeenCalledWith('/amc/contracts/contract-1/renew', input);
  });

  it('cancelAmcContract posts to /amc/contracts/:id/cancel with the reason', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await cancelAmcContract('contract-1', 'Customer requested');
    expect(api.post).toHaveBeenCalledWith('/amc/contracts/contract-1/cancel', { reason: 'Customer requested' });
  });

  it('sendAmcRenewalReminder posts to /amc/contracts/:id/send-renewal-reminder with no body', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { attempted: [], delivered: [] } });
    await sendAmcRenewalReminder('contract-1');
    expect(api.post).toHaveBeenCalledWith('/amc/contracts/contract-1/send-renewal-reminder');
  });

  it('completeAmcVisit posts to /amc/visits/:appointmentId/complete with the payload', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    const input = { checklistNotes: 'All good' };
    await completeAmcVisit('apt-1', input);
    expect(api.post).toHaveBeenCalledWith('/amc/visits/apt-1/complete', input);
  });

  it('getAmcVisitCompletion fetches GET /amc/visits/:appointmentId/completion', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await getAmcVisitCompletion('apt-1');
    expect(api.get).toHaveBeenCalledWith('/amc/visits/apt-1/completion');
  });

  it('generateAmcBillingInvoice posts to /amc/contracts/:id/billing-invoices with periodLabel', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await generateAmcBillingInvoice('contract-1', 'Full Term');
    expect(api.post).toHaveBeenCalledWith('/amc/contracts/contract-1/billing-invoices', { periodLabel: 'Full Term' });
  });

  it('getAmcBillingInvoicesForContract fetches GET /amc/contracts/:id/billing-invoices', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await getAmcBillingInvoicesForContract('contract-1');
    expect(api.get).toHaveBeenCalledWith('/amc/contracts/contract-1/billing-invoices');
  });

  it('getAmcBillingInvoice fetches GET /amc/billing-invoices/:id', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await getAmcBillingInvoice('bi-1');
    expect(api.get).toHaveBeenCalledWith('/amc/billing-invoices/bi-1');
  });

  it('recordAmcBillingPayment posts to /amc/billing-invoices/:id/record-payment with method + reference', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await recordAmcBillingPayment('bi-1', 'CASH', 'slip-1');
    expect(api.post).toHaveBeenCalledWith('/amc/billing-invoices/bi-1/record-payment', { method: 'CASH', reference: 'slip-1' });
  });
});
