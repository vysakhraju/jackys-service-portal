import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { AmcContract } from './amc-contract.entity';
import { Appointment } from '../../appointments/entities/appointment.entity';
import { User } from '../../auth/entities/user.entity';

/**
 * One row per completed PM visit (each visit is an `Appointment`, type=AMC, generated in
 * bulk by AmcService.createContract()). This is the workshop/field record of what
 * actually happened on that visit - checklist notes, optional customer signature, and any
 * extra-spares charge raised on the spot.
 *
 * Guardrail (deliberate, per the pre-mortem for this phase): an extraChargeAmount can
 * only be recorded alongside extraChargeApprovedByCustomer=true - AmcService.completeVisit
 * rejects (400) any attempt to log a charge without the customer's explicit approval
 * captured at the same time. An AMC is a pre-paid contract; nothing extra gets billed
 * silently.
 */
@Entity('amc_visit_completions')
@Index(['appointmentId'], { unique: true })
export class AmcVisitCompletion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => AmcContract)
  @JoinColumn({ name: 'amcContractId' })
  amcContract: AmcContract;

  @Column({ type: 'uuid' })
  amcContractId: string;

  @ManyToOne(() => Appointment)
  @JoinColumn({ name: 'appointmentId' })
  appointment: Appointment;

  @Column({ type: 'uuid' })
  appointmentId: string;

  // 1-based position of this visit within the contract's generated schedule - useful for
  // display ("Visit 3 of 12") without re-deriving it from scheduledAt order every time.
  @Column({ type: 'int' })
  visitNumber: number;

  @Column({ type: 'text', nullable: true })
  checklistNotes: string | null;

  @Column({ type: 'text', nullable: true })
  customerSignatureBase64: string | null;

  @Column({ type: 'text', nullable: true })
  extraChargeDescription: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  extraChargeAmount: number | null;

  @Column({ type: 'boolean', default: false })
  extraChargeApprovedByCustomer: boolean;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'completedByUserId' })
  completedByUser: User;

  @Column({ type: 'uuid' })
  completedByUserId: string;

  @CreateDateColumn()
  completedAt: Date;
}
