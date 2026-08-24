import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TechnicianService } from './technician.service';
import { WarrantyStatus } from './entities/technician-visit.entity';
import { AppointmentStatus } from '../appointments/entities/appointment.entity';

describe('TechnicianService', () => {
  let service: TechnicianService;
  let visitRepository: any;
  let appointmentsService: any;
  let masterDataService: any;

  const fieldTech = (id = 'tech-1'): any => ({ id, role: { name: 'TECHNICIAN_FIELD' } });
  const supervisor = (id = 'lead-1'): any => ({ id, role: { name: 'TECHNICAL_TEAM_LEADER' } });

  const appointment = (overrides: any = {}) => ({
    id: 'apt-1',
    status: AppointmentStatus.TECHNICIAN_ASSIGNED,
    technicianId: 'tech-1',
    ...overrides,
  });

  const visit = (overrides: any = {}) => ({
    id: 'visit-1',
    appointmentId: 'apt-1',
    technicianId: 'tech-1',
    startGpsLat: 25.2048,
    startGpsLng: 55.2708,
    startedAt: new Date('2026-08-24T10:00:00Z'),
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
    visitRepository = {
      findOne: jest.fn(),
      create: jest.fn((data: any) => data),
      save: jest.fn((data: any) => Promise.resolve({ ...data, id: data.id || 'visit-1' })),
    };
    appointmentsService = {
      findById: jest.fn(),
      markOnSite: jest.fn(),
      getTechnicianSchedule: jest.fn(),
    };
    masterDataService = {
      checkWarranty: jest.fn(),
      findFaultByCode: jest.fn(),
      findSymptomByCode: jest.fn(),
    };

    service = new TechnicianService(visitRepository, appointmentsService, masterDataService);
  });

  describe('startVisit', () => {
    const dto = { gpsLat: 25.2048, gpsLng: 55.2708 };

    it('transitions the appointment on-site and creates a new visit on first arrival', async () => {
      appointmentsService.findById.mockResolvedValue(appointment({ status: AppointmentStatus.TECHNICIAN_ASSIGNED }));
      visitRepository.findOne.mockResolvedValue(null);

      const result = await service.startVisit('apt-1', dto, fieldTech(), { headers: {} });

      expect(appointmentsService.markOnSite).toHaveBeenCalledWith('apt-1', 'tech-1', { headers: {} });
      expect(visitRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ appointmentId: 'apt-1', technicianId: 'tech-1', startGpsLat: 25.2048, startGpsLng: 55.2708 }),
      );
      expect(result).toEqual(expect.objectContaining({ appointmentId: 'apt-1' }));
    });

    it('skips the status transition when the appointment is already ON_SITE (restart)', async () => {
      appointmentsService.findById.mockResolvedValue(appointment({ status: AppointmentStatus.ON_SITE }));
      visitRepository.findOne.mockResolvedValue(visit({ startGpsLat: 1, startGpsLng: 1 }));

      const result = await service.startVisit('apt-1', dto, fieldTech(), { headers: {} });

      expect(appointmentsService.markOnSite).not.toHaveBeenCalled();
      expect(visitRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ startGpsLat: 25.2048, startGpsLng: 55.2708 }),
      );
      expect(result).toEqual(expect.objectContaining({ startGpsLat: 25.2048 }));
    });

    it('overwrites GPS/start time on restart but preserves previously captured S/N and fault/symptom data', async () => {
      appointmentsService.findById.mockResolvedValue(appointment({ status: AppointmentStatus.ON_SITE }));
      const existing = visit({ serialNumber: 'SN1', faultCode: 'F001', symptomCode: 'S001' });
      visitRepository.findOne.mockResolvedValue(existing);

      await service.startVisit('apt-1', { gpsLat: 1, gpsLng: 2 }, fieldTech(), {});

      expect(visitRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ serialNumber: 'SN1', faultCode: 'F001', symptomCode: 'S001', startGpsLat: 1, startGpsLng: 2 }),
      );
    });

    it('propagates the BadRequestException AppointmentsService throws for an invalid status', async () => {
      appointmentsService.findById.mockResolvedValue(appointment({ status: AppointmentStatus.SCHEDULED }));
      appointmentsService.markOnSite.mockRejectedValue(new BadRequestException('bad status'));

      await expect(service.startVisit('apt-1', dto, fieldTech(), {})).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when a TECHNICIAN_FIELD user is not the assigned technician', async () => {
      appointmentsService.findById.mockResolvedValue(appointment({ technicianId: 'someone-else' }));

      await expect(service.startVisit('apt-1', dto, fieldTech('tech-1'), {})).rejects.toThrow(ForbiddenException);
      expect(appointmentsService.markOnSite).not.toHaveBeenCalled();
    });

    it('allows a supervisory role to start a visit on any appointment', async () => {
      appointmentsService.findById.mockResolvedValue(appointment({ technicianId: 'someone-else', status: AppointmentStatus.CONFIRMED }));
      visitRepository.findOne.mockResolvedValue(null);

      const result = await service.startVisit('apt-1', dto, supervisor('lead-1'), {});

      expect(appointmentsService.markOnSite).toHaveBeenCalledWith('apt-1', 'lead-1', {});
      expect(result).toEqual(expect.objectContaining({ appointmentId: 'apt-1' }));
    });
  });

  describe('captureSerialNumber', () => {
    const dto = { serialNumber: 'SN150000', brand: 'Samsung' };

    it('records an IN_WARRANTY badge when the warranty check matches', async () => {
      appointmentsService.findById.mockResolvedValue(appointment({ status: AppointmentStatus.ON_SITE }));
      visitRepository.findOne.mockResolvedValue(visit());
      masterDataService.checkWarranty.mockResolvedValue({
        isUnderWarranty: true,
        warrantyPeriodMonths: 24,
        supplier: 'Samsung Gulf',
      });

      const result = await service.captureSerialNumber('apt-1', dto, fieldTech());

      expect(masterDataService.checkWarranty).toHaveBeenCalledWith('SN150000', 'Samsung');
      expect(result).toEqual(
        expect.objectContaining({
          serialNumber: 'SN150000',
          warrantyStatus: WarrantyStatus.IN_WARRANTY,
          warrantySupplier: 'Samsung Gulf',
          warrantyPeriodMonths: 24,
        }),
      );
    });

    it('records an OUT_OF_WARRANTY badge when nothing matches', async () => {
      appointmentsService.findById.mockResolvedValue(appointment({ status: AppointmentStatus.ON_SITE }));
      visitRepository.findOne.mockResolvedValue(visit());
      masterDataService.checkWarranty.mockResolvedValue({
        isUnderWarranty: false,
        warrantyPeriodMonths: 0,
        supplier: 'Unknown',
      });

      const result = await service.captureSerialNumber('apt-1', dto, fieldTech());

      expect(result.warrantyStatus).toBe(WarrantyStatus.OUT_OF_WARRANTY);
    });

    it('throws BadRequestException when the appointment is not ON_SITE', async () => {
      appointmentsService.findById.mockResolvedValue(appointment({ status: AppointmentStatus.TECHNICIAN_ASSIGNED }));

      await expect(service.captureSerialNumber('apt-1', dto, fieldTech())).rejects.toThrow(BadRequestException);
      expect(masterDataService.checkWarranty).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no visit has been started yet', async () => {
      appointmentsService.findById.mockResolvedValue(appointment({ status: AppointmentStatus.ON_SITE }));
      visitRepository.findOne.mockResolvedValue(null);

      await expect(service.captureSerialNumber('apt-1', dto, fieldTech())).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when a TECHNICIAN_FIELD user is not the assigned technician', async () => {
      appointmentsService.findById.mockResolvedValue(
        appointment({ status: AppointmentStatus.ON_SITE, technicianId: 'someone-else' }),
      );

      await expect(service.captureSerialNumber('apt-1', dto, fieldTech('tech-1'))).rejects.toThrow(ForbiddenException);
    });

    it('clears any previously captured fault/symptom pair on re-capture', async () => {
      appointmentsService.findById.mockResolvedValue(appointment({ status: AppointmentStatus.ON_SITE }));
      visitRepository.findOne.mockResolvedValue(
        visit({ serialNumber: 'OLD-SN', faultCode: 'F001', symptomCode: 'S001', faultSymptomCapturedAt: new Date() }),
      );
      masterDataService.checkWarranty.mockResolvedValue({ isUnderWarranty: true, warrantyPeriodMonths: 12, supplier: 'X' });

      const result = await service.captureSerialNumber('apt-1', dto, fieldTech());

      expect(result.faultCode).toBeNull();
      expect(result.symptomCode).toBeNull();
      expect(result.faultSymptomCapturedAt).toBeNull();
    });
  });

  describe('captureFaultSymptom', () => {
    const dto = { faultCode: 'F001', symptomCode: 'S001' };

    it('records fault and symptom codes once the S/N has been validated', async () => {
      appointmentsService.findById.mockResolvedValue(appointment());
      visitRepository.findOne.mockResolvedValue(
        visit({ serialNumber: 'SN150000', warrantyStatus: WarrantyStatus.IN_WARRANTY }),
      );
      masterDataService.findFaultByCode.mockResolvedValue({ faultCode: 'F001' });
      masterDataService.findSymptomByCode.mockResolvedValue({ symptomCode: 'S001' });

      const result = await service.captureFaultSymptom('apt-1', dto, fieldTech());

      expect(masterDataService.findFaultByCode).toHaveBeenCalledWith('F001');
      expect(masterDataService.findSymptomByCode).toHaveBeenCalledWith('S001');
      expect(result).toEqual(expect.objectContaining({ faultCode: 'F001', symptomCode: 'S001' }));
    });

    it('throws BadRequestException when the serial number has not been captured yet', async () => {
      appointmentsService.findById.mockResolvedValue(appointment());
      visitRepository.findOne.mockResolvedValue(visit());

      await expect(service.captureFaultSymptom('apt-1', dto, fieldTech())).rejects.toThrow(BadRequestException);
      expect(masterDataService.findFaultByCode).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no visit has been started', async () => {
      appointmentsService.findById.mockResolvedValue(appointment());
      visitRepository.findOne.mockResolvedValue(null);

      await expect(service.captureFaultSymptom('apt-1', dto, fieldTech())).rejects.toThrow(NotFoundException);
    });

    it('propagates NotFoundException from master data for an unknown fault code', async () => {
      appointmentsService.findById.mockResolvedValue(appointment());
      visitRepository.findOne.mockResolvedValue(
        visit({ serialNumber: 'SN150000', warrantyStatus: WarrantyStatus.IN_WARRANTY }),
      );
      masterDataService.findFaultByCode.mockRejectedValue(new NotFoundException('Fault code F999 not found'));

      await expect(
        service.captureFaultSymptom('apt-1', { faultCode: 'F999', symptomCode: 'S001' }, fieldTech()),
      ).rejects.toThrow(NotFoundException);
    });

    it('propagates NotFoundException from master data for an unknown symptom code', async () => {
      appointmentsService.findById.mockResolvedValue(appointment());
      visitRepository.findOne.mockResolvedValue(
        visit({ serialNumber: 'SN150000', warrantyStatus: WarrantyStatus.IN_WARRANTY }),
      );
      masterDataService.findFaultByCode.mockResolvedValue({ faultCode: 'F001' });
      masterDataService.findSymptomByCode.mockRejectedValue(new NotFoundException('Symptom code S999 not found'));

      await expect(
        service.captureFaultSymptom('apt-1', { faultCode: 'F001', symptomCode: 'S999' }, fieldTech()),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when a TECHNICIAN_FIELD user is not the assigned technician', async () => {
      appointmentsService.findById.mockResolvedValue(appointment({ technicianId: 'someone-else' }));

      await expect(service.captureFaultSymptom('apt-1', dto, fieldTech('tech-1'))).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getVisit', () => {
    it('returns the visit for an appointment', async () => {
      visitRepository.findOne.mockResolvedValue(visit());
      const result = await service.getVisit('apt-1');
      expect(result).toEqual(visit());
    });

    it('throws NotFoundException when no visit exists for the appointment', async () => {
      visitRepository.findOne.mockResolvedValue(null);
      await expect(service.getVisit('apt-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getMySchedule', () => {
    it('delegates to AppointmentsService.getTechnicianSchedule with the given date', async () => {
      const date = new Date('2026-08-25T00:00:00Z');
      appointmentsService.getTechnicianSchedule.mockResolvedValue([{ id: 'apt-1' }]);

      const result = await service.getMySchedule('tech-1', date);

      expect(appointmentsService.getTechnicianSchedule).toHaveBeenCalledWith('tech-1', date);
      expect(result).toEqual([{ id: 'apt-1' }]);
    });

    it('defaults to today when no date is given', async () => {
      appointmentsService.getTechnicianSchedule.mockResolvedValue([]);

      await service.getMySchedule('tech-1');

      expect(appointmentsService.getTechnicianSchedule).toHaveBeenCalledWith('tech-1', expect.any(Date));
    });
  });
});
