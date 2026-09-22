import { BadRequestException } from '@nestjs/common';
import { resolveAppointmentBillingChannel } from './billing-channel-resolution.util';

describe('resolveAppointmentBillingChannel', () => {
  const priceRow = (overrides: any = {}) =>
    ({
      id: 'price-1',
      billingChannelId: null,
      billingChannelRate: 0,
      billingChannel: null,
      ...overrides,
    } as any);

  it('returns null when neither the appointment nor the Price List row has a channel', () => {
    const result = resolveAppointmentBillingChannel({} as any, priceRow());
    expect(result).toBeNull();
  });

  it('returns null when the appointment is null/undefined and the row has no channel', () => {
    expect(resolveAppointmentBillingChannel(null, priceRow())).toBeNull();
    expect(resolveAppointmentBillingChannel(undefined, priceRow())).toBeNull();
  });

  it('falls back to the Price List row\'s own channel/rate when the appointment has no override', () => {
    const row = priceRow({ billingChannelId: 'bc-row', billingChannelRate: 80, billingChannel: { id: 'bc-row', name: 'Row Channel' } });

    const result = resolveAppointmentBillingChannel({} as any, row);

    expect(result).toEqual({ billingChannelId: 'bc-row', billingChannelName: 'Row Channel', rate: 80 });
  });

  it("the appointment's own picked channel overrides the row's channel, using the channel's own defaultRate", () => {
    const row = priceRow({ billingChannelId: 'bc-row', billingChannelRate: 80, billingChannel: { id: 'bc-row', name: 'Row Channel' } });
    const appointment = { billingChannel: { id: 'bc-appt', name: 'Appointment Channel', defaultRate: 120 } } as any;

    const result = resolveAppointmentBillingChannel(appointment, row);

    expect(result).toEqual({ billingChannelId: 'bc-appt', billingChannelName: 'Appointment Channel', rate: 120 });
  });

  it('the appointment override wins even when the row has no channel configured at all', () => {
    const appointment = { billingChannel: { id: 'bc-appt', name: 'Appointment Channel', defaultRate: 99 } } as any;

    const result = resolveAppointmentBillingChannel(appointment, priceRow());

    expect(result).toEqual({ billingChannelId: 'bc-appt', billingChannelName: 'Appointment Channel', rate: 99 });
  });

  it('throws rather than silently falling back when the picked channel has no defaultRate set', () => {
    const appointment = { billingChannel: { id: 'bc-appt', name: 'No Rate Channel', defaultRate: null } } as any;

    expect(() => resolveAppointmentBillingChannel(appointment, priceRow())).toThrow(BadRequestException);
    expect(() => resolveAppointmentBillingChannel(appointment, priceRow())).toThrow(/No Rate Channel/);
  });

  it('throws when the picked channel\'s defaultRate is undefined (never set)', () => {
    const appointment = { billingChannel: { id: 'bc-appt', name: 'Undefined Rate Channel' } } as any;

    expect(() => resolveAppointmentBillingChannel(appointment, priceRow())).toThrow(BadRequestException);
  });

  it('treats defaultRate 0 as a valid, set rate (not "missing")', () => {
    const appointment = { billingChannel: { id: 'bc-appt', name: 'Zero Rate Channel', defaultRate: 0 } } as any;

    const result = resolveAppointmentBillingChannel(appointment, priceRow());

    expect(result).toEqual({ billingChannelId: 'bc-appt', billingChannelName: 'Zero Rate Channel', rate: 0 });
  });
});
