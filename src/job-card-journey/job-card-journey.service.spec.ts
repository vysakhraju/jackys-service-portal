import { JobCardJourneyService } from './job-card-journey.service';
import { JobCardStatus, JobCardSection } from '../job-cards/entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { DeliveryStatus } from '../delivery/entities/delivery.entity';

describe('JobCardJourneyService', () => {
  let service: JobCardJourneyService;
  let jobCardRepository: any;
  let jobCardsService: any;
  let appointmentsService: any;
  let technicianService: any;
  let inventoryService: any;
  let estimatesService: any;
  let invoicingService: any;
  let deliveryService: any;
  let queryBuilder: any;

  const jobCard = (overrides: any = {}) =>
    ({
      id: 'jc-1',
      jobCardNumber: 'JC-0120',
      appointmentId: 'apt-1',
      status: JobCardStatus.QC_PASSED,
      section: JobCardSection.ON_SITE_REPAIR,
      warrantyStatus: WarrantyStatus.IN_WARRANTY,
      snValidatedAgainstInvoice: true,
      snValidationNotes: null,
      customerApproved: true,
      qcRejectionCount: 0,
      cancellationReason: null,
      onSiteCompletionNotes: null,
      createdAt: new Date('2026-09-01T09:30:00Z'),
      deliveryId: 'dlv-1',
      ...overrides,
    } as any);

  const appointment = (overrides: any = {}) =>
    ({
      id: 'apt-1',
      appointmentNumber: 'APT-0001',
      customerName: 'Jane Doe',
      customerPhone: '9999999999',
      createdAt: new Date('2026-09-01T08:00:00Z'),
      scheduledAt: new Date('2026-09-01T09:00:00Z'),
      ...overrides,
    } as any);

  beforeEach(() => {
    queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    jobCardRepository = { createQueryBuilder: jest.fn(() => queryBuilder) };
    jobCardsService = {
      findById: jest.fn().mockResolvedValue(jobCard()),
      getTaskPauses: jest.fn().mockResolvedValue([]),
    };
    appointmentsService = { findById: jest.fn().mockResolvedValue(appointment()) };
    technicianService = { getVisit: jest.fn().mockResolvedValue({ startedAt: new Date('2026-09-01T09:05:00Z') }) };
    inventoryService = { findLatestNeedSpareRequestForJobCard: jest.fn().mockResolvedValue(null) };
    estimatesService = { findByJobCardId: jest.fn().mockResolvedValue([]) };
    invoicingService = { findByJobCardId: jest.fn().mockResolvedValue(null) };
    deliveryService = {
      findById: jest.fn().mockResolvedValue({
        createdAt: new Date('2026-09-05T10:00:00Z'),
        status: DeliveryStatus.CANCELLED,
        dispatchedAt: null,
        deliveredAt: null,
        cancellationReason: null,
        deliveryNumber: 'DLV-0099',
      }),
    };

    service = new JobCardJourneyService(
      jobCardRepository,
      jobCardsService,
      appointmentsService,
      technicianService,
      inventoryService,
      estimatesService,
      invoicingService,
      deliveryService,
    );
  });

  describe('getJourney', () => {
    it('aggregates every cross-module dependency and returns computed steps', async () => {
      const result = await service.getJourney('jc-1');

      expect(jobCardsService.findById).toHaveBeenCalledWith('jc-1');
      expect(appointmentsService.findById).toHaveBeenCalledWith('apt-1');
      expect(technicianService.getVisit).toHaveBeenCalledWith('apt-1');
      expect(inventoryService.findLatestNeedSpareRequestForJobCard).toHaveBeenCalledWith('jc-1');
      expect(estimatesService.findByJobCardId).toHaveBeenCalledWith('jc-1');
      expect(invoicingService.findByJobCardId).toHaveBeenCalledWith('jc-1');
      expect(deliveryService.findById).toHaveBeenCalledWith('dlv-1');

      expect(result.jobCard.jobCardNumber).toBe('JC-0120');
      expect(result.steps.some((s) => s.key === 'delivery_cancelled')).toBe(true);
    });

    it('includes a locked editLock summary when the Job Card is late-stage (default fixture is QC_PASSED)', async () => {
      const result = await service.getJourney('jc-1');

      expect(result.editLock).toEqual({
        locked: true,
        allowedRoles: ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER', 'ACCOUNTANT', 'FINANCE_MANAGER'],
        reason: expect.stringContaining('QC_PASSED'),
      });
    });

    it('includes an unlocked editLock summary for an early-stage Job Card', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS }));

      const result = await service.getJourney('jc-1');

      expect(result.editLock).toEqual({ locked: false, allowedRoles: [], reason: null });
    });

    it('never throws when the technician visit lookup fails - falls back to a null visit step', async () => {
      technicianService.getVisit.mockRejectedValue(new Error('visit lookup exploded'));

      const result = await service.getJourney('jc-1');

      expect(result.visit).toBeNull();
      expect(result.steps.find((s) => s.key === 'visit_started')!.state).toBe('pending');
    });

    it('passes a null delivery through to buildJourneySteps when the job card has no deliveryId yet, without ever calling deliveryService.findById', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ deliveryId: null }));

      const result = await service.getJourney('jc-1');

      expect(result.delivery).toBeNull();
      expect(deliveryService.findById).not.toHaveBeenCalled();
      expect(result.steps.find((s) => s.key === 'delivery_created')!.state).toBe('pending');
    });

    it('looks up the delivery directly by jobCard.deliveryId rather than re-fetching the Job Card a second time (efficiency regression from QA review)', async () => {
      await service.getJourney('jc-1');

      expect(jobCardsService.findById).toHaveBeenCalledTimes(1);
      expect(deliveryService.findById).toHaveBeenCalledWith('dlv-1');
    });
  });

  describe('search', () => {
    it('returns an empty array without querying when the search term is blank', async () => {
      const result = await service.search('   ');

      expect(result).toEqual([]);
      expect(jobCardRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('matches across job card number, appointment fields, and delivery number via ILIKE', async () => {
      queryBuilder.getMany.mockResolvedValue([
        {
          id: 'jc-1',
          jobCardNumber: 'JC-0120',
          status: JobCardStatus.QC_PASSED,
          appointment: { appointmentNumber: 'APT-0001', customerName: 'Jane Doe', customerPhone: '9999999999' },
          delivery: { deliveryNumber: 'DLV-0099' },
        },
      ]);

      const result = await service.search('0120');

      expect(queryBuilder.where).toHaveBeenCalledWith("jc.jobCardNumber ILIKE :like ESCAPE '\\'", { like: '%0120%' });
      expect(queryBuilder.limit).toHaveBeenCalledWith(20);
      expect(result).toEqual([
        {
          jobCardId: 'jc-1',
          jobCardNumber: 'JC-0120',
          jobCardStatus: JobCardStatus.QC_PASSED,
          appointmentNumber: 'APT-0001',
          customerName: 'Jane Doe',
          customerPhone: '9999999999',
          deliveryNumber: 'DLV-0099',
        },
      ]);
    });

    it('reports deliveryNumber as null for a job card with no linked delivery', async () => {
      queryBuilder.getMany.mockResolvedValue([
        {
          id: 'jc-2',
          jobCardNumber: 'JC-0121',
          status: JobCardStatus.OPEN,
          appointment: { appointmentNumber: 'APT-0002', customerName: 'John Roe', customerPhone: '8888888888' },
          delivery: null,
        },
      ]);

      const result = await service.search('roe');

      expect(result[0].deliveryNumber).toBeNull();
    });

    it('escapes literal %, _, and \\ in the search term so they match literally instead of acting as ILIKE wildcards (QA review finding)', async () => {
      await service.search('50%_off\\deal');

      expect(queryBuilder.where).toHaveBeenCalledWith(expect.any(String), { like: '%50\\%\\_off\\\\deal%' });
    });
  });
});
