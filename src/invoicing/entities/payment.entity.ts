import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Invoice, PaymentMethod } from './invoice.entity';
import { User } from '../../auth/entities/user.entity';

/**
 * Phase 8: one row per payment recorded against an Invoice. Introduced to support
 * partial payments (Phase 7's Invoice only ever allowed one all-or-nothing payment that
 * had to equal the full amount). An invoice's real "how much has been paid" is
 * SUM(Payment.amount) for that invoice - see InvoicingService.getBalance(). Never
 * updated or deleted once created (a correction is a new, possibly negative-adjusting
 * business process outside this phase's scope) - append-only, exactly like AuditLog.
 */
@Entity('payments')
@Index(['invoiceId'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Invoice)
  @JoinColumn({ name: 'invoiceId' })
  invoice: Invoice;

  @Column({ type: 'uuid' })
  invoiceId: string;

  @Column({ type: 'enum', enum: PaymentMethod })
  method: PaymentMethod;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reference: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'recordedByUserId' })
  recordedByUser: User;

  @Column({ type: 'uuid' })
  recordedByUserId: string;

  @CreateDateColumn()
  recordedAt: Date;
}
