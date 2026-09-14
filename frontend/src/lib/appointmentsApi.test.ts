import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  api: { get: vi.fn() },
}));

import { api } from './api';
import { searchAppointments } from './appointmentsApi';

beforeEach(() => {
  vi.mocked(api.get).mockReset();
});

// #218 pre-mortem follow-up (2026-09-14): searchAppointments() is what replaced JobCardsPage's
// old exact-match-only appointment lookup with a real narrowing search - see appointmentsApi.ts's
// doc comment for why.
describe('searchAppointments', () => {
  it('fetches GET /appointments with q + a small page limit, and returns just the data array', async () => {
    const appointments = [{ id: 'apt-1', appointmentNumber: 'APT-0055' }];
    vi.mocked(api.get).mockResolvedValue({ data: { data: appointments, total: 1, page: 1, limit: 8 } });

    const result = await searchAppointments('APT-005');

    expect(api.get).toHaveBeenCalledWith('/appointments', {
      params: expect.objectContaining({ q: 'APT-005', limit: 8 }),
    });
    expect(result).toBe(appointments);
  });
});
