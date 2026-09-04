import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentStatus, AppointmentType, CustomerType } from './entities/appointment.entity';
import { AuditAction } from '../auth/entities/audit-log.entity';

describe('AppointmentsService', () => {
  let service: AppointmentsService;
  let appointmentRepository: any;
  let serviceCentreRepository: any;
  let userRepository: any;
  let auditLogRepository: any;

  const buildQb = (overrides: Partial<Record<string, any>> = {}) => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(overrides.getOne ?? null),
    getCount: jest.fn().mockResolvedValue(overrides.getCount ?? 0),
    getManyAndCount: jest.fn().mockResolvedValue(overrides.getManyAndCount ?? [[], 0]),
  });

  const serviceCentre = (schedule: any = {}) => ({
    id: 'sc-1',
    isActive: true,
    schedule,
  });

  const appointment = (overrides: any = {}) => ({
    id: 'apt-1',
    appointmentNumber: 'APT-20260824-0001',
    status: AppointmentStatus.SCHEDULED,
    serviceCentreId: 'sc-1',
    technicianId: null,
    scheduledAt: new Date('2026-08-25T09:00:00Z'),
    estimatedDurationMinutes: 60,
    ...overrides,
  });

  beforeEach(() => {
    appointmentRepository = {
      createQueryBuilder: jest.fn(),
      create: jest.fn((data: any) => data),
      save: jest.fn((data: any) => Promise.resolve({ ...data, id: data.id || 'apt-1' })),
      findOne: jest.fn(),
      find: jest.fn(),
    };
    serviceCentreRepository = { findOne: jest.fn() };
    userRepository = { findOne: jest.fn() };
    auditLogRepository = { create: jest.fn((d: any) => d), save: jest.fn().mockResolvedValue(undefined) };

    service = new AppointmentsService(
      appointmentRepository,
      serviceCentreRepository,
      userRepository,
      auditLogRepository,
    );
  });

  describe('create', () => {
    const dto = {
      type: AppointmentType.WARRANTY,
      customerType: CustomerType.B2C,
      customerName: 'John Doe',
      customerPhone: '+971501234567',
      scheduledAt: '2026-08-25T09:00:00Z',
      serviceCentreId: 'sc-1',
    } as any;

    it('creates an appointment when capacity is available and no technician is requested', async () => {
      serviceCentreRepository.findOne.mockResolvedValue(serviceCentre({ tuesday: { isOpen: true, maxJobsPerDay: 5 } }));
      const capacityQb = buildQb({ getCount: 0 });
      const numberQb = buildQb({ getOne: null });
      appointmentRepository.createQueryBuilder
        .mockReturnValueOnce(capacityQb) // checkCapacity
        .mockReturnValueOnce(numberQb); // generateAppointmentNumber
      appointmentRepository.findOne.mockResolvedValue(appointment());

      const result = await service.create(dto, 'user-1', { headers: {} });

      expect(result).toEqual(appointment());
      expect(auditLogRepository.save).toHaveBeenCalled();
    });

    it('throws NotFoundException when the service centre is missing or inactive', async () => {
      serviceCentreRepository.findOne.mockResolvedValue(null);

      await expect(service.create(dto, 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the service centre is at capacity', async () => {
      serviceCentreRepository.findOne.mockResolvedValue(serviceCentre({ tuesday: { isOpen: true, maxJobsPerDay: 1 } }));
      // Only checkCapacity's query builder call is reached before the throw.
      appointmentRepository.createQueryBuilder.mockReturnValueOnce(buildQb({ getCount: 1 }));

      await expect(service.create(dto, 'user-1')).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when the requested technician does not exist', async () => {
      serviceCentreRepository.findOne.mockResolvedValue(serviceCentre({ tuesday: { isOpen: true, maxJobsPerDay: 5 } }));
      appointmentRepository.createQueryBuilder
        .mockReturnValueOnce(buildQb())
        .mockReturnValueOnce(buildQb({ getCount: 0 }));
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.create({ ...dto, technicianId: 'tech-1' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the assigned user is not a technician role', async () => {
      serviceCentreRepository.findOne.mockResolvedValue(serviceCentre({ tuesday: { isOpen: true, maxJobsPerDay: 5 } }));
      appointmentRepository.createQueryBuilder
        .mockReturnValueOnce(buildQb())
        .mockReturnValueOnce(buildQb({ getCount: 0 }));
      userRepository.findOne.mockResolvedValue({ id: 'tech-1', role: { name: 'CCE' } });

      await expect(
        service.create({ ...dto, technicianId: 'tech-1' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when the technician has a scheduling conflict', async () => {
      serviceCentreRepository.findOne.mockResolvedValue(serviceCentre({ tuesday: { isOpen: true, maxJobsPerDay: 5 } }));
      appointmentRepository.createQueryBuilder
        .mockReturnValueOnce(buildQb({ getCount: 0 })) // checkCapacity - available
        .mockReturnValueOnce(buildQb({ getCount: 1 })); // checkTechnicianAvailability - conflict
      userRepository.findOne.mockResolvedValue({ id: 'tech-1', role: { name: 'TECHNICIAN_FIELD' } });

      await expect(
        service.create({ ...dto, technicianId: 'tech-1' }, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('generateAppointmentNumber (via create)', () => {
    const dto = {
      type: AppointmentType.WARRANTY,
      customerType: CustomerType.B2C,
      customerName: 'Jane Doe',
      customerPhone: '+971501234567',
      scheduledAt: '2026-08-25T09:00:00Z',
      serviceCentreId: 'sc-1',
    } as any;

    it('increments the sequence when a same-day appointment number already exists', async () => {
      // generateAppointmentNumber() prefixes with the *real* current date (new Date()),
      // so the fixture's existing appointment number must match that same prefix.
      const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const prefix = `APT-${todayStr}-`;

      serviceCentreRepository.findOne.mockResolvedValue(serviceCentre({ tuesday: { isOpen: true, maxJobsPerDay: 5 } }));
      appointmentRepository.createQueryBuilder
        .mockReturnValueOnce(buildQb({ getCount: 0 })) // checkCapacity
        .mockReturnValueOnce(buildQb({ getOne: { appointmentNumber: `${prefix}0003` } })); // generateAppointmentNumber
      appointmentRepository.findOne.mockResolvedValue(appointment());

      await service.create(dto, 'user-1');

      expect(appointmentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ appointmentNumber: `${prefix}0004` }),
      );
    });
  });

  describe('findAll', () => {
    it('applies every provided filter and paginates the results', async () => {
      const qb = buildQb({ getManyAndCount: [[appointment()], 1] });
      appointmentRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAll({
        serviceCentreId: 'sc-1',
        technicianId: 'tech-1',
        status: AppointmentStatus.SCHEDULED,
        type: AppointmentType.WARRANTY,
        dateFrom: new Date('2026-08-01'),
        dateTo: new Date('2026-08-31'),
        page: 2,
        limit: 10,
      });

      expect(qb.andWhere).toHaveBeenCalledWith('apt.serviceCentreId = :serviceCentreId', {
        serviceCentreId: 'sc-1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('apt.technicianId = :technicianId', { technicianId: 'tech-1' });
      expect(qb.andWhere).toHaveBeenCalledWith('apt.status = :status', { status: AppointmentStatus.SCHEDULED });
      expect(qb.andWhere).toHaveBeenCalledWith('apt.type = :type', { type: AppointmentType.WARRANTY });
      expect(qb.skip).toHaveBeenCalledWith(10);
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(result).toEqual({ data: [appointment()], total: 1, page: 2, limit: 10 });
    });

    it('defaults to page 1 / limit 20 with no filters applied', async () => {
      const qb = buildQb();
      appointmentRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAll();

      expect(qb.andWhere).not.toHaveBeenCalled();
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(20);
      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    });
  });

  describe('findById / findByAppointmentNumber', () => {
    it('returns the appointment with its relations', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment());
      const result = await service.findById('apt-1');
      expect(appointmentRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'apt-1' },
        relations: { serviceCentre: true, technician: true, createdBy: true },
      });
      expect(result).toEqual(appointment());
    });

    it('throws NotFoundException when the id does not match', async () => {
      appointmentRepository.findOne.mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for an unknown appointment number', async () => {
      appointmentRepository.findOne.mockResolvedValue(null);
      await expect(service.findByAppointmentNumber('APT-X')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates simple fields without touching capacity or technician checks', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment());

      const result = await service.update('apt-1', { notes: 'Call before arrival' } as any, 'user-1');

      expect(appointmentRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(appointmentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ notes: 'Call before arrival' }),
      );
      expect(result).toEqual(appointment({ notes: 'Call before arrival' }));
    });

    it('re-checks capacity when rescheduling to a new time and throws when unavailable', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment());
      serviceCentreRepository.findOne.mockResolvedValue(
        serviceCentre({ tuesday: { isOpen: true, maxJobsPerDay: 1 } }),
      );
      appointmentRepository.createQueryBuilder.mockReturnValueOnce(buildQb({ getCount: 1 }));

      await expect(
        service.update('apt-1', { scheduledAt: '2026-08-25T14:00:00Z' } as any, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('re-checks technician availability when reassigning and throws NotFoundException for a bad technician', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment());
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.update('apt-1', { technicianId: 'tech-2' } as any, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the newly assigned technician has a conflict', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment());
      userRepository.findOne.mockResolvedValue({ id: 'tech-2', role: { name: 'TECHNICIAN_FIELD' } });
      appointmentRepository.createQueryBuilder.mockReturnValueOnce(buildQb({ getCount: 1 }));

      await expect(
        service.update('apt-1', { technicianId: 'tech-2' } as any, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('succeeds when reassigning to an available technician', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment());
      userRepository.findOne.mockResolvedValue({ id: 'tech-2', role: { name: 'TECHNICIAN_FIELD' } });
      appointmentRepository.createQueryBuilder.mockReturnValueOnce(buildQb({ getCount: 0 }));

      const result = await service.update('apt-1', { technicianId: 'tech-2' } as any, 'user-1');

      expect(appointmentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ technicianId: 'tech-2' }),
      );
      expect(result).toEqual(appointment({ technicianId: 'tech-2' }));
    });
  });

  describe('cancel', () => {
    it('cancels a scheduled appointment', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment());

      const result = await service.cancel('apt-1', 'Customer changed mind', 'user-1');

      expect(appointmentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: AppointmentStatus.CANCELLED, cancellationReason: 'Customer changed mind' }),
      );
      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.CANCEL }),
      );
    });

    it('throws BadRequestException when the appointment is already completed', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ status: AppointmentStatus.COMPLETED }));

      await expect(service.cancel('apt-1', 'reason', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the appointment is already cancelled', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ status: AppointmentStatus.CANCELLED }));

      await expect(service.cancel('apt-1', 'reason', 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('assignTechnician', () => {
    it('assigns an available technician to a scheduled appointment', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment());
      userRepository.findOne.mockResolvedValue({ id: 'tech-1', role: { name: 'TECHNICIAN_FIELD' } });
      appointmentRepository.createQueryBuilder.mockReturnValue(buildQb({ getCount: 0 }));

      await service.assignTechnician('apt-1', 'tech-1', 'user-1');

      expect(appointmentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ technicianId: 'tech-1', status: AppointmentStatus.TECHNICIAN_ASSIGNED }),
      );
    });

    it('throws BadRequestException for an appointment status that cannot take assignment', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ status: AppointmentStatus.COMPLETED }));

      await expect(service.assignTechnician('apt-1', 'tech-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for an invalid or non-technician user', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment());
      userRepository.findOne.mockResolvedValue({ id: 'tech-1', role: { name: 'CCE' } });

      await expect(service.assignTechnician('apt-1', 'tech-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when the technician is already booked', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment());
      userRepository.findOne.mockResolvedValue({ id: 'tech-1', role: { name: 'TECHNICIAN_FIELD' } });
      appointmentRepository.createQueryBuilder.mockReturnValue(buildQb({ getCount: 1 }));

      await expect(service.assignTechnician('apt-1', 'tech-1', 'user-1')).rejects.toThrow(ConflictException);
    });

    it('does not self-conflict when the appointment already carries the target technicianId (e.g. set at creation)', async () => {
      // Regression test: an appointment created with technicianId set directly in the
      // POST body already carries that id and a conflict-check-eligible status
      // (SCHEDULED). Its own row would match checkTechnicianAvailability's query on
      // technicianId + status + the scheduledAt window unless explicitly excluded -
      // assignTechnician must pass the appointment's own id through to exclude it.
      appointmentRepository.findOne.mockResolvedValue(appointment({ technicianId: 'tech-1' }));
      userRepository.findOne.mockResolvedValue({ id: 'tech-1', role: { name: 'TECHNICIAN_FIELD' } });
      const qb = buildQb({ getCount: 0 });
      appointmentRepository.createQueryBuilder.mockReturnValue(qb);

      await service.assignTechnician('apt-1', 'tech-1', 'user-1');

      expect(qb.andWhere).toHaveBeenCalledWith('apt.id != :excludeAppointmentId', {
        excludeAppointmentId: 'apt-1',
      });
      expect(appointmentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ technicianId: 'tech-1', status: AppointmentStatus.TECHNICIAN_ASSIGNED }),
      );
    });
  });

  describe('checkCapacity', () => {
    it('reports unavailable when the service centre does not exist', async () => {
      serviceCentreRepository.findOne.mockResolvedValue(null);

      const result = await service.checkCapacity('sc-missing', new Date('2026-08-25T09:00:00Z'));

      expect(result).toEqual({
        available: false,
        currentBookings: 0,
        maxCapacity: 0,
        message: 'Service centre not found',
      });
    });

    it('is unavailable when the day is explicitly marked closed, regardless of booking count', async () => {
      serviceCentreRepository.findOne.mockResolvedValue(
        serviceCentre({ tuesday: { isOpen: false, maxJobsPerDay: 20 } }),
      );
      appointmentRepository.createQueryBuilder.mockReturnValue(buildQb({ getCount: 0 }));

      const result = await service.checkCapacity('sc-1', new Date('2026-08-25T09:00:00Z'));

      expect(result.available).toBe(false);
    });

    it('falls back to a default max of 10 when no schedule entry exists for the day', async () => {
      serviceCentreRepository.findOne.mockResolvedValue(serviceCentre({}));
      appointmentRepository.createQueryBuilder.mockReturnValue(buildQb({ getCount: 5 }));

      const result = await service.checkCapacity('sc-1', new Date('2026-08-25T09:00:00Z'));

      expect(result).toEqual(
        expect.objectContaining({ available: true, currentBookings: 5, maxCapacity: 10 }),
      );
    });

    it('is unavailable once bookings reach the configured max for the day', async () => {
      serviceCentreRepository.findOne.mockResolvedValue(
        serviceCentre({ tuesday: { isOpen: true, maxJobsPerDay: 3 } }),
      );
      appointmentRepository.createQueryBuilder.mockReturnValue(buildQb({ getCount: 3 }));

      const result = await service.checkCapacity('sc-1', new Date('2026-08-25T09:00:00Z'));

      expect(result.available).toBe(false);
      expect(result.message).toContain('at capacity');
    });
  });

  describe('checkTechnicianAvailability', () => {
    it('is available when there are no conflicting appointments', async () => {
      appointmentRepository.createQueryBuilder.mockReturnValue(buildQb({ getCount: 0 }));

      const result = await service.checkTechnicianAvailability('tech-1', new Date());

      expect(result).toBe(true);
    });

    it('is unavailable when a conflicting appointment exists', async () => {
      appointmentRepository.createQueryBuilder.mockReturnValue(buildQb({ getCount: 1 }));

      const result = await service.checkTechnicianAvailability('tech-1', new Date());

      expect(result).toBe(false);
    });

    it('adds an id-exclusion clause to the query when excludeAppointmentId is passed', async () => {
      const qb = buildQb({ getCount: 0 });
      appointmentRepository.createQueryBuilder.mockReturnValue(qb);

      await service.checkTechnicianAvailability('tech-1', new Date(), 60, 'apt-1');

      expect(qb.andWhere).toHaveBeenCalledWith('apt.id != :excludeAppointmentId', {
        excludeAppointmentId: 'apt-1',
      });
    });

    it('does not add the id-exclusion clause when excludeAppointmentId is omitted', async () => {
      const qb = buildQb({ getCount: 0 });
      appointmentRepository.createQueryBuilder.mockReturnValue(qb);

      await service.checkTechnicianAvailability('tech-1', new Date());

      expect(qb.andWhere).not.toHaveBeenCalledWith('apt.id != :excludeAppointmentId', expect.anything());
    });
  });

  describe('status transitions', () => {
    it('confirmAppointment moves SCHEDULED -> CONFIRMED', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment());
      await service.confirmAppointment('apt-1', 'user-1');
      expect(appointmentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: AppointmentStatus.CONFIRMED }),
      );
    });

    it('confirmAppointment rejects a non-SCHEDULED appointment', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ status: AppointmentStatus.CONFIRMED }));
      await expect(service.confirmAppointment('apt-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('markOnSite moves CONFIRMED -> ON_SITE and stamps actualStartAt', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ status: AppointmentStatus.CONFIRMED }));
      await service.markOnSite('apt-1', 'user-1');
      expect(appointmentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: AppointmentStatus.ON_SITE, actualStartAt: expect.any(Date) }),
      );
    });

    it('markOnSite rejects an appointment that is not confirmed/assigned', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ status: AppointmentStatus.SCHEDULED }));
      await expect(service.markOnSite('apt-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('completeAppointment moves ON_SITE -> COMPLETED and stamps actualEndAt', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ status: AppointmentStatus.ON_SITE }));
      await service.completeAppointment('apt-1', 'user-1');
      expect(appointmentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: AppointmentStatus.COMPLETED, actualEndAt: expect.any(Date) }),
      );
    });

    it('completeAppointment rejects an appointment that is not on-site', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ status: AppointmentStatus.CONFIRMED }));
      await expect(service.completeAppointment('apt-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    // Frontend Phase 10 (AMC Management) pre-mortem finding: this generic endpoint used to
    // be reachable for an AMC PM-visit appointment too, silently completing it without ever
    // creating the AmcVisitCompletion record - AmcService.completeVisit() refuses to run once
    // status is already COMPLETED, so that data would become permanently uncapturable.
    it('completeAppointment rejects an AMC-type appointment, directing to the AMC completion endpoint', async () => {
      appointmentRepository.findOne.mockResolvedValue(
        appointment({ status: AppointmentStatus.ON_SITE, type: AppointmentType.AMC }),
      );
      await expect(service.completeAppointment('apt-1', 'user-1')).rejects.toThrow(BadRequestException);
      expect(appointmentRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('getTechnicianSchedule / getServiceCentreSchedule', () => {
    it('returns the technician day schedule ordered by scheduledAt', async () => {
      appointmentRepository.find.mockResolvedValue([appointment()]);

      const result = await service.getTechnicianSchedule('tech-1', new Date('2026-08-25T00:00:00Z'));

      expect(appointmentRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ technicianId: 'tech-1' }),
          relations: { serviceCentre: true },
          order: { scheduledAt: 'ASC' },
        }),
      );
      expect(result).toEqual([appointment()]);
    });

    it('returns the service centre day schedule ordered by scheduledAt', async () => {
      appointmentRepository.find.mockResolvedValue([appointment()]);

      const result = await service.getServiceCentreSchedule('sc-1', new Date('2026-08-25T00:00:00Z'));

      expect(appointmentRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ serviceCentreId: 'sc-1' }),
          relations: { technician: true },
          order: { scheduledAt: 'ASC' },
        }),
      );
      expect(result).toEqual([appointment()]);
    });
  });

  describe('getDashboardStats', () => {
    it('buckets today and week appointments by status', async () => {
      appointmentRepository.find
        .mockResolvedValueOnce([
          appointment({ status: AppointmentStatus.SCHEDULED }),
          appointment({ status: AppointmentStatus.COMPLETED }),
        ])
        .mockResolvedValueOnce([
          appointment({ status: AppointmentStatus.SCHEDULED }),
          appointment({ status: AppointmentStatus.CANCELLED }),
        ]);

      const result = await service.getDashboardStats('sc-1');

      expect(result.today).toEqual({ scheduled: 1, confirmed: 0, onSite: 0, completed: 1, cancelled: 0 });
      expect(result.week.total).toBe(2);
      expect(result.week.byStatus).toEqual({
        [AppointmentStatus.SCHEDULED]: 1,
        [AppointmentStatus.CANCELLED]: 1,
      });
    });
  });

  describe('logAudit (via cancel)', () => {
    it('does not propagate audit log failures', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment());
      auditLogRepository.save.mockRejectedValue(new Error('db down'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(service.cancel('apt-1', 'reason', 'user-1')).resolves.toBeDefined();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
