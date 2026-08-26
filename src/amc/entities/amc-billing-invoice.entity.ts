import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AmcContract } from './amc-contract.entity';
import { User } from '../../auth/entities/user.entity';
import { PaymentMethod } from '../../invoicing/entities/invoice.entity';

export enum AmcBillingStatus {
  DRAFT = 'DRAFT',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}

/**
 * A billing invoice for one installment of an AMC contract's totalAmount - the split is
 * determined by the contract's paymentTerms (FULL_UPFRONT=1 invoice, HALF_YEARLY=2,
 * QUARTERLY=4), computed in AmcService.generateBillingInvoice(). Deliberately reuses
 * `PaymentMethod` from the Invoicing module (Cash/Card/Bank Transfer/B2B Credit) rather
 * than inventing a parallel enum - same FR-14 payment-method universe applies here.
 *
 * Post-paid-style full-amount-only settlement, on purpose: unlike Invoice's Phase 8
 * partial-payment support, an AMC installment is a fixed pre-agreed figure - there's no
 * "remaining balance" concept to reinvent for a contract line item, so
 * AmcService.recordBillingPayment() requires the full installment amount in one call.
 */
@Entity('amc_billing_invoices')
export class AmcBillingInvoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  invoiceNumber: string;

  @ManyToOne(() => AmcContract)
  @JoinColumn({ name: 'amcContractId' })
  amcContract: AmcContract;

  @Column({ type: 'uuid' })
  amcContractId: string;

  // Human-readable billing period, e.g. "Full Term", "Q1 2026", "H2 2026" - caller-
  // supplied at generation time, not derived, since AMC contract start dates rarely
  // align to calendar quarters.
  @Column()
  periodLabel: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'enum', enum: AmcBillingStatus, default: AmcBillingStatus.DRAFT })
  status: AmcBillingStatus;

  @Column({ type: 'enum', enum: PaymentMethod, nullable: true })
  paymentMethod: PaymentMethod | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  paymentReference: string | null;

  @Column({ type: 'timestamp', nullable: true })
  paidAt: Date | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'recordedByUserId' })
  recordedByUser: User;

  @Column({ type: 'uuid', nullable: true })
  recordedByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
