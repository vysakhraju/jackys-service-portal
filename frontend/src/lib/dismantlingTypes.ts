// Shapes mirror src/dismantling/entities/dismantling-record.entity.ts and
// src/dismantling/dto/*.ts exactly (Frontend Phase 11, BRD Workflow 15 / FR-19 /
// AC-29-31). Standalone entity, NOT tied to JobCard - recovery of a whole write-off
// appliance already sitting in Damage Location, not a step of an active repair.
//
// 2026-09-14: was four hardcoded role arrays ("copied verbatim from
// dismantling.controller.ts's own const declarations") gating different actions on one
// record's lifecycle - that comment is now stale, the backend migrated to
// @RequiresCapability('DISMANTLING_HARVEST'/'DISMANTLING_VERIFY'/'DISMANTLING_MANAGE'/
// 'DISMANTLING_VIEW') and this frontend didn't follow. dismantlingPermissions() stays the
// single source of truth for every Dismantling check in the frontend - it just now takes
// a `has` capability checker (from useMyCapabilities()) instead of a role name.
// DISMANTLING_MANAGE's own catalog entry has an empty defaultRoles list (SUPER_ADMIN/
// SERVICE_HEAD bypass only, by design - see the backend's own comment), so canPrice
// behaves identically to before for every role that could already reach it; a
// Designation-access grant to any other role is what actually changes.
import type { RecoveryCategoryValue } from './masterDataTypes';

export const DISMANTLING_STATUSES = ['PENDING_HARVEST', 'COMPONENTS_LOGGED', 'VERIFIED', 'POSTED', 'CANCELLED'] as const;
export type DismantlingStatusValue = (typeof DISMANTLING_STATUSES)[number];

export const HARVESTED_COMPONENT_CONDITIONS = ['GOOD_WORKING', 'DAMAGED'] as const;
export type HarvestedComponentConditionValue = (typeof HARVESTED_COMPONENT_CONDITIONS)[number];

export interface DismantlingPermissions {
  canView: boolean;
  canHarvest: boolean;
  canVerify: boolean;
  canPrice: boolean;
}

// Single source of truth for every Dismantling capability check in the frontend.
export function dismantlingPermissions(has: (key: string) => boolean): DismantlingPermissions {
  return {
    canView: has('DISMANTLING_VIEW'),
    canHarvest: has('DISMANTLING_HARVEST'),
    canVerify: has('DISMANTLING_VERIFY'),
    canPrice: has('DISMANTLING_MANAGE'),
  };
}

// AC-31's three-distinct-actor rule only ever throws a 400 after submit today - these
// helpers let the UI pre-emptively disable the Verify/Price & Post triggers with a
// specific explanation instead (the-fool pre-mortem finding #4). This is a UX hint on
// top of real backend enforcement, not a substitute for it - the backend's own message
// is still what's shown if a click somehow gets through anyway (e.g. a stale client
// cache of the current user's id).
export function canVerifyAsUser(record: Pick<DismantlingRecord, 'harvestedByUserId'>, userId: string | undefined): boolean {
  return !!userId && userId !== record.harvestedByUserId;
}

export function canPriceAsUser(record: Pick<DismantlingRecord, 'harvestedByUserId' | 'verifiedByUserId'>, userId: string | undefined): boolean {
  return !!userId && userId !== record.harvestedByUserId && userId !== record.verifiedByUserId;
}

// Each entry is a jsonb snapshot, not a row in a child table - see the entity's own doc
// comment. Nullable itemName/category/convertedSparePartCode mean "no matching
// ComponentYieldMatrix row for this model+code at harvest time" - still logged for
// visibility, but never eligible for conversion (the-fool finding #1: the UI must flag
// this distinctly from a genuine CONSUMABLE/SCRAP classification, since it's often a typo).
export interface HarvestedComponent {
  originalBomItemCode: string;
  itemName: string | null;
  category: RecoveryCategoryValue | null;
  convertedSparePartCode: string | null;
  testedCondition: HarvestedComponentConditionValue;
  quantity: number;
  eligibleForConversion: boolean;
  selectedForConversion: boolean;
  recoveryUnitPrice: number | null;
  quantityConverted: number | null;
  convertedSparePartId: string | null;
}

export interface DismantlingRecord {
  id: string;
  recordNumber: string;
  applianceSerialNumber: string;
  modelId: string;
  damageLocationNotes: string | null;
  status: DismantlingStatusValue;
  harvestedComponents: HarvestedComponent[];
  createdById: string;
  harvestedByUserId: string | null;
  harvestedAt: string | null;
  verifiedByUserId: string | null;
  verifiedAt: string | null;
  verificationNotes: string | null;
  pricedByUserId: string | null;
  postedAt: string | null;
  totalRecoveredValue: number;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

// Matches CreateDismantlingRecordDto exactly.
export interface CreateDismantlingRecordInput {
  applianceSerialNumber: string;
  modelId: string;
  damageLocationNotes?: string;
}

// Matches HarvestComponentItemDto / HarvestComponentsDto exactly.
export interface HarvestComponentItemInput {
  originalBomItemCode: string;
  testedCondition: HarvestedComponentConditionValue;
  quantity: number;
}
export interface HarvestComponentsInput {
  components: HarvestComponentItemInput[];
}

// Matches PriceConversionItemDto / PriceAndPostDismantlingDto exactly.
export interface PriceConversionItemInput {
  originalBomItemCode: string;
  recoveryUnitPrice: number;
  quantityToConvert?: number;
}
export interface PriceAndPostDismantlingInput {
  conversions: PriceConversionItemInput[];
}
