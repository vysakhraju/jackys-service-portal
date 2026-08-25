import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { WorkshopService } from './workshop.service';
import { JobCardStatus, JobCardSection } from '../job-cards/entities/job-card.entity';
import { ReservationStatus } from '../inventory/entities/inventory-reservation.entity';

describe('WorkshopService', () => {
  let service: WorkshopService;
  let jobCardsService: any;
  let inventoryService: any;

  const jobCard = (overrides: any = {}) =>
    ({
      id: 'jc-1',
      jobCardNumber: 'JC-0001',
      status: JobCardStatus.IN_PROGRESS,
      section: JobCardSection.WORKSHOP,
      assignedWorkshopTechnicianId: 'tech-1',
      ...overrides,
    } as any);

  beforeEach(() => {
    jobCardsService = {
      findById: jest.fn(),
      assignWorkshopTechnician: jest.fn(),
      startWip: jest.fn(),
      setSparePending: jest.fn(),
      resumeFromSparePending: jest.fn(),
      completeWorkshop: jest.fn(),
    };
    inventoryService = {
      hasUnresolvedStaleReservation: jest.fn().mockResolvedValue(null),
      reserve: jest.fn(),
      getStaleReservations: jest.fn().mockResolvedValue([]),
    };
    service = new WorkshopService(jobCardsService, inventoryService);
  });

  describe('assign', () => {
    it('delegates straight to JobCardsService.assignWorkshopTechnician', async () => {
      jobCardsService.assignWorkshopTechnician.mockResolvedValue(jobCard({ status: JobCardStatus.WORKSHOP_ASSIGNED }));

      const result = await service.assign('jc-1', 'tech-1');

      expect(jobCardsService.assignWorkshopTechnician).toHaveBeenCalledWith('jc-1', 'tech-1');
      expect(result.status).toBe(JobCardStatus.WORKSHOP_ASSIGNED);
    });
  });

  describe('ownership - TECHNICIAN_WORKSHOP callers can only act on their own job', () => {
    it('the assigned technician can start WIP', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.WORKSHOP_ASSIGNED, assignedWorkshopTechnicianId: 'tech-1' }));
      jobCardsService.startWip.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS }));

      const result = await service.startWip('jc-1', 'tech-1', false);

      expect(result.status).toBe(JobCardStatus.IN_PROGRESS);
    });

    it('a different (non-privileged) technician is forbidden', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ assignedWorkshopTechnicianId: 'tech-1' }));

      await expect(service.startWip('jc-1', 'some-other-tech', false)).rejects.toThrow(ForbiddenException);
    });

    it('a privileged caller (TL+) can act on any job regardless of assignment', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ assignedWorkshopTechnicianId: 'tech-1', status: JobCardStatus.WORKSHOP_ASSIGNED }));
      jobCardsService.startWip.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS }));

      const result = await service.startWip('jc-1', 'tl-1', true);

      expect(result.status).toBe(JobCardStatus.IN_PROGRESS);
    });
  });

  describe('requestSpare', () => {
    it('a fully-filled reservation resumes the job from SPARE_PENDING to IN_PROGRESS', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.SPARE_PENDING }));
      inventoryService.reserve.mockResolvedValue({ id: 'res-1', status: ReservationStatus.HELD, quantityReserved: 2 });
      jobCardsService.resumeFromSparePending.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS }));

      await service.requestSpare('jc-1', 'part-1', 2, 'tech-1', 'tech-1', false);

      expect(jobCardsService.resumeFromSparePending).toHaveBeenCalledWith('jc-1');
      expect(jobCardsService.setSparePending).not.toHaveBeenCalled();
    });

    it('a partially-filled reservation moves the job to SPARE_PENDING', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS }));
      inventoryService.reserve.mockResolvedValue({ id: 'res-1', status: ReservationStatus.PARTIALLY_RESERVED, quantityReserved: 1 });
      jobCardsService.setSparePending.mockResolvedValue(jobCard({ status: JobCardStatus.SPARE_PENDING }));

      await service.requestSpare('jc-1', 'part-1', 3, 'tech-1', 'tech-1', false);

      expect(jobCardsService.setSparePending).toHaveBeenCalledWith('jc-1');
      expect(jobCardsService.resumeFromSparePending).not.toHaveBeenCalled();
    });

    it('reserve() always uses the assigned workshop technician as custodian, regardless of who called it', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS, assignedWorkshopTechnicianId: 'tech-1' }));
      inventoryService.reserve.mockResolvedValue({ id: 'res-1', status: ReservationStatus.HELD, quantityReserved: 1 });

      await service.requestSpare('jc-1', 'part-1', 1, 'tl-caller-id', 'tl-caller-id', true);

      expect(inventoryService.reserve).toHaveBeenCalledWith('part-1', 1, 'jc-1', 'tech-1', 'tl-caller-id');
    });

    it('is blocked when this job already has an unreviewed stale reservation past 48h', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS }));
      inventoryService.hasUnresolvedStaleReservation.mockResolvedValue({ id: 'res-old' });

      await expect(service.requestSpare('jc-1', 'part-1', 1, 'tech-1', 'tech-1', false)).rejects.toThrow(BadRequestException);
      expect(inventoryService.reserve).not.toHaveBeenCalled();
    });

    it('rejects requesting a spare from a status other than IN_PROGRESS/SPARE_PENDING', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.WORKSHOP_ASSIGNED }));

      await expect(service.requestSpare('jc-1', 'part-1', 1, 'tech-1', 'tech-1', false)).rejects.toThrow(BadRequestException);
    });

    it('rejects when the job has no assigned workshop technician to hold custody', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS, assignedWorkshopTechnicianId: null }));

      await expect(service.requestSpare('jc-1', 'part-1', 1, 'tl-1', 'tl-1', true)).rejects.toThrow(BadRequestException);
    });
  });

  describe('complete', () => {
    it('delegates to JobCardsService.completeWorkshop for the assigned technician', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS, assignedWorkshopTechnicianId: 'tech-1' }));
      jobCardsService.completeWorkshop.mockResolvedValue(jobCard({ status: JobCardStatus.READY_FOR_QC }));

      const result = await service.complete('jc-1', 'tech-1', false);

      expect(result.status).toBe(JobCardStatus.READY_FOR_QC);
    });
  });

  describe('getWorkshopState', () => {
    it('filters stale reservations down to only the ones on this job card', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard());
      inventoryService.getStaleReservations.mockResolvedValue([
        { id: 'res-1', jobCardId: 'jc-1' },
        { id: 'res-2', jobCardId: 'some-other-job' },
      ]);

      const result = await service.getWorkshopState('jc-1');

      expect(result.staleReservations).toHaveLength(1);
      expect(result.staleReservations[0].id).toBe('res-1');
    });
  });
});
