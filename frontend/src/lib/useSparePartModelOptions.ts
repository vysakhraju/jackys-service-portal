// #218/#252: a shared NamePicker options source for the Spare Part Model pickers
// (PriceListsPage x2, ComponentYieldPage x2). GET /master-data/spare-part-models is open to
// any authenticated user (no @Roles/@RequiresCapability on it), so unlike the technician
// pickers this needs no accessible/fallback split.
//
// Spare part models are keyed by a human business string (SparePartModel.modelId, e.g.
// "WA80J5710"), NOT the entity's real uuid (SparePartModel.id) - the option's `id` here IS
// that modelId string, and it must be submitted as-is (never `.id`), matching how Price
// List / Component Yield DTOs validate it (@IsString @MaxLength(50), never @IsUUID).
import { useQuery } from '@tanstack/react-query';
import { listSparePartModels } from './masterDataApi';
import type { NamePickerOption } from '../components/pickers/NamePicker';

export function useSparePartModelOptions(): { options: NamePickerOption[]; loading: boolean } {
  const { data, isLoading } = useQuery({ queryKey: ['master-data', 'spare-part-models'], queryFn: listSparePartModels });
  const options = (data ?? []).map((m) => ({ id: m.modelId, name: `${m.brand} ${m.modelName}` }));
  return { options, loading: isLoading };
}
