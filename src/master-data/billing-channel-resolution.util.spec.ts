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

  it("falls back to the Price List row's own channel/rate when the appointment has no channel picked", () => {
    const row = priceRow({ billingChannelId: 'bc-row', billingChannelRate: 80, billingChannel: { id: 'bc-row', name: 'Row Channel' } });

    const result = resolveAppointmentBillingChannel({} as any, row);

    expect(result).toEqual({ billingChannelId: 'bc-row', billingChannelName: 'Row Channel', rate: 80 });
  });

  it('uses the Price List row rate when the appointment picks the SAME channel the row is configured for', () => {
    const row = priceRow({ billingChannelId: 'bc-jer-c', billingChannelRate: 55, billingChannel: { id: 'bc-jer-c', name: 'JER-C' } });
    const appointment = { billingChannelId: 'bc-jer-c', billingChannel: { id: 'bc-jer-c', name: 'JER-C' } } as any;

    const result = resolveAppointmentBillingChannel(appointment, row);

    expect(result).toEqual({ billingChannelId: 'bc-jer-c', billingChannelName: 'JER-C', rate: 55 });
  });

  it('throws rather than silently billing plain/other-channel rate when the picked channel has no matching Price List row rate', () => {
    const appointment = { billingChannelId: 'bc-jer-c', billingChannel: { id: 'bc-jer-c', name: 'JER-C' } } as any;

    expect(() => resolveAppointmentBillingChannel(appointment, priceRow())).toThrow(BadRequestException);
    expect(() => resolveAppointmentBillingChannel(appointment, priceRow())).toThrow(/JER-C/);
  });

  it('throws when the picked channel differs from the channel the Price List row is actually configured for', () => {
    const row = priceRow({ billingChannelId: 'bc-other', billingChannelRate: 80, billingChannel: { id: 'bc-other', name: 'Other Channel' } });
    const appointment = { billingChannelId: 'bc-jer-c', billingChannel: { id: 'bc-jer-c', name: 'JER-C' } } as any;

    expect(() => resolveAppointmentBillingChannel(appointment, row)).toThrow(BadRequestException);
  });

  it('never reads BillingChannel.defaultRate at all - a channel-level flat rate no longer drives pricing', () => {
    const row = priceRow({ billingChannelId: 'bc-jer-c', billingChannelRate: 55, billingChannel: { id: 'bc-jer-c', name: 'JER-C' } });
    const appointment = {
      billingChannelId: 'bc-jer-c',
      billingChannel: { id: 'bc-jer-c', name: 'JER-C', defaultRate: 0 },
    } as any;

    const result = resolveAppointmentBillingChannel(appointment, row);

    expect(result?.rate).toBe(55);
  });
});
