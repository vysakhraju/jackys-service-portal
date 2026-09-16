import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WorkshopIntakeService } from './workshop-intake.service';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { AppointmentStatus } from '../appointments/entities/appointment.entity';

describe('WorkshopIntakeService', () => {
  let service: WorkshopIntakeService;
  let intakeRepository: any;
  let appointmentsService: any;
  let masterDataService: any;

  const collectedAppointment = (overrides: any = {}) => ({
    id: 'apt-1',
    appointmentNumber: 'APT-0003',
    status: AppointmentStatus.COLLECTED_TO_WS,
    ...overrides,
  });

  const intake = (overrides: any = {}) => ({
    id: 'intake-1',
    appointmentId: 'apt-1',
    receivedByUserId: 'user-1',
    receivedAt: new Date('2026-09-16T08:00:00Z'),
    serialNumber: null,
    brand: null,
    warrantyStatus: null,
    warrantySupplier: null,
    warrantyPeriodMonths: null,
    serialNumberCapturedAt: null,
    faultCode: null,
    symptomCode: null,
    faultSymptomCapturedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    intakeRepository = {
      findOne: jest.fn(),
      create: jest.fn((data: any) => data),
      save: jest.fn((data: any) => Promise.resolve({ ...data, id: data.id || 'intake-1' })),
    };
    appointmentsService = {
      findById: jest.fn(),
    };
    masterDataService = {
      checkWarranty: jest.fn(),
      findFaultByCode: jest.fn(),
      findSymptomByCode: jest.fn(),
    };

    service = new WorkshopIntakeService(intakeRepository, appointmentsService, masterDataService);
  });

  describe('markReceived', () => {
    it('creates a new intake row stamped with who received it and when', async () => {
      appointmentsService.findById.mockResolvedValue(collectedAppointment());
      intakeRepository.findOne.mockResolvedValue(null);

      const result = await service.markReceived('apt-1', 'user-1');

      expect(intakeRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ appointmentId: 'apt-1', receivedByUserId: 'user-1' }),
      );
      expect(result.receivedByUserId).toBe('user-1');
      expect(result.receivedAt).toBeInstanceOf(Date);
    });

    it('is idempotent - returns the existing row unchanged on a second call, not a new one', async () => {
      appointmentsService.findById.mockResolvedValue(collectedAppointment());
      const existing = intake({ receivedByUserId: 'user-1', receivedAt: new Date('2026-09-16T08:00:00Z') });
      intakeRepository.findOne.mockResolvedValue(existing);

      const result = await service.markReceived('apt-1', 'user-2');

      expect(intakeRepository.create).not.toHaveBeenCalled();
      expect(intakeRepository.save).not.toHaveBeenCalled();
      expect(result).toBe(existing);
      expect(result.receivedByUserId).toBe('user-1'); // unchanged, not overwritten by the 2nd caller
    });

    it('rejects an appointment that is not COLLECTED_TO_WS', async () => {
      appointmentsService.findById.mockResolvedValue(collectedAppointment({ status: AppointmentStatus.ON_SITE }));

      await expect(service.markReceived('apt-1', 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('captureSerialNumber', () => {
    const dto = { serialNumber: 'SN990000', brand: 'LG' };

    it('captures S/N and the automated warranty check, once received', async () => {
      appointmentsService.findById.mockResolvedValue(collectedAppointment());
      intakeRepository.findOne.mockResolvedValue(intake());
      masterDataService.checkWarranty.mockResolvedValue({
        isUnderWarranty: true,
        warrantyPeriodMonths: 12,
        supplier: 'LG Gulf',
      });

      const result = await service.captureSerialNumber('apt-1', dto);

      expect(masterDataService.checkWarranty).toHaveBeenCalledWith('SN990000', 'LG');
      expect(result.serialNumber).toBe('SN990000');
      expect(result.warrantyStatus).toBe(WarrantyStatus.IN_WARRANTY);
      expect(result.warrantySupplier).toBe('LG Gulf');
      expect(result.warrantyPeriodMonths).toBe(12);
      expect(result.serialNumberCapturedAt).toBeInstanceOf(Date);
    });

    it('marks OUT_OF_WARRANTY when no warranty match is found', async () => {
      appointmentsService.findById.mockResolvedValue(collectedAppointment());
      intakeRepository.findOne.mockResolvedValue(intake());
      masterDataService.checkWarranty.mockResolvedValue({ isUnderWarranty: false, warrantyPeriodMonths: 0, supplier: 'Unknown' });

      const result = await service.captureSerialNumber('apt-1', dto);

      expect(result.warrantyStatus).toBe(WarrantyStatus.OUT_OF_WARRANTY);
    });

    it('a re-capture clears any previously recorded fault/symptom pair', async () => {
      appointmentsService.findById.mockResolvedValue(collectedAppointment());
      intakeRepository.findOne.mockResolvedValue(intake({ faultCode: 'F001', symptomCode: 'S001', faultSymptomCapturedAt: new Date() }));
      masterDataService.checkWarranty.mockResolvedValue({ isUnderWarranty: true, warrantyPeriodMonths: 12, supplier: 'LG Gulf' });

      const result = await service.captureSerialNumber('apt-1', dto);

      expect(result.faultCode).toBeNull();
      expect(result.symptomCode).toBeNull();
      expect(result.faultSymptomCapturedAt).toBeNull();
    });

    it('throws NotFoundException when the appointment has not been marked received yet', async () => {
      appointmentsService.findById.mockResolvedValue(collectedAppointment());
      intakeRepository.findOne.mockResolvedValue(null);

      await expect(service.captureSerialNumber('apt-1', dto)).rejects.toThrow(NotFoundException);
      expect(masterDataService.checkWarranty).not.toHaveBeenCalled();
    });

    it('rejects an appointment that is not COLLECTED_TO_WS', async () => {
      appointmentsService.findById.mockResolvedValue(collectedAppointment({ status: AppointmentStatus.CANCELLED }));

      await expect(service.captureSerialNumber('apt-1', dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('captureFaultSymptom', () => {
    const dto = { faultCode: 'F002', symptomCode: 'S002' };

    it('records fault/symptom once S/N has been validated', async () => {
      appointmentsService.findById.mockResolvedValue(collectedAppointment());
      intakeRepository.findOne.mockResolvedValue(intake({ serialNumber: 'SN990000', warrantyStatus: WarrantyStatus.IN_WARRANTY }));
      masterDataService.findFaultByCode.mockResolvedValue({ code: 'F002' });
      masterDataService.findSymptomByCode.mockResolvedValue({ code: 'S002' });

      const result = await service.captureFaultSymptom('apt-1', dto);

      expect(result.faultCode).toBe('F002');
      expect(result.symptomCode).toBe('S002');
      expect(result.faultSymptomCapturedAt).toBeInstanceOf(Date);
    });

    it('blocks recording fault/symptom before the serial number is captured', async () => {
      appointmentsService.findById.mockResolvedValue(collectedAppointment());
      intakeRepository.findOne.mockResolvedValue(intake());

      await expect(service.captureFaultSymptom('apt-1', dto)).rejects.toThrow(BadRequestException);
      expect(masterDataService.findFaultByCode).not.toHaveBeenCalled();
    });

    it('propagates a 404 from an unknown fault code', async () => {
      appointmentsService.findById.mockResolvedValue(collectedAppointment());
      intakeRepository.findOne.mockResolvedValue(intake({ serialNumber: 'SN990000', warrantyStatus: WarrantyStatus.IN_WARRANTY }));
      masterDataService.findFaultByCode.mockRejectedValue(new NotFoundException('Unknown fault code'));

      await expect(service.captureFaultSymptom('apt-1', dto)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the appointment has not been marked received yet', async () => {
      appointmentsService.findById.mockResolvedValue(collectedAppointment());
      intakeRepository.findOne.mockResolvedValue(null);

      await expect(service.captureFaultSymptom('apt-1', dto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getIntake', () => {
    it('returns the intake row when one exists', async () => {
      const row = intake();
      intakeRepository.findOne.mockResolvedValue(row);

      await expect(service.getIntake('apt-1')).resolves.toBe(row);
    });

    it('returns null (not a throw) when no intake exists yet - an ordinary, expected state', async () => {
      intakeRepository.findOne.mockResolvedValue(null);

      await expect(service.getIntake('apt-1')).resolves.toBeNull();
    });
  });
});
