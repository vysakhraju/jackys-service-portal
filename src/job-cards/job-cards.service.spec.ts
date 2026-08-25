import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { JobCardsService } from './job-cards.service';
import { JobCardStatus, JobCardSection } from './entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';

describe('JobCardsService', () => {
  let service: JobCardsService;
  let jobCardRepository: any;
  let appointmentsService: any;
  let technicianService: any;
  let queryBuilder: any;

  const appointment = (overrides: any = {}) => ({
    id: 'apt-1',
    invoiceNumber: 'INV-1001',
    ...overrides,
  });

  const visit = (overrides: any = {}) => ({
    id: 'visit-1',
    appointmentId: 'apt-1',
    serialNumber: 'SN150000',
    brand: 'Samsung',
    warrantyStatus: WarrantyStatus.IN_WARRANTY,
    faultCode: 'F001',
    symptomCode: 'S001',
    ...overrides,
  });

  const jobCard = (overrides: any = {}) => ({
    id: 'jc-1',
    jobCardNumber: 'JC-0001',
    appointmentId: 'apt-1',
    status: JobCardStatus.OPEN,
    section: null,
    serialNumber: 'SN150000',
    brand: 'Samsung',
    faultCode: 'F001',
    symptomCode: 'S001',
    originalWarrantyStatus: WarrantyStatus.IN_WARRANTY,
    warrantyStatus: WarrantyStatus.IN_WARRANTY,
    snValidatedAgainstInvoice: false,
    snValidationNotes: null,
    warrantyOverridden: false,
    warrantyOverrideReason: null,
    warrantyOverrideBy: null,
    warrantyOverrideAt: null,
    overrideCount: 0,
    customerApproved: false,
    customerApprovalNotes: null,
    createdById: 'user-1',
    ...overrides,
  });

  beforeEach(() => {
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    jobCardRepository = {
      findOne: jest.fn(),
      create: jest.fn((data: any) => data),
      save: jest.fn((data: any) => Promise.resolve({ ...data, id: data.id || 'jc-1' })),
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    appointmentsService = {
      findById: jest.fn(),
    };
    technicianService = {
      getVisit: jest.fn(),
    };

    service = new JobCardsService(jobCardRepository, appointmentsService, technicianService);
  });

  describe('create', () => {
    const dto = { appointmentId: 'apt-1' };

    it('creates a Job Card, snapshotting data from the completed visit', async () => {
      appointmentsService.findById.mockResolvedValue(appointment());
      jobCardRepository.findOne.mockResolvedValue(null);
      technicianService.getVisit.mockResolvedValue(visit());

      const result = await service.create(dto, 'user-1');

      expect(jobCardRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          jobCardNumber: 'JC-0001',
          appointmentId: 'apt-1',
          status: JobCardStatus.OPEN,
          serialNumber: 'SN150000',
          faultCode: 'F001',
          symptomCode: 'S001',
          originalWarrantyStatus: WarrantyStatus.IN_WARRANTY,
          warrantyStatus: WarrantyStatus.IN_WARRANTY,
          createdById: 'user-1',
        }),
      );
      expect(result).toEqual(expect.objectContaining({ jobCardNumber: 'JC-0001' }));
    });

    it('numbers sequentially from the last Job Card number', async () => {
      appointmentsService.findById.mockResolvedValue(appointment());
      jobCardRepository.findOne.mockResolvedValue(null);
      technicianService.getVisit.mockResolvedValue(visit());
      queryBuilder.getOne.mockResolvedValue({ jobCardNumber: 'JC-0007' });

      await service.create(dto, 'user-1');

      expect(jobCardRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ jobCardNumber: 'JC-0008' }),
      );
    });

    it('blocks creation when the appointment has no invoice number (FR-05)', async () => {
      appointmentsService.findById.mockResolvedValue(appointment({ invoiceNumber: null }));
      jobCardRepository.findOne.mockResolvedValue(null);

      await expect(service.create(dto, 'user-1')).rejects.toThrow(BadRequestException);
      expect(technicianService.getVisit).not.toHaveBeenCalled();
    });

    it('blocks creation when the field visit is incomplete', async () => {
      appointmentsService.findById.mockResolvedValue(appointment());
      jobCardRepository.findOne.mockResolvedValue(null);
      technicianService.getVisit.mockResolvedValue(visit({ faultCode: null, symptomCode: null }));

      await expect(service.create(dto, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('blocks creation when the visit has no serial number captured', async () => {
      appointmentsService.findById.mockResolvedValue(appointment());
      jobCardRepository.findOne.mockResolvedValue(null);
      technicianService.getVisit.mockResolvedValue(visit({ serialNumber: null, warrantyStatus: null }));

      await expect(service.create(dto, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects a duplicate Job Card for the same appointment (409)', async () => {
      appointmentsService.findById.mockResolvedValue(appointment());
      jobCardRepository.findOne.mockResolvedValue(jobCard());

      await expect(service.create(dto, 'user-1')).rejects.toThrow(ConflictException);
      expect(technicianService.getVisit).not.toHaveBeenCalled();
    });
  });

  describe('validateSn', () => {
    it('marks the S/N validated and advances status to SN_VALIDATED on a match', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard());

      const result = await service.validateSn('jc-1', { matches: true });

      expect(result.snValidatedAgainstInvoice).toBe(true);
      expect(result.status).toBe(JobCardStatus.SN_VALIDATED);
    });

    it('records a mismatch without advancing status, leaving the Job Card blocked', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard());

      const result = await service.validateSn('jc-1', { matches: false, notes: 'Does not match invoice' });

      expect(result.snValidatedAgainstInvoice).toBe(false);
      expect(result.snValidationNotes).toBe('Does not match invoice');
      expect(result.status).toBe(JobCardStatus.OPEN);
    });

    it('rejects re-validation once the Job Card is no longer OPEN', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.SN_VALIDATED }));

      await expect(service.validateSn('jc-1', { matches: true })).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for an unknown Job Card', async () => {
      jobCardRepository.findOne.mockResolvedValue(null);

      await expect(service.validateSn('missing', { matches: true })).rejects.toThrow(NotFoundException);
    });
  });

  describe('assignSection', () => {
    it('assigns a section once S/N is validated on an in-warranty Job Card', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.SN_VALIDATED }));

      const result = await service.assignSection('jc-1', { section: JobCardSection.ON_SITE_REPAIR });

      expect(result.section).toBe(JobCardSection.ON_SITE_REPAIR);
      expect(result.status).toBe(JobCardStatus.SECTION_ASSIGNED);
    });

    it('blocks assignment before S/N is validated', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.OPEN }));

      await expect(
        service.assignSection('jc-1', { section: JobCardSection.ON_SITE_REPAIR }),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks assignment on an OOW Job Card without customer approval (FR-06)', async () => {
      jobCardRepository.findOne.mockResolvedValue(
        jobCard({ status: JobCardStatus.SN_VALIDATED, warrantyStatus: WarrantyStatus.OUT_OF_WARRANTY, customerApproved: false }),
      );

      await expect(
        service.assignSection('jc-1', { section: JobCardSection.WORKSHOP }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows assignment on an OOW Job Card once customer-approved', async () => {
      jobCardRepository.findOne.mockResolvedValue(
        jobCard({ status: JobCardStatus.SN_VALIDATED, warrantyStatus: WarrantyStatus.OUT_OF_WARRANTY, customerApproved: true }),
      );

      const result = await service.assignSection('jc-1', { section: JobCardSection.WORKSHOP });

      expect(result.status).toBe(JobCardStatus.SECTION_ASSIGNED);
    });
  });

  describe('approveCustomer', () => {
    it('sets the manual customer-approval stopgap flag', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard());

      const result = await service.approveCustomer('jc-1', { notes: 'Approved via phone call' });

      expect(result.customerApproved).toBe(true);
      expect(result.customerApprovalNotes).toBe('Approved via phone call');
    });
  });

  describe('warrantyOverride', () => {
    it('flips the effective warranty status and records the audit fields', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ warrantyStatus: WarrantyStatus.IN_WARRANTY }));

      const { jobCard: result, previousStatus } = await service.warrantyOverride(
        'jc-1',
        { newStatus: WarrantyStatus.OUT_OF_WARRANTY, reason: 'Warranty sticker tampered' },
        'tl-1',
      );

      expect(previousStatus).toBe(WarrantyStatus.IN_WARRANTY);
      expect(result.warrantyStatus).toBe(WarrantyStatus.OUT_OF_WARRANTY);
      expect(result.warrantyOverridden).toBe(true);
      expect(result.warrantyOverrideReason).toBe('Warranty sticker tampered');
      expect(result.warrantyOverrideBy).toBe('tl-1');
      expect(result.warrantyOverrideAt).toBeInstanceOf(Date);
      expect(result.overrideCount).toBe(1);
    });

    it('increments overrideCount across repeated overrides', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ overrideCount: 2, warrantyStatus: WarrantyStatus.IN_WARRANTY }));

      const { jobCard: result } = await service.warrantyOverride(
        'jc-1',
        { newStatus: WarrantyStatus.OUT_OF_WARRANTY, reason: 'Second look at the invoice' },
        'tl-1',
      );

      expect(result.overrideCount).toBe(3);
    });

    it('resets a stale customer approval when the override flips the status to OOW', async () => {
      jobCardRepository.findOne.mockResolvedValue(
        jobCard({
          warrantyStatus: WarrantyStatus.IN_WARRANTY,
          status: JobCardStatus.SECTION_ASSIGNED,
          customerApproved: true,
          customerApprovalNotes: 'Approved while IW, no approval was actually needed',
        }),
      );

      const { jobCard: result } = await service.warrantyOverride(
        'jc-1',
        { newStatus: WarrantyStatus.OUT_OF_WARRANTY, reason: 'Found warranty had actually expired' },
        'tl-1',
      );

      expect(result.customerApproved).toBe(false);
      expect(result.customerApprovalNotes).toBeNull();
    });

    it('does not touch customerApproved when the override result stays/returns to IW', async () => {
      jobCardRepository.findOne.mockResolvedValue(
        jobCard({ warrantyStatus: WarrantyStatus.OUT_OF_WARRANTY, customerApproved: true, customerApprovalNotes: 'Approved earlier' }),
      );

      const { jobCard: result } = await service.warrantyOverride(
        'jc-1',
        { newStatus: WarrantyStatus.IN_WARRANTY, reason: 'Found valid extended warranty registration' },
        'tl-1',
      );

      expect(result.customerApproved).toBe(true);
      expect(result.customerApprovalNotes).toBe('Approved earlier');
    });

    it('rejects a no-op override to the same status', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ warrantyStatus: WarrantyStatus.IN_WARRANTY }));

      await expect(
        service.warrantyOverride('jc-1', { newStatus: WarrantyStatus.IN_WARRANTY, reason: 'no real change' }, 'tl-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks override while the Job Card is RWR (FR-08: further work blocked)', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.RWR, warrantyStatus: WarrantyStatus.OUT_OF_WARRANTY }));

      await expect(
        service.warrantyOverride('jc-1', { newStatus: WarrantyStatus.IN_WARRANTY, reason: 'irrelevant while RWR' }, 'tl-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks override while the Job Card is CANCELLED', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.CANCELLED, warrantyStatus: WarrantyStatus.IN_WARRANTY }));

      await expect(
        service.warrantyOverride('jc-1', { newStatus: WarrantyStatus.OUT_OF_WARRANTY, reason: 'irrelevant while cancelled' }, 'tl-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('setToRwr', () => {
    it('moves an SN_VALIDATED Job Card to RWR', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.SN_VALIDATED }));

      const result = await service.setToRwr('jc-1');

      expect(result.status).toBe(JobCardStatus.RWR);
    });

    it('rejects moving to RWR from any other status', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.OPEN }));

      await expect(service.setToRwr('jc-1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for an unknown Job Card', async () => {
      jobCardRepository.findOne.mockResolvedValue(null);

      await expect(service.setToRwr('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('reviveFromRwr', () => {
    it('moves an RWR Job Card back to SN_VALIDATED', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.RWR }));

      const result = await service.reviveFromRwr('jc-1');

      expect(result.status).toBe(JobCardStatus.SN_VALIDATED);
    });

    it('rejects reviving a Job Card that is not RWR', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.SECTION_ASSIGNED }));

      await expect(service.reviveFromRwr('jc-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('findById / findByAppointmentId', () => {
    it('returns the Job Card with relations for a GET by id', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard());

      const result = await service.findById('jc-1');

      expect(result).toEqual(expect.objectContaining({ id: 'jc-1' }));
      expect(jobCardRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'jc-1' } }),
      );
    });

    it('throws NotFoundException when the Job Card does not exist', async () => {
      jobCardRepository.findOne.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });

    it('finds a Job Card by appointment id', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard());

      const result = await service.findByAppointmentId('apt-1');

      expect(result).toEqual(expect.objectContaining({ appointmentId: 'apt-1' }));
    });

    it('throws NotFoundException when no Job Card exists for the appointment', async () => {
      jobCardRepository.findOne.mockResolvedValue(null);

      await expect(service.findByAppointmentId('apt-missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('assignWorkshopTechnician', () => {
    it('sets WORKSHOP_ASSIGNED from SECTION_ASSIGNED + section=WORKSHOP', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.SECTION_ASSIGNED, section: JobCardSection.WORKSHOP }));

      const result = await service.assignWorkshopTechnician('jc-1', 'tech-1');

      expect(result.status).toBe(JobCardStatus.WORKSHOP_ASSIGNED);
      expect(result.assignedWorkshopTechnicianId).toBe('tech-1');
    });

    it('rejects a job routed to ON_SITE_REPAIR instead of WORKSHOP', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.SECTION_ASSIGNED, section: JobCardSection.ON_SITE_REPAIR }));

      await expect(service.assignWorkshopTechnician('jc-1', 'tech-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects when not yet SECTION_ASSIGNED', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.SN_VALIDATED, section: null }));

      await expect(service.assignWorkshopTechnician('jc-1', 'tech-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('startWip / setSparePending / resumeFromSparePending / completeWorkshop', () => {
    it('startWip moves WORKSHOP_ASSIGNED -> IN_PROGRESS', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.WORKSHOP_ASSIGNED }));

      const result = await service.startWip('jc-1');

      expect(result.status).toBe(JobCardStatus.IN_PROGRESS);
    });

    it('startWip rejects from any other status', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.SECTION_ASSIGNED }));

      await expect(service.startWip('jc-1')).rejects.toThrow(BadRequestException);
    });

    it('setSparePending moves IN_PROGRESS -> SPARE_PENDING', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS }));

      const result = await service.setSparePending('jc-1');

      expect(result.status).toBe(JobCardStatus.SPARE_PENDING);
    });

    it('resumeFromSparePending moves SPARE_PENDING -> IN_PROGRESS (the top-up case)', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.SPARE_PENDING }));

      const result = await service.resumeFromSparePending('jc-1');

      expect(result.status).toBe(JobCardStatus.IN_PROGRESS);
    });

    it('resumeFromSparePending is a no-op when the job was not waiting on parts', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS }));

      const result = await service.resumeFromSparePending('jc-1');

      expect(result.status).toBe(JobCardStatus.IN_PROGRESS);
      expect(jobCardRepository.save).not.toHaveBeenCalled();
    });

    it('completeWorkshop moves IN_PROGRESS -> READY_FOR_QC', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS }));

      const result = await service.completeWorkshop('jc-1');

      expect(result.status).toBe(JobCardStatus.READY_FOR_QC);
    });

    it('completeWorkshop rejects while SPARE_PENDING - cannot complete while still waiting on parts', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.SPARE_PENDING }));

      await expect(service.completeWorkshop('jc-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancel', () => {
    it('sets CANCELLED and records the reason', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.IN_PROGRESS }));

      const result = await service.cancel('jc-1', 'Customer withdrew the appliance');

      expect(result.status).toBe(JobCardStatus.CANCELLED);
      expect(result.cancellationReason).toBe('Customer withdrew the appliance');
    });

    it('rejects cancelling an already-cancelled Job Card', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.CANCELLED }));

      await expect(service.cancel('jc-1', 'again')).rejects.toThrow(BadRequestException);
    });

    it('rejects cancelling a Job Card already READY_FOR_QC', async () => {
      jobCardRepository.findOne.mockResolvedValue(jobCard({ status: JobCardStatus.READY_FOR_QC }));

      await expect(service.cancel('jc-1', 'too late')).rejects.toThrow(BadRequestException);
    });
  });
});
