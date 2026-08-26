import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * A deliberate stopgap, exactly like Phase 7's Invoice was for Finance generally: the
 * discovery doc lists "GL/Accounting System" integration format as an open, unresolved
 * dependency (no chart of accounts, no external ERP contract exists yet), so this is an
 * internal-only journal log, not a real GL export/integration. It exists so an auditor
 * has SOMETHING to look at for "what got posted and when" (AC-16-adjacent), and so the
 * real integration (whenever the chart of accounts and ERP contract are defined) has a
 * ready-made list of postings to replay/export rather than reconstructing history from
 * Invoice/DebitNote rows after the fact.
 *
 * System-generated ONLY - there is deliberately no POST endpoint for creating one by
 * hand (see GlLedgerController), so every row here is traceable to a real Invoice
 * reaching PAID or a real DebitNote being POSTED. Account codes are fixed string
 * constants (see gl-ledger.service.ts) rather than a real chart-of-accounts entity,
 * since none exists - simplified two-line (debit/credit) journal entries, not a full
 * multi-line entry with separate COGS/revenue splits.
 */
export enum GlSourceType {
  INVOICE_PAYMENT = 'INVOICE_PAYMENT',
  DEBIT_NOTE = 'DEBIT_NOTE',
}

@Entity('gl_postings')
@Index(['sourceType', 'sourceId'])
export class GlPosting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: GlSourceType })
  sourceType: GlSourceType;

  @Column({ type: 'uuid' })
  sourceId: string;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ type: 'varchar', length: 50 })
  debitAccount: string;

  @Column({ type: 'varchar', length: 50 })
  creditAccount: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @CreateDateColumn()
  postedAt: Date;
}
