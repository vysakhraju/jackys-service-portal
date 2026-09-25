import { BadRequestException } from '@nestjs/common';
import { Appointment } from '../appointments/entities/appointment.entity';
import { ServicePriceList } from './entities/service-price-list.entity';

// Per-appointment Billing Channel (Phase 5, 2026-09-22 modification #4 gap fix; REVISED
// 2026-09-25 following the JER-C AED 0.00 invoice dead-end - see
// MODIFICATION_REQUESTS.md and the-fool pre-mortem discussion that day).
//
// Phase 5 originally let an appointment's picked Billing Channel override the matched
// Price List row using that channel's OWN flat `BillingChannel.defaultRate`. Real-world
// result: `defaultRate` defaults to null, a CCE hit the "must have a default rate" error
// and typed 0 just to get past it, and every appointment on that channel then silently
// invoiced at AED 0.00 - a real corporate account's job going out looking "paid in full
// for free" with no error anywhere. Root cause: two independent places could set a
// channel's price (BillingChannel.defaultRate vs. ServicePriceList.billingChannelRate)
// and the wrong one won unconditionally.
//
// Fix (owner's own decision, 2026-09-25): `BillingChannel.defaultRate` is retired as a
// pricing input. There is exactly ONE source of truth for what a Billing Channel bills
// at: the Price List row for the matched (category, jobType) - `billingChannelId`/
// `billingChannelRate` on ServicePriceList, same column that already existed since the
// Phase 3 rebuild. The appointment's picked Billing Channel now only SELECTS which
// channel to bill through; it never supplies its own rate.
//
//  1. No Billing Channel picked on the appointment -> return null (caller falls back to
//     its own plain B2B/B2C or warranty-labor price, as before).
//  2. A Billing Channel picked, and the matched Price List row is configured for that
//     SAME channel -> use the row's billingChannelRate. This is the normal, correct path
//     for a genuine negotiated-rate partner (e.g. JER-C) once Master Data has that
//     partner's per-category rate entered.
//  3. A Billing Channel picked, but the matched Price List row has no channel configured
//     (or a DIFFERENT one) -> throw. This is deliberate, not a gap: a CCE/system that
//     explicitly picked a channel and got silently billed some other way (or for free)
//     is exactly the dangerous-wrong-invoice scenario the previous design produced.
//     Surfacing a clear 400 naming the missing Price List row is the same "never invent
//     a number" rule every other pricing failure mode in this app already follows.
export interface ResolvedBillingChannel {
  billingChannelId: string;
  billingChannelName: string | null;
  rate: number;
}

export function resolveAppointmentBillingChannel(
  appointment: Appointment | null | undefined,
  priceRow: ServicePriceList,
): ResolvedBillingChannel | null {
  const pickedChannelId = appointment?.billingChannelId ?? null;

  if (!pickedChannelId) {
    if (priceRow.billingChannelId) {
      return {
        billingChannelId: priceRow.billingChannelId,
        billingChannelName: priceRow.billingChannel?.name ?? null,
        rate: Number(priceRow.billingChannelRate),
      };
    }
    return null;
  }

  if (priceRow.billingChannelId !== pickedChannelId) {
    const pickedChannelName = appointment?.billingChannel?.name ?? pickedChannelId;
    throw new BadRequestException(
      `Billing Channel "${pickedChannelName}" has no rate configured for this Category/Job Type - add a Price List row with that Billing Channel set before an invoice can be generated.`,
    );
  }

  return {
    billingChannelId: priceRow.billingChannelId,
    billingChannelName: priceRow.billingChannel?.name ?? null,
    rate: Number(priceRow.billingChannelRate),
  };
}
