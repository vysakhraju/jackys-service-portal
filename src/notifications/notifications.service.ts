import { Injectable, Logger } from '@nestjs/common';
import { MasterDataService } from '../master-data/master-data.service';
import { NotificationChannel, NotificationTrigger } from '../master-data/entities/notification-template.entity';

export interface NotificationRecipient {
  phone?: string | null;
  email?: string | null;
}

export interface NotificationResult {
  channel: NotificationChannel;
  attempted: boolean;
  delivered: boolean;
  reason?: string;
}

/**
 * Renders NotificationTemplate content and hands it to a channel adapter.
 *
 * IMPORTANT (Phase 4 scope decision, flagged in STATUS_TRACKER): none of the three
 * channel adapters below actually deliver anything yet - there's no WhatsApp Business
 * API account (2-4 week external approval process, a known blocker), no SMS gateway, and
 * no transactional email provider wired up. Each adapter logs the rendered message and
 * returns delivered=false. `attempted` and `delivered` are tracked as two DISTINCT
 * booleans everywhere in this service specifically so a stubbed send can never look
 * identical to a real one in the data - swapping in a real provider later only means
 * replacing the body of the three send*() methods below, nothing about the interface
 * or callers needs to change.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private masterDataService: MasterDataService) {}

  private renderTemplate(template: string, data: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in data ? data[key] : match));
  }

  async send(
    trigger: NotificationTrigger,
    channel: NotificationChannel,
    recipient: NotificationRecipient,
    placeholderData: Record<string, string>,
  ): Promise<NotificationResult> {
    const template = await this.masterDataService.findTemplate(trigger, channel);

    if (!template || !template.isActive) {
      return { channel, attempted: false, delivered: false, reason: 'no active template configured for this trigger/channel' };
    }

    const subject = this.renderTemplate(template.subject, placeholderData);
    const body = this.renderTemplate(template.body, placeholderData);

    switch (channel) {
      case NotificationChannel.WHATSAPP:
        return this.sendWhatsApp(recipient, subject, body);
      case NotificationChannel.EMAIL:
        return this.sendEmail(recipient, subject, body);
      case NotificationChannel.SMS:
        return this.sendSms(recipient, body);
      default:
        return { channel, attempted: false, delivered: false, reason: `unknown channel ${channel}` };
    }
  }

  /**
   * Sends the same trigger across every requested channel, returning the attempted vs
   * delivered channel lists separately - callers (EstimatesService.send()) persist both,
   * never collapsing them into one "sent" flag.
   */
  async sendAll(
    trigger: NotificationTrigger,
    channels: NotificationChannel[],
    recipient: NotificationRecipient,
    placeholderData: Record<string, string>,
  ): Promise<{ attempted: NotificationChannel[]; delivered: NotificationChannel[]; results: NotificationResult[] }> {
    const results = await Promise.all(channels.map((channel) => this.send(trigger, channel, recipient, placeholderData)));
    return {
      attempted: results.filter((r) => r.attempted).map((r) => r.channel),
      delivered: results.filter((r) => r.delivered).map((r) => r.channel),
      results,
    };
  }

  // --- Channel adapters (stubs - no real provider wired up yet, see class doc comment) ---

  private sendWhatsApp(recipient: NotificationRecipient, subject: string, body: string): NotificationResult {
    if (!recipient.phone) {
      return { channel: NotificationChannel.WHATSAPP, attempted: false, delivered: false, reason: 'no phone number on file' };
    }
    this.logger.log(`[STUB] WhatsApp to ${recipient.phone}: ${subject} - ${body}`);
    return { channel: NotificationChannel.WHATSAPP, attempted: true, delivered: false, reason: 'WhatsApp Business API not yet provisioned' };
  }

  private sendEmail(recipient: NotificationRecipient, subject: string, body: string): NotificationResult {
    if (!recipient.email) {
      return { channel: NotificationChannel.EMAIL, attempted: false, delivered: false, reason: 'no email on file' };
    }
    this.logger.log(`[STUB] Email to ${recipient.email}: ${subject} - ${body}`);
    return { channel: NotificationChannel.EMAIL, attempted: true, delivered: false, reason: 'email provider not yet configured' };
  }

  private sendSms(recipient: NotificationRecipient, body: string): NotificationResult {
    if (!recipient.phone) {
      return { channel: NotificationChannel.SMS, attempted: false, delivered: false, reason: 'no phone number on file' };
    }
    this.logger.log(`[STUB] SMS to ${recipient.phone}: ${body}`);
    return { channel: NotificationChannel.SMS, attempted: true, delivered: false, reason: 'SMS gateway not yet configured' };
  }
}
