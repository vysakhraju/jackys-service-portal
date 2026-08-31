import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from './api';
import { confirmReturn, getStaleReservations, getStock, grn, requestReturn, reviewReservation } from './inventoryApi';

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
});

describe('inventoryApi', () => {
  it('grn posts to /inventory/grn', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { sparePartId: 'sp1', quantityOnHand: 50 } });
    const input = { sparePartId: 'sp1', quantity: 50, notes: 'GRN against PO-2044' };
    await grn(input);
    expect(api.post).toHaveBeenCalledWith('/inventory/grn', input);
  });

  it('getStock defaults location param to nothing (backend defaults to MAIN_STORE)', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { sparePartId: 'sp1', quantityOnHand: 0, quantityReserved: 0 } });
    await getStock('sp1');
    expect(api.get).toHaveBeenCalledWith('/inventory/stock/sp1', { params: {} });
  });

  it('getStock passes DAMAGE_LOCATION through as a query param', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { sparePartId: 'sp1', quantityOnHand: 3, quantityReserved: 0 } });
    await getStock('sp1', 'DAMAGE_LOCATION');
    expect(api.get).toHaveBeenCalledWith('/inventory/stock/sp1', { params: { location: 'DAMAGE_LOCATION' } });
  });

  it('getStaleReservations fetches the one real list endpoint in this module', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    await getStaleReservations();
    expect(api.get).toHaveBeenCalledWith('/inventory/reservations/stale');
  });

  it('reviewReservation posts the decision payload', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'res1', status: 'RETURN_PENDING' } });
    await reviewReservation('res1', { decision: 'APPROVE_REALLOCATION', notes: 'reallocating' });
    expect(api.post).toHaveBeenCalledWith('/inventory/reservations/res1/review', {
      decision: 'APPROVE_REALLOCATION',
      notes: 'reallocating',
    });
  });

  it('requestReturn posts with no body', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'res1', status: 'RETURN_PENDING' } });
    await requestReturn('res1');
    expect(api.post).toHaveBeenCalledWith('/inventory/reservations/res1/request-return');
  });

  it('confirmReturn posts the quantity returned', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'res1', status: 'RETURNED', quantityReturned: 2 } });
    await confirmReturn('res1', { quantityReturned: 2 });
    expect(api.post).toHaveBeenCalledWith('/inventory/reservations/res1/confirm-return', { quantityReturned: 2 });
  });
});
