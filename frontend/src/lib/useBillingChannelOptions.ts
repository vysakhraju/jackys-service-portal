// Price List rebuild (requested 2026-09-22, Phase 3) - a shared NamePicker options source
// for the Price List form's optional Billing Channel picker, mirroring
// useSparePartModelOptions.ts's own shape exactly. GET /master-data/billing-channels is
// open to any authenticated user (no @Roles/@RequiresCapability on it - see
// BillingChannelsPage.tsx), so this needs no accessible/fallback split either.
//
// Unlike spare part models, BillingChannel's real id (a uuid) IS what gets submitted
// (ServicePriceList.billingChannelId is @IsUUID), so the option's `id` here is the
// entity's own `.id`, not a business-string key.
import { useQuery } from '@tanstack/react-query';
import { listBillingChannels } from './masterDataApi';
import type { NamePickerOption } from '../components/pickers/NamePicker';

export function useBillingChannelOptions(): { options: NamePickerOption[]; loading: boolean } {
  const { data, isLoading } = useQuery({ queryKey: ['master-data', 'billing-channels'], queryFn: () => listBillingChannels() });
  const options = (data ?? []).filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name }));
  return { options, loading: isLoading };
}
