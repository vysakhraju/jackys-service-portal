import { BadRequestException, ConflictException, GoneException, NotFoundException } from '@nestjs/common';
import { EstimatesService } from './estimates.service';
import { EstimateStatus, RespondedVia, ContactMethod } from './entities/estimate.entity';
import { JobCardStatus } from '../job-cards/entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { NotificationChannel } from '../master-data/entities/notification-template.entity';

describe('EstimatesService', () => {
  let service: EstimatesService;
  let estimateRepository: any;
  let jobCardsService: any;
  let notificationsService: any;

  const appointment = (overrides: any = {}) => ({
    id: 'apt-1',
    customerName: 'Ahmed Khan',
    customerPhone: '+971501112222',
    customerEmail: 'ahmed@example.com',
    serviceCentre: { vatRate: 5 },
    ...overrides,
  });

  const jobCard = (overrides: any = {}) => ({
    id: 'jc-1',
    jobCardNumber: 'JC-0001',
    brand: 'Samsung',
    status: JobCardStatus.SN_VALIDATED,
    warrantyStatus: WarrantyStatus.OUT_OF_WARRANTY,
    appointment: appointment(),
    ...overrides,
  });

  const lineItems = [
    { description: 'Drum Motor Assembly (Part)', quantity: 1, unitPrice: 350 },
    { description: 'Labor - Workshop repair', quantity: 1, unitPrice: 120 },
  ];

  const estimate = (overrides: any = {}) => ({
    id: 'est-1',
    jobCardId: 'jc-1',
    lineItems,
    subtotal: 470,
    vatAmount: 23.5,
    totalAmount: 493.5,
    status: EstimateStatus.DRAFT,
    accessToken: null,
    tokenExpiresAt: null,
    sentAt: null,
    respondedAt: null,
    respondedVia: null,
    recordedByUserId: null,
    contactMethod: null,
    contactValue: null,
    responseNotes: null,
    channelsAttempted: [],
    channelsDelivered: [],
    previousEstimateId: null,
    createdById: 'user-1',
    ...overrides,
  });

  beforeEach(() => {
    estimateRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((data: any) => data),
      save: jest.fn((data: any) => Promise.resolve({ ...data, id: data.id || 'est-1' })),
    };
    jobCardsService = {
      findById: jest.fn(),
      approveCustomer: jest.fn(),
      setToRwr: jest.fn(),
      reviveFromRwr: jest.fn(),
    };
    notificationsService = {
      sendAll: jest.fn().mockResolvedValue({ attempted: [], delivered: [], results: [] }),
    };

    service = new EstimatesService(estimateRepository, jobCardsService, notificationsService);
  });

  describe('create', () => {
    const dto = { jobCardId: 'jc-1', lineItems };

    it('creates a DRAFT, computing totals from line items and the service centre VAT rate', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard());
      estimateRepository.findOne.mockResolvedValue(null);

      const result = await service.create(dto, 'user-1');

      // Assert the actual computed numbers, not just that save() was called.
      expect(result.subtotal).toBe(470);
      expect(result.vatAmount).toBe(23.5);
      expect(result.totalAmount).toBe(493.5);
      expect(result.status).toBe(EstimateStatus.DRAFT);
    });

    it('blocks creation when the Job Card is not OOW', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ warrantyStatus: WarrantyStatus.IN_WARRANTY }));

      await expect(service.create(dto, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('blocks creation when the Job Card is not yet SN_VALIDATED', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.OPEN }));

      await expect(service.create(dto, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('blocks creation with 409 when an active (DRAFT) estimate already exists', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard());
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.DRAFT }));

      await expect(service.create(dto, 'user-1')).rejects.toThrow(ConflictException);
    });

    it('blocks creation with 409 when an active (SENT) estimate already exists', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard());
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.SENT }));

      await expect(service.create(dto, 'user-1')).rejects.toThrow(ConflictException);
    });

    it('allows creation when the only prior estimate for this Job Card is REJECTED', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard());
      // The repository query itself filters to DRAFT/SENT/APPROVED - a REJECTED-only
      // history means that query legitimately returns null.
      estimateRepository.findOne.mockResolvedValue(null);

      const result = await service.create(dto, 'user-1');

      expect(result.status).toBe(EstimateStatus.DRAFT);
    });

    it('falls back to a 5% VAT rate when the service centre has none on file', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ appointment: appointment({ serviceCentre: null }) }));
      estimateRepository.findOne.mockResolvedValue(null);

      const result = await service.create(dto, 'user-1');

      expect(result.vatAmount).toBe(23.5);
    });
  });

  describe('send', () => {
    it('generates a token, sets a 7-day expiry, and moves DRAFT to SENT', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate());
      jobCardsService.findById.mockResolvedValue(jobCard());

      const result = await service.send('est-1');

      expect(result.status).toBe(EstimateStatus.SENT);
      expect(result.accessToken).toBeTruthy();
      expect(result.accessToken!.length).toBeGreaterThan(20);
      expect(result.sentAt).toBeInstanceOf(Date);
      const daysUntilExpiry = Math.round((result.tokenExpiresAt!.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      expect(daysUntilExpiry).toBe(7);
    });

    it('rejects sending an estimate that is not DRAFT (SENT)', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.SENT }));

      await expect(service.send('est-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects sending an already-APPROVED estimate', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.APPROVED }));

      await expect(service.send('est-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects sending an already-REJECTED estimate', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.REJECTED }));

      await expect(service.send('est-1')).rejects.toThrow(BadRequestException);
    });

    it('records channelsAttempted honestly even when nothing was actually delivered', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate());
      jobCardsService.findById.mockResolvedValue(jobCard());
      notificationsService.sendAll.mockResolvedValue({
        attempted: [NotificationChannel.EMAIL, NotificationChannel.WHATSAPP],
        delivered: [],
        results: [],
      });

      const result = await service.send('est-1');

      expect(result.channelsAttempted).toEqual([NotificationChannel.EMAIL, NotificationChannel.WHATSAPP]);
      expect(result.channelsDelivered).toEqual([]);
    });
  });

  describe('getPublicView', () => {
    it('returns a customer-safe summary for a live SENT estimate', async () => {
      estimateRepository.findOne.mockResolvedValue(
        estimate({ status: EstimateStatus.SENT, tokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60), jobCard: jobCard() }),
      );

      const result = await service.getPublicView('tok-123');

      expect(result.jobCardNumber).toBe('JC-0001');
      expect(result.totalAmount).toBe(493.5);
      // Internal-only fields must never leak into the public view.
      expect((result as any).createdById).toBeUndefined();
      expect((result as any).recordedByUserId).toBeUndefined();
    });

    it('404s on an unknown token', async () => {
      estimateRepository.findOne.mockResolvedValue(null);

      await expect(service.getPublicView('missing')).rejects.toThrow(NotFoundException);
    });

    it('410s once the estimate has already been approved (link is no longer a live decision surface)', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.APPROVED, jobCard: jobCard() }));

      await expect(service.getPublicView('tok-123')).rejects.toThrow(GoneException);
    });

    it('410s once the estimate has already been rejected', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.REJECTED, jobCard: jobCard() }));

      await expect(service.getPublicView('tok-123')).rejects.toThrow(GoneException);
    });

    it('410s and marks EXPIRED when the token has passed its expiry', async () => {
      estimateRepository.findOne.mockResolvedValue(
        estimate({ status: EstimateStatus.SENT, tokenExpiresAt: new Date(Date.now() - 1000), jobCard: jobCard() }),
      );

      await expect(service.getPublicView('tok-123')).rejects.toThrow(GoneException);
      expect(estimateRepository.save).toHaveBeenCalledWith(expect.objectContaining({ status: EstimateStatus.EXPIRED }));
    });
  });

  describe('respondViaLink (customer self-service path)', () => {
    it('approves and sets JobCard.customerApproved via JobCardsService', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.SENT }));

      const result = await service.respondViaLink('tok-123', { approved: true });

      expect(result.status).toBe(EstimateStatus.APPROVED);
      expect(result.respondedVia).toBe(RespondedVia.CUSTOMER_LINK);
      expect(jobCardsService.approveCustomer).toHaveBeenCalledWith('jc-1', expect.any(Object));
      expect(jobCardsService.setToRwr).not.toHaveBeenCalled();
    });

    it('rejects and moves the Job Card to RWR via JobCardsService', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.SENT }));

      const result = await service.respondViaLink('tok-123', { approved: false, notes: 'Too expensive' });

      expect(result.status).toBe(EstimateStatus.REJECTED);
      expect(result.responseNotes).toBe('Too expensive');
      expect(jobCardsService.setToRwr).toHaveBeenCalledWith('jc-1');
      expect(jobCardsService.approveCustomer).not.toHaveBeenCalled();
    });

    it('404s on an unknown token', async () => {
      estimateRepository.findOne.mockResolvedValue(null);

      await expect(service.respondViaLink('missing', { approved: true })).rejects.toThrow(NotFoundException);
    });

    it(
      'the race guard: a second response attempt after the first already succeeded gets 409, ' +
        'and does not call JobCardsService a second time',
      async () => {
        const alreadyResponded = estimate({
          status: EstimateStatus.APPROVED,
          respondedAt: new Date('2026-01-01T10:00:00Z'),
          respondedVia: RespondedVia.CUSTOMER_LINK,
        });
        estimateRepository.findOne.mockResolvedValue(alreadyResponded);

        await expect(service.respondViaLink('tok-123', { approved: false })).rejects.toThrow(ConflictException);
        expect(jobCardsService.setToRwr).not.toHaveBeenCalled();
        expect(jobCardsService.approveCustomer).not.toHaveBeenCalled();
      },
    );

    it('410s and marks EXPIRED when the link has expired before a response is recorded', async () => {
      estimateRepository.findOne.mockResolvedValue(
        estimate({ status: EstimateStatus.SENT, tokenExpiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.respondViaLink('tok-123', { approved: true })).rejects.toThrow(GoneException);
    });

    it('rejects a response on a DRAFT that was never sent (distinct from the "already responded" conflict)', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.DRAFT, respondedAt: null }));

      await expect(service.respondViaLink('tok-123', { approved: true })).rejects.toThrow(ConflictException);
    });
  });

  describe('recordResponse (staff-assisted path - anti-consent-laundering guard)', () => {
    const dto = (overrides: any = {}) => ({
      approved: true,
      contactMethod: ContactMethod.PHONE_CALL,
      contactValue: '+971501112222',
      notes: 'Called customer, confirmed total, approved to proceed',
      ...overrides,
    });

    it('accepts a contactValue that exactly matches the phone on file', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.SENT }));
      jobCardsService.findById.mockResolvedValue(jobCard());

      const result = await service.recordResponse('est-1', dto(), 'staff-1');

      expect(result.status).toBe(EstimateStatus.APPROVED);
      expect(result.respondedVia).toBe(RespondedVia.STAFF_RECORDED);
      expect(result.recordedByUserId).toBe('staff-1');
    });

    it('accepts a contactValue that matches the email on file, case-insensitively', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.SENT }));
      jobCardsService.findById.mockResolvedValue(jobCard());

      const result = await service.recordResponse(
        'est-1',
        dto({ contactMethod: ContactMethod.EMAIL_REPLY, contactValue: 'AHMED@EXAMPLE.COM' }),
        'staff-1',
      );

      expect(result.status).toBe(EstimateStatus.APPROVED);
    });

    it('rejects a contactValue that does not match phone or email on file (the core guard)', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.SENT }));
      jobCardsService.findById.mockResolvedValue(jobCard());

      await expect(
        service.recordResponse('est-1', dto({ contactValue: '+971509999999' }), 'staff-1'),
      ).rejects.toThrow(BadRequestException);
      expect(jobCardsService.approveCustomer).not.toHaveBeenCalled();
    });

    it('fails closed when the appointment has neither a matching phone nor email on file', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.SENT }));
      jobCardsService.findById.mockResolvedValue(
        jobCard({ appointment: appointment({ customerPhone: null, customerEmail: null }) }),
      );

      await expect(service.recordResponse('est-1', dto(), 'staff-1')).rejects.toThrow(BadRequestException);
    });

    it('does not silently reformat a differently-formatted but same phone number - exact match required', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.SENT }));
      jobCardsService.findById.mockResolvedValue(jobCard({ appointment: appointment({ customerPhone: '971501112222' }) }));

      // On file: "971501112222" (no +). Provided: "+971501112222". Not normalized -
      // must be rejected, not silently treated as a match.
      await expect(
        service.recordResponse('est-1', dto({ contactValue: '+971501112222' }), 'staff-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('shares the same race guard as the public link path - second response gets 409', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.SENT }));
      jobCardsService.findById.mockResolvedValue(jobCard());

      await service.recordResponse('est-1', dto(), 'staff-1');

      // Simulate the estimate now being APPROVED for the second, near-simultaneous call.
      estimateRepository.findOne.mockResolvedValue(
        estimate({ status: EstimateStatus.APPROVED, respondedAt: new Date(), respondedVia: RespondedVia.STAFF_RECORDED }),
      );

      await expect(service.recordResponse('est-1', dto(), 'staff-2')).rejects.toThrow(ConflictException);
    });

    it('rejects (records a rejection) and moves the Job Card to RWR', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.SENT }));
      jobCardsService.findById.mockResolvedValue(jobCard());

      const result = await service.recordResponse('est-1', dto({ approved: false }), 'staff-1');

      expect(result.status).toBe(EstimateStatus.REJECTED);
      expect(jobCardsService.setToRwr).toHaveBeenCalledWith('jc-1');
    });
  });

  describe('revise', () => {
    it('creates a new linked DRAFT and revives the Job Card from RWR to SN_VALIDATED', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.REJECTED }));
      jobCardsService.findById.mockResolvedValue(jobCard());

      const result = await service.revise('est-1', {}, 'user-1');

      expect(result.status).toBe(EstimateStatus.DRAFT);
      expect(result.previousEstimateId).toBe('est-1');
      expect(jobCardsService.reviveFromRwr).toHaveBeenCalledWith('jc-1');
    });

    it('reuses the previous line items when none are supplied', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.REJECTED, lineItems }));
      jobCardsService.findById.mockResolvedValue(jobCard());

      const result = await service.revise('est-1', {}, 'user-1');

      expect(result.lineItems).toEqual(lineItems);
      expect(result.totalAmount).toBe(493.5);
    });

    it('uses new line items and recomputes totals when supplied', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.REJECTED }));
      jobCardsService.findById.mockResolvedValue(jobCard());
      const newLineItems = [{ description: 'Discounted labor', quantity: 1, unitPrice: 100 }];

      const result = await service.revise('est-1', { lineItems: newLineItems }, 'user-1');

      expect(result.lineItems).toEqual(newLineItems);
      expect(result.subtotal).toBe(100);
    });

    it('rejects revising an estimate that is not REJECTED', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.DRAFT }));

      await expect(service.revise('est-1', {}, 'user-1')).rejects.toThrow(BadRequestException);
      expect(jobCardsService.reviveFromRwr).not.toHaveBeenCalled();
    });

    it('rejects revising the newly-created DRAFT itself (precondition is status, not "most recent")', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ status: EstimateStatus.DRAFT, previousEstimateId: 'est-0' }));

      await expect(service.revise('est-1', {}, 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('findById / findByJobCardId', () => {
    it('returns the full estimate with relations for a staff GET', async () => {
      estimateRepository.findOne.mockResolvedValue(estimate({ jobCard: jobCard() }));

      const result = await service.findById('est-1');

      expect(result).toEqual(expect.objectContaining({ id: 'est-1' }));
      expect(estimateRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'est-1' } }),
      );
    });

    it('throws NotFoundException for an unknown estimate', async () => {
      estimateRepository.findOne.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when send() is called on an unknown estimate id (shared lean lookup)', async () => {
      estimateRepository.findOne.mockResolvedValue(null);

      await expect(service.send('missing')).rejects.toThrow(NotFoundException);
    });

    it('lists estimates for a Job Card newest first', async () => {
      estimateRepository.find.mockResolvedValue([estimate()]);

      const result = await service.findByJobCardId('jc-1');

      expect(estimateRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { jobCardId: 'jc-1' }, order: { createdAt: 'DESC' } }),
      );
      expect(result).toHaveLength(1);
    });
  });
});
