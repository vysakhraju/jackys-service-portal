import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum NotificationChannel {
  WHATSAPP = 'WHATSAPP',
  EMAIL = 'EMAIL',
  SMS = 'SMS',
}

export enum NotificationTrigger {
  APPOINTMENT_CONFIRMED = 'APPOINTMENT_CONFIRMED',
  TECHNICIAN_DISPATCHED = 'TECHNICIAN_DISPATCHED',
  TECHNICIAN_ARRIVED = 'TECHNICIAN_ARRIVED',
  ESTIMATE_SENT = 'ESTIMATE_SENT',
  ESTIMATE_APPROVED = 'ESTIMATE_APPROVED',
  ESTIMATE_REJECTED = 'ESTIMATE_REJECTED',
  JOB_COMPLETED = 'JOB_COMPLETED',
  INVOICE_READY = 'INVOICE_READY',
  PAYMENT_RECEIVED = 'PAYMENT_RECEIVED',
  DELIVERY_SCHEDULED = 'DELIVERY_SCHEDULED',
  DELIVERED = 'DELIVERED',
  AMC_RENEWAL_REMINDER = 'AMC_RENEWAL_REMINDER',
  WARRANTY_EXPIRY = 'WARRANTY_EXPIRY',
}

@Entity('notification_templates')
@Index(['trigger', 'channel'], { unique: true })
export class NotificationTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: NotificationTrigger })
  trigger: NotificationTrigger;

  @Column({ type: 'enum', enum: NotificationChannel })
  channel: NotificationChannel;

  @Column({ length: 255 })
  subject: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'jsonb', default: [] })
  placeholders: string[];

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}