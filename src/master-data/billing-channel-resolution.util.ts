import { BadRequestException } from '@nestjs/common';
import { Repository, IsNull } from 'typeorm';
import { ApplianceCategory } from './entities/fault-symptom.entity';
import { ServicePriceList, JobType, CustomerType } from './entities/service-price-list.entity';

// Super-admin pricing matrix rebuild (2026-09-25) - replaces the old per-
// (Category,JobType) Price List row (with baked-in priceB2B/priceB2C/billingChannelRate
// columns) with one row per (Category, JobType, CustomerType, BillingChannel) tuple and a
// single `price` column. This retires resolveAppointmentBillingChannel() (the old
// "take an already-fetched priceRow + appointment, branch on B2B/B2C or channel"
// function) in favor of resolvePriceListRow() below, which does the DB lookup itself
// against all 4 dimensions - callers no longer branch on customerType at all, since it's
// now baked into the lookup.
//
// Same "never invent a number" hard-stop philosophy this app already follows everywhere
// else: no matching active row -> throw a clear 400 naming exactly what Price List row
// to add, never silently fall back to a different channel/customerType's price.
//
//  1. No Billing Channel picked (billingChannelId null) -> match only rows with
//     billingChannelId IS NULL for that (category, jobType, customerType). Postgres
//     treats each NULL as distinct in a unique index, so app-level lookup (not a DB
//     constraint) is what actually enforces "at most one null-channel row" in practice -
//     see master-data.service.ts's create/import duplicate checks for the enforcement
//     side of this.
//  2. A Billing Channel picked -> match only rows with that EXACT billingChannelId. A
//     picked channel with no row configured for it never falls back to the null-channel
//     row - that silent-substitution was the root cause of the JER-C AED 0.00 invoice
//     bug (see git history / MODIFICATION_REQUESTS.md 2026-09-25) and the same discipline
//     applies here.
export interface ResolvedPriceListRow {
  row: ServicePriceList;
  billingChannelId: string | null;
  billingChannelName: string | null;
}

export interface ResolvePriceListRowParams {
  category: ApplianceCategory;
  jobType: JobType;
  customerType: CustomerType;
  billingChannelId: string | null;
  // Only used to name the channel in the error message when no row matches - never used
  // for the lookup itself (billingChannelId alone drives the query).
  billingChannelName?: string | null;
}

export async function resolvePriceListRow(
  priceListRepository: Repository<ServicePriceList>,
  params: ResolvePriceListRowParams,
): Promise<ResolvedPriceListRow> {
  const { category, jobType, customerType, billingChannelId } = params;

  const row = await priceListRepository.findOne({
    where: {
      category,
      jobType,
      customerType,
      billingChannelId: billingChannelId ?? IsNull(),
      isActive: true,
    },
    relations: { billingChannel: true },
  });

  if (!row) {
    if (billingChannelId) {
      const channelLabel = params.billingChannelName ?? billingChannelId;
      throw new BadRequestException(
        `No active Price List row exists for ${category} / ${jobType} / ${customerType} on Billing Channel "${channelLabel}" - add one before an invoice can be generated. A channel-billed job needs its own Price List row; it will not fall back to the non-channel rate.`,
      );
    }
    throw new BadRequestException(
      `No active Price List row exists for ${category} / ${jobType} / ${customerType} - add one before an invoice can be generated.`,
    );
  }

  return {
    row,
    billingChannelId: row.billingChannelId,
    billingChannelName: row.billingChannel?.name ?? null,
  };
}
