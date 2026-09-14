// Shapes mirror src/warranty-claims/entities/warranty-claim{,-line}.entity.ts and
// src/warranty-claims/dto/*.ts exactly (Frontend Phase 15, BRD Workflow 12 "[Optional]").
// Backend was already built and live-verified (70/70 checks, scripts/warranty-claims-e2e-
// test.ps1) - this phase is the first UI for it. Lifecycle: DRAFT (just aggregated,
// editable/cancellable) -> SUBMITTED (uploaded to the vendor's own portal - no real portal
// integration exists, so this is a manual "I did this externally" action) -> CREDIT_RECEIVED
// (an Accountant recorded the vendor's credit note, GL posted) - or CANCELLED from DRAFT
// only. See the entity's own doc comment for why no transition exists back out of
// SUBMITTED/CREDIT_RECEIVED.
//
// 2026-09-14: was three hardcoded role arrays (WARRANTY_CLAIM_CLERK_ROLES/
// WARRANTY_CLAIM_CREDIT_NOTE_ROLES/WARRANTY_CLAIM_VIEW_ROLES, "copied verbatim from
// warranty-claims.controller.ts's own const declarations") - that comment is now stale,
// the backend migrated to @RequiresCapability('WARRANTY_CLAIMS_CLERK'/'CREDIT_NOTE_POST'/
// 'WARRANTY_CLAIMS_VIEW') and this frontend didn't follow, so a Designation-access grant
// to some other role had no visible effect here. warrantyClaimsPermissions() stays the
// single source of truth for every Warranty Claims check in the frontend - it just now
// takes a `has` capability checker (from useMyCapabilities()) instead of a role name.
export const WARRANTY_CLAIM_STATUSES = ['DRAFT', 'SUBMITTED', 'CREDIT_RECEIVED', 'CANCELLED'] as const;
export type WarrantyClaimStatusValue = (typeof WARRANTY_CLAIM_STATUSES)[number];

export interface WarrantyClaimsPermissions {
  canView: boolean;
  canAggregate: boolean;
  canSubmit: boolean;
  canCancel: boolean;
  canRecordCreditNote: boolean;
}

// Aggregate/submit/cancel share one capability (WARRANTY_CLAIMS_CLERK) in the backend, so
// they're collapsed to one flag here too rather than three identical checks that could
// drift apart.
export function warrantyClaimsPermissions(has: (key: string) => boolean): WarrantyClaimsPermissions {
  const isClerk = has('WARRANTY_CLAIMS_CLERK');
  return {
    canView: has('WARRANTY_CLAIMS_VIEW'),
    canAggregate: isClerk,
    canSubmit: isClerk,
    canCancel: isClerk,
    canRecordCreditNote: has('CREDIT_NOTE_POST'),
  };
}

export interface WarrantyClaimLine {
  id: string;
  warrantyClaimId: string;
  inventoryReservationId: string;
  jobCardId: string;
  jobCardNumber: string;
  serialNumber: string;
  sparePartCode: string;
  sparePartName: string;
  quantity: number;
  unitCost: number;
  lineAmount: number;
  consumedAt: string;
  createdAt: string;
}

export interface WarrantyClaim {
  id: string;
  claimNumber: string;
  supplier: string;
  periodStart: string;
  periodEnd: string;
  status: WarrantyClaimStatusValue;
  totalClaimedAmount: number;
  generatedByUserId: string;
  claimReferenceNumber: string | null;
  submittedByUserId: string | null;
  submittedAt: string | null;
  creditNoteNumber: string | null;
  creditNoteAmount: number | null;
  creditReceivedByUserId: string | null;
  creditReceivedAt: string | null;
  notes: string | null;
  cancellationReason: string | null;
  lines: WarrantyClaimLine[];
  createdAt: string;
  updatedAt: string;
}

export interface AggregateWarrantyClaimInput {
  supplier: string;
  periodStart: string;
  periodEnd: string;
}

export interface SubmitWarrantyClaimInput {
  claimReferenceNumber: string;
  notes?: string;
}

export interface RecordCreditNoteInput {
  creditNoteNumber: string;
  creditNoteAmount: number;
}

export interface RecoveryRate {
  supplier: string | null;
  totalClaimed: number;
  totalRecovered: number;
  rate: number | null;
}
