import { BadRequestException } from '@nestjs/common';
import { Appointment } from '../appointments/entities/appointment.entity';
import { ServicePriceList } from './entities/service-price-list.entity';

// Per-appointment Billing Channel override (Phase 5, 2026-09-22 modification #4 gap
// fix): the original request's point #4 asked for a "Billing Channel" dropdown on the
// New Appointment popup itself, but Phases 1-4 only ever wired Billing Channel into
// Price List rows (ServicePriceList.billingChannelId/billingChannelRate) - the New
// Appointment field was never actually built. This adds the appointment-level field
// (Appointment.billingChannelId/billingChannel, see that entity) and this shared
// resolver, used by both InvoicingService.resolveBaselinePricing and
// DebitNotesService.resolveLaborCost so the override logic isn't duplicated across the
// two call sites.
//
// Locked design decisions (both via explicit user choice):
//  1. The appointment's own picked Billing Channel, when set, OVERRIDES the matched
//     Price List row's own configured channel - it doesn't have to differ to win; an
//     appointment-level pick is always the more specific, more recently-stated intent.
//  2. The override amount is that channel's own flat `defaultRate` (a new column on
//     BillingChannel - see that entity), not the row's `billingChannelRate`. If the
//     picked channel has no `defaultRate` set, this throws rather than silently falling
//     back to 0 or to the row's rate - same "never invent a number" philosophy every
//     other pricing-resolution failure mode in this app already follows.
//
// Deliberately returns null (not a fallback amount) when neither an appointment
// override nor a row-configured channel applies - the "no channel at all" fallback
// (priceB2B for invoices, warrantyLaborCost for debit notes) differs by caller, so each
// caller applies its own fallback rather than this shared function guessing one.
export interface ResolvedBillingChannel {
  billingChannelId: string;
  billingChannelName: string | null;
  rate: number;
}

export function resolveAppointmentBillingChannel(
  appointment: Appointment | null | undefined,
  priceRow: ServicePriceList,
): ResolvedBillingChannel | null {
  const overrideChannel = appointment?.billingChannel;
  if (overrideChannel) {
    if (overrideChannel.defaultRate === null || overrideChannel.defaultRate === undefined) {
      throw new BadRequestException(
        `Billing Channel "${overrideChannel.name}" has no default rate set - set one on the Billing Channel master before an appointment using it can be billed.`,
      );
    }
    return {
      billingChannelId: overrideChannel.id,
      billingChannelName: overrideChannel.name,
      rate: Number(overrideChannel.defaultRate),
    };
  }

  if (priceRow.billingChannelId) {
    return {
      billingChannelId: priceRow.billingChannelId,
      billingChannelName: priceRow.billingChannel?.name ?? null,
      rate: Number(priceRow.billingChannelRate),
    };
  }

  return null;
}
