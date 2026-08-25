import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { WorkshopService } from './workshop.service';
import { JobCardStatus, JobCardSection } from '../job-cards/entities/job-card.entity';
import { ReservationStatus } from '../inventory/entities/inventory-reservation.entity';

describe('WorkshopService', () => {
  let service: WorkshopService;
  let jobCardsService: any;
  let inventoryService: any;
  let permissionsService: any;

  const jobCard = (overrides: any = {}) =>
    ({
      id: 'jc-1',
      jobCardNumber: 'JC-0001',
      status: JobCardStatus.IN_PROGRESS,
      section: JobCardSection.WORKSHOP,
      assignedWorkshopTechnicianId: 'tech-1',
      qcRejectionCount: 0,
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
      hasPriorReservationForPart: jest.fn().mockResolvedValue(false),
    };
    permissionsService = {
      requireActiveGrant: jest.fn().mockResolvedValue(undefined),
    };
    service = new WorkshopService(jobCardsService, inventoryService, permissionsService);
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

      expect(inventoryService.reserve).toHaveBeenCalledWith('part-1', 1, 'jc-1', 'tech-1', 'tl-caller-id', undefined, undefined, undefined, undefined);
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

  describe('requestSpare - Phase 6 READY_FOR_QC top-up (resolving a negative-inventory-gate block)', () => {
    it('allows a top-up request from READY_FOR_QC (not just IN_PROGRESS/SPARE_PENDING)', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.READY_FOR_QC }));
      inventoryService.reserve.mockResolvedValue({ id: 'res-2', status: ReservationStatus.HELD, quantityReserved: 3 });

      await expect(service.requestSpare('jc-1', 'part-1', 3, 'tech-1', 'tech-1', false)).resolves.toBeDefined();
      expect(inventoryService.reserve).toHaveBeenCalled();
    });

    it('leaves a READY_FOR_QC job at READY_FOR_QC when the top-up fully covers the shortfall (does not call resumeFromSparePending)', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.READY_FOR_QC }));
      inventoryService.reserve.mockResolvedValue({ id: 'res-2', status: ReservationStatus.HELD, quantityReserved: 3 });

      await service.requestSpare('jc-1', 'part-1', 3, 'tech-1', 'tech-1', false);

      expect(jobCardsService.resumeFromSparePending).not.toHaveBeenCalled();
      expect(jobCardsService.setSparePending).not.toHaveBeenCalled();
    });

    it('leaves a READY_FOR_QC job at READY_FOR_QC even when the top-up is still only partial (does not call setSparePending)', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.READY_FOR_QC }));
      inventoryService.reserve.mockResolvedValue({ id: 'res-2', status: ReservationStatus.PARTIALLY_RESERVED, quantityReserved: 1 });

      await service.requestSpare('jc-1', 'part-1', 3, 'tech-1', 'tech-1', false);

      expect(jobCardsService.setSparePending).not.toHaveBeenCalled();
      expect(jobCardsService.resumeFromSparePending).not.toHaveBeenCalled();
    });

    it('a READY_FOR_QC top-up is NOT gated by rework approval when the job was never actually QC-rejected (qcRejectionCount stays 0 on a blocked-but-not-rejected approve attempt)', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.READY_FOR_QC, qcRejectionCount: 0 }));
      inventoryService.hasPriorReservationForPart.mockResolvedValue(true);
      inventoryService.reserve.mockResolvedValue({ id: 'res-2', status: ReservationStatus.HELD, quantityReserved: 3 });

      await service.requestSpare('jc-1', 'part-1', 3, 'tech-1', 'tech-1', false);

      expect(permissionsService.requireActiveGrant).not.toHaveBeenCalled();
    });
  });

  describe('requestSpare - Phase 6 rework gate', () => {
    it('does NOT trigger the gate on an ordinary top-up before any QC rejection, even if the part was requested before', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.SPARE_PENDING, qcRejectionCount: 0 }));
      inventoryService.hasPriorReservationForPart.mockResolvedValue(true); // same part requested before...
      inventoryService.reserve.mockResolvedValue({ id: 'res-1', status: ReservationStatus.HELD, quantityReserved: 1 });

      await service.requestSpare('jc-1', 'part-1', 1, 'tech-1', 'tech-1', false);

      // ...but qcRejectionCount is 0, so no approval/verbal-override was required.
      expect(inventoryService.reserve).toHaveBeenCalled();
      expect(permissionsService.requireActiveGrant).not.toHaveBeenCalled();
    });

    it('does NOT trigger the gate for a first-time request even after a QC rejection', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS, qcRejectionCount: 1 }));
      inventoryService.hasPriorReservationForPart.mockResolvedValue(false); // never requested before
      inventoryService.reserve.mockResolvedValue({ id: 'res-1', status: ReservationStatus.HELD, quantityReserved: 1 });

      await service.requestSpare('jc-1', 'part-2', 1, 'tech-1', 'tech-1', false);

      expect(inventoryService.reserve).toHaveBeenCalled();
      expect(permissionsService.requireActiveGrant).not.toHaveBeenCalled();
    });

    it('triggers the gate when the same part is re-requested on a job with a prior QC rejection, and passes with a valid approver', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS, qcRejectionCount: 1 }));
      inventoryService.hasPriorReservationForPart.mockResolvedValue(true);
      inventoryService.reserve.mockResolvedValue({ id: 'res-1', status: ReservationStatus.HELD, quantityReserved: 1 });

      await service.requestSpare('jc-1', 'part-1', 1, 'tech-1', 'tech-1', false, 'tl-approver-1');

      expect(permissionsService.requireActiveGrant).toHaveBeenCalledWith('tl-approver-1', 'REWORK_APPROVAL');
      expect(inventoryService.reserve).toHaveBeenCalledWith('part-1', 1, 'jc-1', 'tech-1', 'tech-1', undefined, 'tl-approver-1', undefined, undefined);
    });

    it('hard-enforces approverId !== requester - the requester cannot approve their own rework re-request', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS, qcRejectionCount: 1 }));
      inventoryService.hasPriorReservationForPart.mockResolvedValue(true);

      await expect(
        service.requestSpare('jc-1', 'part-1', 1, 'tech-1', 'tech-1', false, 'tech-1'),
      ).rejects.toThrow(BadRequestException);
      expect(inventoryService.reserve).not.toHaveBeenCalled();
    });

    it('rejects when the named approver does not hold an active REWORK_APPROVAL grant', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS, qcRejectionCount: 1 }));
      inventoryService.hasPriorReservationForPart.mockResolvedValue(true);
      permissionsService.requireActiveGrant.mockRejectedValue(new ForbiddenException('no grant'));

      await expect(
        service.requestSpare('jc-1', 'part-1', 1, 'tech-1', 'tech-1', false, 'not-a-real-approver'),
      ).rejects.toThrow(ForbiddenException);
      expect(inventoryService.reserve).not.toHaveBeenCalled();
    });

    it('accepts a verbal override fallback (with notes) when no approver is reachable', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS, qcRejectionCount: 1 }));
      inventoryService.hasPriorReservationForPart.mockResolvedValue(true);
      inventoryService.reserve.mockResolvedValue({ id: 'res-1', status: ReservationStatus.HELD, quantityReserved: 1 });

      await service.requestSpare(
        'jc-1', 'part-1', 1, 'tech-1', 'tech-1', false,
        undefined, 'Supervisor Raj (phone)', 'No TL reachable on-site, urgent customer pickup',
      );

      expect(permissionsService.requireActiveGrant).not.toHaveBeenCalled();
      expect(inventoryService.reserve).toHaveBeenCalledWith(
        'part-1', 1, 'jc-1', 'tech-1', 'tech-1', undefined, undefined, 'Supervisor Raj (phone)', 'No TL reachable on-site, urgent customer pickup',
      );
    });

    it('rejects a verbal override with no/too-short notes', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS, qcRejectionCount: 1 }));
      inventoryService.hasPriorReservationForPart.mockResolvedValue(true);

      await expect(
        service.requestSpare('jc-1', 'part-1', 1, 'tech-1', 'tech-1', false, undefined, 'Supervisor Raj', 'ok'),
      ).rejects.toThrow(BadRequestException);
      expect(inventoryService.reserve).not.toHaveBeenCalled();
    });

    it('rejects a same-part rework re-request with neither an approver nor a verbal override', async () => {
      jobCardsService.findById.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS, qcRejectionCount: 1 }));
      inventoryService.hasPriorReservationForPart.mockResolvedValue(true);

      await expect(
        service.requestSpare('jc-1', 'part-1', 1, 'tech-1', 'tech-1', false),
      ).rejects.toThrow(BadRequestException);
      expect(inventoryService.reserve).not.toHaveBeenCalled();
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
