import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from './api';
import {
  cancelDelivery,
  capturePod,
  createDelivery,
  dispatchDelivery,
  getDelivery,
  getDeliveryByJobCard,
  getDeliveryJobCards,
  getReadyForDelivery,
  listDeliveries,
} from './deliveryApi';

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
});

describe('deliveryApi', () => {
  it('getReadyForDelivery fetches GET /delivery/ready with a warrantyStatus param when given', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await getReadyForDelivery('OOW');
    expect(api.get).toHaveBeenCalledWith('/delivery/ready', { params: { warrantyStatus: 'OOW' } });
  });

  it('getReadyForDelivery omits params entirely when no warrantyStatus given', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await getReadyForDelivery();
    expect(api.get).toHaveBeenCalledWith('/delivery/ready', { params: undefined });
  });

  it('getDeliveryByJobCard fetches GET /delivery/job-card/:jobCardId', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null });
    await getDeliveryByJobCard('jc-1');
    expect(api.get).toHaveBeenCalledWith('/delivery/job-card/jc-1');
  });

  it('createDelivery posts to /delivery with the job card ids', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { delivery: {}, jobCards: [] } });
    const input = { jobCardIds: ['jc-1', 'jc-2'] };
    await createDelivery(input);
    expect(api.post).toHaveBeenCalledWith('/delivery', input);
  });

  it('listDeliveries fetches GET /delivery with a status param when given', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await listDeliveries('DISPATCHED');
    expect(api.get).toHaveBeenCalledWith('/delivery', { params: { status: 'DISPATCHED' } });
  });

  it('listDeliveries omits params entirely when no status given', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await listDeliveries();
    expect(api.get).toHaveBeenCalledWith('/delivery', { params: undefined });
  });

  it('getDelivery fetches GET /delivery/:id', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await getDelivery('del-1');
    expect(api.get).toHaveBeenCalledWith('/delivery/del-1');
  });

  it('getDeliveryJobCards fetches GET /delivery/:id/job-cards', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await getDeliveryJobCards('del-1');
    expect(api.get).toHaveBeenCalledWith('/delivery/del-1/job-cards');
  });

  it('dispatchDelivery posts to /delivery/:id/dispatch with the driver id', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await dispatchDelivery('del-1', { driverUserId: 'driver-1' });
    expect(api.post).toHaveBeenCalledWith('/delivery/del-1/dispatch', { driverUserId: 'driver-1' });
  });

  it('capturePod posts to /delivery/:id/pod with the POD payload', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    const input = { signatureBase64: 'data:image/png;base64,abc', recipientName: 'Jane Doe' };
    await capturePod('del-1', input);
    expect(api.post).toHaveBeenCalledWith('/delivery/del-1/pod', input);
  });

  it('cancelDelivery posts to /delivery/:id/cancel with the reason', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await cancelDelivery('del-1', { reason: 'Customer changed mind' });
    expect(api.post).toHaveBeenCalledWith('/delivery/del-1/cancel', { reason: 'Customer changed mind' });
  });
});
