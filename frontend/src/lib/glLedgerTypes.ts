// Shapes mirror src/gl-ledger/entities/gl-posting.entity.ts exactly. See that file's own
// doc comment for why this is a deliberate internal-only stopgap (no chart-of-accounts
// entity, no real ERP integration) - fixed account-code strings, simplified two-line
// (debit/credit) journal entries, system-generated only (no manual-entry endpoint exists,
// so this UI is read-only, same as the B2B Aging Report).
export const GL_SOURCE_TYPES = [
  'INVOICE_PAYMENT',
  'DEBIT_NOTE',
  'DISMANTLING_RECOVERY',
  'WARRANTY_CLAIM_CREDIT',
] as const;
export type GlSourceTypeValue = (typeof GL_SOURCE_TYPES)[number];

export const GL_SOURCE_TYPE_LABELS: Record<GlSourceTypeValue, string> = {
  INVOICE_PAYMENT: 'Invoice Payment',
  DEBIT_NOTE: 'Debit Note',
  DISMANTLING_RECOVERY: 'Dismantling Recovery',
  WARRANTY_CLAIM_CREDIT: 'Warranty Claim Credit',
};

export interface GlPosting {
  id: string;
  sourceType: GlSourceTypeValue;
  sourceId: string;
  description: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  postedAt: string;
}
