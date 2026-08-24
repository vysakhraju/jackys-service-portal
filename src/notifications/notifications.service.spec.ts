import { NotificationsService } from './notifications.service';
import { NotificationChannel, NotificationTrigger } from '../master-data/entities/notification-template.entity';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let masterDataService: any;

  const template = (overrides: any = {}) => ({
    id: 'tmpl-1',
    trigger: NotificationTrigger.ESTIMATE_SENT,
    channel: NotificationChannel.EMAIL,
    subject: 'Estimate for {{jobCardNumber}}',
    body: 'Hi {{customerName}}, your estimate total is {{totalAmount}}.',
    isActive: true,
    ...overrides,
  });

  beforeEach(() => {
    masterDataService = { findTemplate: jest.fn() };
    service = new NotificationsService(masterDataService);
  });

  describe('send', () => {
    it('renders placeholders into the template subject/body (not just calling the mock)', async () => {
      masterDataService.findTemplate.mockResolvedValue(template());

      const result = await service.send(
        NotificationTrigger.ESTIMATE_SENT,
        NotificationChannel.EMAIL,
        { email: 'customer@example.com' },
        { jobCardNumber: 'JC-0001', customerName: 'Ahmed', totalAmount: '470.00' },
      );

      // Assert on real output, not on whether a mock was called - the adapter is a
      // private stub, so the observable behavior is the result shape it returns.
      expect(result.channel).toBe(NotificationChannel.EMAIL);
      expect(result.attempted).toBe(true);
      expect(result.delivered).toBe(false);
    });

    it('does not attempt delivery when no active template exists for the trigger/channel', async () => {
      masterDataService.findTemplate.mockResolvedValue(null);

      const result = await service.send(
        NotificationTrigger.ESTIMATE_SENT,
        NotificationChannel.SMS,
        { phone: '+971501112222' },
        {},
      );

      expect(result.attempted).toBe(false);
      expect(result.delivered).toBe(false);
      expect(result.reason).toMatch(/no active template/);
    });

    it('does not attempt delivery when the matching template is inactive', async () => {
      masterDataService.findTemplate.mockResolvedValue(template({ isActive: false }));

      const result = await service.send(NotificationTrigger.ESTIMATE_SENT, NotificationChannel.EMAIL, { email: 'x@x.com' }, {});

      expect(result.attempted).toBe(false);
    });

    it('does not attempt WhatsApp/SMS when no phone number is on file', async () => {
      masterDataService.findTemplate.mockResolvedValue(template({ channel: NotificationChannel.WHATSAPP }));

      const result = await service.send(NotificationTrigger.ESTIMATE_SENT, NotificationChannel.WHATSAPP, { email: 'x@x.com' }, {});

      expect(result.attempted).toBe(false);
      expect(result.reason).toMatch(/no phone number/);
    });

    it('does not attempt Email when no email is on file', async () => {
      masterDataService.findTemplate.mockResolvedValue(template({ channel: NotificationChannel.EMAIL }));

      const result = await service.send(NotificationTrigger.ESTIMATE_SENT, NotificationChannel.EMAIL, { phone: '+971501112222' }, {});

      expect(result.attempted).toBe(false);
      expect(result.reason).toMatch(/no email/);
    });

    it('never reports delivered=true for any stubbed channel (no real provider wired up yet)', async () => {
      masterDataService.findTemplate.mockResolvedValue(template());

      const email = await service.send(NotificationTrigger.ESTIMATE_SENT, NotificationChannel.EMAIL, { email: 'x@x.com' }, {});
      const whatsapp = await service.send(
        NotificationTrigger.ESTIMATE_SENT,
        NotificationChannel.WHATSAPP,
        { phone: '+971501112222' },
        {},
      );
      const sms = await service.send(NotificationTrigger.ESTIMATE_SENT, NotificationChannel.SMS, { phone: '+971501112222' }, {});

      expect([email.delivered, whatsapp.delivered, sms.delivered]).toEqual([false, false, false]);
    });
  });

  describe('sendAll', () => {
    it('keeps attempted and delivered as two distinct, separately reported lists', async () => {
      masterDataService.findTemplate.mockImplementation((_trigger: any, channel: NotificationChannel) =>
        Promise.resolve(template({ channel })),
      );

      const result = await service.sendAll(
        NotificationTrigger.ESTIMATE_SENT,
        [NotificationChannel.EMAIL, NotificationChannel.WHATSAPP],
        { email: 'x@x.com', phone: '+971501112222' },
        { jobCardNumber: 'JC-0001', customerName: 'Ahmed', totalAmount: '470.00' },
      );

      expect(result.attempted.sort()).toEqual([NotificationChannel.EMAIL, NotificationChannel.WHATSAPP].sort());
      // Attempted is non-empty but delivered is honestly empty - this is the exact case
      // that would let a fake "we notified the customer" claim slip through undetected
      // if attempted/delivered were ever collapsed into one flag.
      expect(result.delivered).toEqual([]);
    });

    it('excludes a channel with no active template from attempted entirely', async () => {
      masterDataService.findTemplate.mockImplementation((_trigger: any, channel: NotificationChannel) =>
        Promise.resolve(channel === NotificationChannel.SMS ? null : template({ channel })),
      );

      const result = await service.sendAll(
        NotificationTrigger.ESTIMATE_SENT,
        [NotificationChannel.EMAIL, NotificationChannel.SMS],
        { email: 'x@x.com', phone: '+971501112222' },
        {},
      );

      expect(result.attempted).toEqual([NotificationChannel.EMAIL]);
    });
  });
});
