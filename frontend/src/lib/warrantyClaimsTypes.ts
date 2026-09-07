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
// Three role arrays gate different actions, same fragmentation risk the-fool flagged for
// AMC/Dismantling - collapsed into one warrantyClaimsPermissions() source of truth below,
// copied verbatim from warranty-claims.controller.ts's own const declarations.
export const WARRANTY_CLAIM_STATUSES = ['DRAFT', 'SUBMITTED', 'CREDIT_RECEIVED', 'CANCELLED'] as const;
export type WarrantyClaimStatusValue = (typeof WARRANTY_CLAIM_STATUSES)[number];

export const WARRANTY_CLAIM_CLERK_ROLES = ['WARRANTY_CLERK', 'SERVICE_HEAD', 'SUPER_ADMIN'];
export const WARRANTY_CLAIM_CREDIT_NOTE_ROLES = ['ACCOUNTANT', 'FINANCE_MANAGER', 'SUPER_ADMIN'];
export const WARRANTY_CLAIM_VIEW_ROLES = ['WARRANTY_CLERK', 'ACCOUNTANT', 'FINANCE_MANAGER', 'SERVICE_HEAD', 'SUPER_ADMIN'];

export interface WarrantyClaimsPermissions {
  canView: boolean;
  canAggregate: boolean;
  canSubmit: boolean;
  canCancel: boolean;
  canRecordCreditNote: boolean;
}

// Single source of truth for every Warranty Claims role check in the frontend. Aggregate/
// submit/cancel share one role list (CLERK_ROLES) in the backend, so they're collapsed to
// one flag pair here too rather than three identical checks that could drift apart.
export function warrantyClaimsPermissions(roleName: string | undefined): WarrantyClaimsPermissions {
  const isClerk = !!roleName && WARRANTY_CLAIM_CLERK_ROLES.includes(roleName);
  return {
    canView: !!roleName && WARRANTY_CLAIM_VIEW_ROLES.includes(roleName),
    canAggregate: isClerk,
    canSubmit: isClerk,
    canCancel: isClerk,
    canRecordCreditNote: !!roleName && WARRANTY_CLAIM_CREDIT_NOTE_ROLES.includes(roleName),
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
