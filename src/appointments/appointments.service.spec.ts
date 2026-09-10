import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { In } from 'typeorm';
import { AppointmentsService } from './appointments.service';
import { AppointmentStatus, AppointmentType, AppointmentChannel, CustomerType } from './entities/appointment.entity';
import { AuditAction } from '../auth/entities/audit-log.entity';
import * as googleMapsLinkUtil from './google-maps-link.util';
import { GoogleMapsLinkError } from './google-maps-link.util';

describe('AppointmentsService', () => {
  let service: AppointmentsService;
  let appointmentRepository: any;
  let serviceCentreRepository: any;
  let userRepository: any;
  let auditLogRepository: any;
  let jobCardRepository: any;
  let inventoryService: any;

  const buildQb = (overrides: Partial<Record<string, any>> = {}) => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
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
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    serviceCentreRepository = { findOne: jest.fn() };
    userRepository = { findOne: jest.fn(), find: jest.fn() };
    auditLogRepository = { create: jest.fn((d: any) => d), save: jest.fn().mockResolvedValue(undefined) };
    jobCardRepository = { findOne: jest.fn().mockResolvedValue(null) };
    inventoryService = { hasActiveReservationInCustody: jest.fn().mockResolvedValue(false) };

    service = new AppointmentsService(
      appointmentRepository,
      serviceCentreRepository,
      userRepository,
      auditLogRepository,
      jobCardRepository,
      inventoryService,
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
        channel: AppointmentChannel.WHATSAPP,
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
      expect(qb.andWhere).toHaveBeenCalledWith('apt.channel = :channel', { channel: AppointmentChannel.WHATSAPP });
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

    it('Technician Assignment Board: unassigned=true filters to appointments with no technicianId', async () => {
      const qb = buildQb();
      appointmentRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({ unassigned: true });

      expect(qb.andWhere).toHaveBeenCalledWith('apt.technicianId IS NULL');
    });

    it('a specific technicianId takes priority over unassigned=true if both are somehow given', async () => {
      const qb = buildQb();
      appointmentRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({ technicianId: 'tech-1', unassigned: true });

      expect(qb.andWhere).toHaveBeenCalledWith('apt.technicianId = :technicianId', { technicianId: 'tech-1' });
      expect(qb.andWhere).not.toHaveBeenCalledWith('apt.technicianId IS NULL');
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

    // Technician Assignment Board drag-and-drop (2026-09-09, the-fool pre-mortem finding):
    // update() previously accepted ANY user id as the new technicianId with no role check
    // at all - a gap that mattered far more once drag-driven reassignment started calling
    // this method routinely. Same check assignTechnician() has always had.
    it('throws BadRequestException when the new technicianId does not belong to a technician', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment());
      userRepository.findOne.mockResolvedValue({ id: 'user-9', role: { name: 'CCE' } });

      await expect(service.update('apt-1', { technicianId: 'user-9' } as any, 'user-1')).rejects.toThrow(BadRequestException);
      expect(appointmentRepository.save).not.toHaveBeenCalled();
    });

    // --- Reassign-until-visit-start rule (2026-09-09, the-fool pre-mortem finding) -----

    it('rejects a technician reassignment once the appointment is ON_SITE', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ status: AppointmentStatus.ON_SITE, technicianId: 'tech-1' }));

      await expect(service.update('apt-1', { technicianId: 'tech-2' } as any, 'user-1')).rejects.toThrow(BadRequestException);
      expect(appointmentRepository.save).not.toHaveBeenCalled();
      // Rejected before ever looking up the new technician - status is checked first.
      expect(userRepository.findOne).not.toHaveBeenCalled();
    });

    it('rejects a reschedule (scheduledAt change) once the appointment is ON_SITE', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ status: AppointmentStatus.ON_SITE }));

      await expect(
        service.update('apt-1', { scheduledAt: '2026-08-25T15:00:00Z' } as any, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(appointmentRepository.save).not.toHaveBeenCalled();
      expect(serviceCentreRepository.findOne).not.toHaveBeenCalled();
    });

    it('allows an unrelated field edit (e.g. notes) on an ON_SITE appointment - the rule only covers technicianId/scheduledAt', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ status: AppointmentStatus.ON_SITE }));

      const result = await service.update('apt-1', { notes: 'Customer requested a callback' } as any, 'user-1');

      expect(result).toEqual(appointment({ status: AppointmentStatus.ON_SITE, notes: 'Customer requested a callback' }));
    });

    it.each([AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.TECHNICIAN_ASSIGNED])(
      'still allows reassigning a technician while status is %s',
      async (status) => {
        appointmentRepository.findOne.mockResolvedValue(appointment({ status, technicianId: 'tech-1' }));
        userRepository.findOne.mockResolvedValue({ id: 'tech-2', role: { name: 'TECHNICIAN_FIELD' } });
        appointmentRepository.createQueryBuilder.mockReturnValueOnce(buildQb({ getCount: 0 }));

        await service.update('apt-1', { technicianId: 'tech-2' } as any, 'user-1');

        expect(appointmentRepository.save).toHaveBeenCalledWith(expect.objectContaining({ technicianId: 'tech-2' }));
      },
    );

    // --- Mobile Phase 5 reassignment guardrail (the-fool pre-mortem finding) -----------

    it('blocks reassignment with ConflictException when the outgoing technician holds an open reservation on the linked Job Card', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ technicianId: 'tech-1' }));
      jobCardRepository.findOne.mockResolvedValue({ id: 'jc-1', jobCardNumber: 'JC-0001' });
      inventoryService.hasActiveReservationInCustody.mockResolvedValue(true);

      await expect(
        service.update('apt-1', { technicianId: 'tech-2' } as any, 'user-1'),
      ).rejects.toThrow(ConflictException);

      expect(inventoryService.hasActiveReservationInCustody).toHaveBeenCalledWith('jc-1', 'tech-1');
      // Blocked before ever checking the new technician's own availability.
      expect(userRepository.findOne).not.toHaveBeenCalled();
    });

    it('allows reassignment when a Job Card exists but the outgoing technician holds no open reservation', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ technicianId: 'tech-1' }));
      jobCardRepository.findOne.mockResolvedValue({ id: 'jc-1', jobCardNumber: 'JC-0001' });
      inventoryService.hasActiveReservationInCustody.mockResolvedValue(false);
      userRepository.findOne.mockResolvedValue({ id: 'tech-2', role: { name: 'TECHNICIAN_FIELD' } });
      appointmentRepository.createQueryBuilder.mockReturnValueOnce(buildQb({ getCount: 0 }));

      const result = await service.update('apt-1', { technicianId: 'tech-2' } as any, 'user-1');

      expect(result).toEqual(appointment({ technicianId: 'tech-2' }));
    });

    it('skips the guardrail entirely when the appointment has no Job Card yet', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ technicianId: 'tech-1' }));
      jobCardRepository.findOne.mockResolvedValue(null);
      userRepository.findOne.mockResolvedValue({ id: 'tech-2', role: { name: 'TECHNICIAN_FIELD' } });
      appointmentRepository.createQueryBuilder.mockReturnValueOnce(buildQb({ getCount: 0 }));

      await service.update('apt-1', { technicianId: 'tech-2' } as any, 'user-1');

      expect(inventoryService.hasActiveReservationInCustody).not.toHaveBeenCalled();
    });

    it('skips the guardrail on a first-time assignment (no prior technician to hold a reservation)', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ technicianId: null }));
      userRepository.findOne.mockResolvedValue({ id: 'tech-2', role: { name: 'TECHNICIAN_FIELD' } });
      appointmentRepository.createQueryBuilder.mockReturnValueOnce(buildQb({ getCount: 0 }));

      await service.update('apt-1', { technicianId: 'tech-2' } as any, 'user-1');

      expect(jobCardRepository.findOne).not.toHaveBeenCalled();
      expect(inventoryService.hasActiveReservationInCustody).not.toHaveBeenCalled();
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

    // 2026-09-08 fix: once a Job Card exists for an appointment (created for any reason -
    // on-site or workshop), the appointment is fulfilled and cancellation must move to the
    // Job Card's own lifecycle instead. See appointments.service.ts#cancel's doc comment.
    it('throws ConflictException when a Job Card already exists for the appointment', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment());
      jobCardRepository.findOne.mockResolvedValue({ id: 'jc-1', jobCardNumber: 'JC-0001', appointmentId: 'apt-1' });

      await expect(service.cancel('apt-1', 'reason', 'user-1')).rejects.toThrow(ConflictException);
      expect(appointmentRepository.save).not.toHaveBeenCalled();
    });

    it('looks up the Job Card by this appointment id before allowing cancellation', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment());
      jobCardRepository.findOne.mockResolvedValue(null);

      await service.cancel('apt-1', 'reason', 'user-1');

      expect(jobCardRepository.findOne).toHaveBeenCalledWith({ where: { appointmentId: 'apt-1' } });
      expect(appointmentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: AppointmentStatus.CANCELLED }),
      );
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

    // Optional scheduledAt (2026-09-09, Technician Assignment Board drag-and-drop) - one
    // atomic call for a fresh drag-assign instead of assignTechnician() then a follow-up
    // update() call, see AssignTechnicianDto's own doc comment for why that matters.
    describe('optional scheduledAt', () => {
      it('does not touch scheduledAt or re-check capacity when scheduledAt is omitted', async () => {
        appointmentRepository.findOne.mockResolvedValue(appointment());
        userRepository.findOne.mockResolvedValue({ id: 'tech-1', role: { name: 'TECHNICIAN_FIELD' } });
        appointmentRepository.createQueryBuilder.mockReturnValue(buildQb({ getCount: 0 }));

        await service.assignTechnician('apt-1', 'tech-1', 'user-1');

        expect(serviceCentreRepository.findOne).not.toHaveBeenCalled();
        expect(appointmentRepository.save).toHaveBeenCalledWith(
          expect.objectContaining({ scheduledAt: appointment().scheduledAt }),
        );
      });

      it('sets scheduledAt to the given time when capacity and technician availability both allow it', async () => {
        appointmentRepository.findOne.mockResolvedValue(appointment());
        userRepository.findOne.mockResolvedValue({ id: 'tech-1', role: { name: 'TECHNICIAN_FIELD' } });
        serviceCentreRepository.findOne.mockResolvedValue(serviceCentre({ tuesday: { isOpen: true, maxJobsPerDay: 10 } }));
        appointmentRepository.createQueryBuilder.mockReturnValue(buildQb({ getCount: 0 }));

        await service.assignTechnician('apt-1', 'tech-1', 'user-1', undefined, '2026-08-25T11:30:00Z');

        expect(appointmentRepository.save).toHaveBeenCalledWith(
          expect.objectContaining({ technicianId: 'tech-1', scheduledAt: new Date('2026-08-25T11:30:00Z') }),
        );
      });

      it('throws ConflictException and never saves when the drop-computed time is at capacity', async () => {
        appointmentRepository.findOne.mockResolvedValue(appointment());
        userRepository.findOne.mockResolvedValue({ id: 'tech-1', role: { name: 'TECHNICIAN_FIELD' } });
        serviceCentreRepository.findOne.mockResolvedValue(serviceCentre({ tuesday: { isOpen: true, maxJobsPerDay: 1 } }));
        appointmentRepository.createQueryBuilder.mockReturnValue(buildQb({ getCount: 1 }));

        await expect(
          service.assignTechnician('apt-1', 'tech-1', 'user-1', undefined, '2026-08-25T11:30:00Z'),
        ).rejects.toThrow(ConflictException);
        expect(appointmentRepository.save).not.toHaveBeenCalled();
      });

      it('checks the new technician\'s availability against the given time, not the appointment\'s old time', async () => {
        appointmentRepository.findOne.mockResolvedValue(appointment({ scheduledAt: new Date('2026-08-25T09:00:00Z') }));
        userRepository.findOne.mockResolvedValue({ id: 'tech-1', role: { name: 'TECHNICIAN_FIELD' } });
        serviceCentreRepository.findOne.mockResolvedValue(serviceCentre({ tuesday: { isOpen: true, maxJobsPerDay: 10 } }));
        const qb = buildQb({ getCount: 0 });
        appointmentRepository.createQueryBuilder.mockReturnValue(qb);

        await service.assignTechnician('apt-1', 'tech-1', 'user-1', undefined, '2026-08-25T15:00:00Z');

        // checkTechnicianAvailability's own 15-min buffer (distinct from checkCapacity's
        // 30-min buffer, also called here) - confirms the NEW time drives this check, not
        // the appointment's original 09:00 scheduledAt.
        expect(qb.andWhere).toHaveBeenCalledWith('apt.scheduledAt BETWEEN :start AND :end', {
          start: new Date('2026-08-25T14:45:00Z'),
          end: new Date('2026-08-25T16:15:00Z'),
        });
      });
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

    // 2026-09-08: JobCardsService.create() now auto-completes the appointment the moment
    // its Job Card exists, so by the time a technician's own on-site completion call (or a
    // staff member's manual Complete click) reaches here, it's often already COMPLETED.
    it('completeAppointment is a no-op (not an error) when the appointment is already COMPLETED', async () => {
      const already = appointment({ status: AppointmentStatus.COMPLETED });
      appointmentRepository.findOne.mockResolvedValue(already);

      const result = await service.completeAppointment('apt-1', 'user-1');

      expect(result).toEqual(already);
      expect(appointmentRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('completeFromJobCardCreation', () => {
    it('completes a non-terminal appointment and stamps actualEndAt', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ status: AppointmentStatus.ON_SITE }));

      await service.completeFromJobCardCreation('apt-1', 'user-1');

      expect(appointmentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: AppointmentStatus.COMPLETED, actualEndAt: expect.any(Date) }),
      );
    });

    it('is a silent no-op for an appointment that is already COMPLETED', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ status: AppointmentStatus.COMPLETED }));

      await service.completeFromJobCardCreation('apt-1', 'user-1');

      expect(appointmentRepository.save).not.toHaveBeenCalled();
    });

    it('is a silent no-op for an appointment that is already CANCELLED', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ status: AppointmentStatus.CANCELLED }));

      await service.completeFromJobCardCreation('apt-1', 'user-1');

      expect(appointmentRepository.save).not.toHaveBeenCalled();
    });

    it('is a silent no-op for an AMC-type appointment, never throwing', async () => {
      appointmentRepository.findOne.mockResolvedValue(
        appointment({ status: AppointmentStatus.ON_SITE, type: AppointmentType.AMC }),
      );

      await expect(service.completeFromJobCardCreation('apt-1', 'user-1')).resolves.toBeUndefined();
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
          order: { priorityOrder: 'ASC', scheduledAt: 'ASC' },
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

  describe('reorderTechnicianSchedule (field/workshop scheduling split, 2026-09-10)', () => {
    const active = (id: string) => appointment({ id, status: AppointmentStatus.CONFIRMED, technicianId: 'tech-1' });

    it('sets priorityOrder = array index for each id, in the given order', async () => {
      appointmentRepository.find
        .mockResolvedValueOnce([active('a'), active('b'), active('c')]) // current active set
        .mockResolvedValueOnce([active('c'), active('a'), active('b')]); // re-fetch after update (already reordered)

      const result = await service.reorderTechnicianSchedule('tech-1', ['c', 'a', 'b']);

      expect(appointmentRepository.update).toHaveBeenCalledWith({ id: 'c' }, { priorityOrder: 0 });
      expect(appointmentRepository.update).toHaveBeenCalledWith({ id: 'a' }, { priorityOrder: 1 });
      expect(appointmentRepository.update).toHaveBeenCalledWith({ id: 'b' }, { priorityOrder: 2 });
      expect(result.map((a: any) => a.id)).toEqual(['c', 'a', 'b']);
    });

    it('rejects an empty list', async () => {
      await expect(service.reorderTechnicianSchedule('tech-1', [])).rejects.toThrow(BadRequestException);
      expect(appointmentRepository.update).not.toHaveBeenCalled();
    });

    it('rejects a list with duplicate ids', async () => {
      await expect(service.reorderTechnicianSchedule('tech-1', ['a', 'a'])).rejects.toThrow(BadRequestException);
      expect(appointmentRepository.update).not.toHaveBeenCalled();
    });

    it("rejects a list missing one of the technician's current active appointments", async () => {
      appointmentRepository.find.mockResolvedValueOnce([active('a'), active('b')]);

      await expect(service.reorderTechnicianSchedule('tech-1', ['a'])).rejects.toThrow(BadRequestException);
      expect(appointmentRepository.update).not.toHaveBeenCalled();
    });

    it("rejects a list containing an id that is not this technician's current active appointment", async () => {
      appointmentRepository.find.mockResolvedValueOnce([active('a')]);

      await expect(service.reorderTechnicianSchedule('tech-1', ['a', 'foreign-id'])).rejects.toThrow(BadRequestException);
      expect(appointmentRepository.update).not.toHaveBeenCalled();
    });

    it('never touches scheduledAt or technicianId - only priorityOrder', async () => {
      appointmentRepository.find.mockResolvedValueOnce([active('a')]).mockResolvedValueOnce([active('a')]);

      await service.reorderTechnicianSchedule('tech-1', ['a']);

      expect(appointmentRepository.update).toHaveBeenCalledWith({ id: 'a' }, { priorityOrder: 0 });
      expect(appointmentRepository.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSchedulingGrid', () => {
    const TECH_1 = '11111111-1111-4111-8111-111111111111';
    const TECH_2 = '22222222-2222-4222-8222-222222222222';

    const centreWithTechs = (schedule: any, assignedTechnicianIds: string[] = [TECH_1, TECH_2]) => ({
      id: 'sc-1',
      assignedTechnicianIds,
      schedule,
    });

    it('rejects a malformed date without querying anything', async () => {
      await expect(service.getSchedulingGrid('sc-1', '25-08-2026')).rejects.toThrow(BadRequestException);
      expect(serviceCentreRepository.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the service centre does not exist', async () => {
      serviceCentreRepository.findOne.mockResolvedValue(null);

      await expect(service.getSchedulingGrid('sc-missing', '2026-09-14')).rejects.toThrow(NotFoundException);
    });

    it('returns an empty technician list without querying users/appointments when the centre has no assigned technicians', async () => {
      serviceCentreRepository.findOne.mockResolvedValue({ id: 'sc-1', assignedTechnicianIds: [], schedule: {} });

      const result = await service.getSchedulingGrid('sc-1', '2026-09-14');

      expect(result.technicians).toEqual([]);
      expect(userRepository.find).not.toHaveBeenCalled();
      expect(appointmentRepository.find).not.toHaveBeenCalled();
    });

    // The exact bug that produced a bare "Internal server error" on the New Appointment
    // scheduling grid: ServiceCentre.assignedTechnicianIds has no per-item format validation
    // at the DTO level (only @IsArray()), so a hand-edited or legacy row can contain a
    // non-UUID entry. Handing that straight to TypeORM's In() on a uuid column makes Postgres
    // throw "invalid input syntax for type uuid" - an unhandled 500. Malformed entries must be
    // filtered out instead, so one bad id degrades gracefully rather than taking down the
    // whole grid for every technician at that service centre.
    it('drops malformed (non-UUID) technician ids instead of letting them reach the database', async () => {
      serviceCentreRepository.findOne.mockResolvedValue(
        centreWithTechs({ monday: { isOpen: true, startTime: '08:00', endTime: '09:00' } }, [TECH_1, 'not-a-uuid', '  ', '']),
      );
      userRepository.find.mockResolvedValue([{ id: TECH_1, fullName: 'Ravi Kumar' }]);
      appointmentRepository.find.mockResolvedValue([]);

      const result = await service.getSchedulingGrid('sc-1', '2026-09-14');

      expect(userRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: In([TECH_1]) }) }),
      );
      expect(result.technicians.map((t) => t.id)).toEqual([TECH_1]);
    });

    it('looks up field technicians assigned to the centre and only their appointments for that date', async () => {
      // 2026-09-14 is a Monday.
      serviceCentreRepository.findOne.mockResolvedValue(
        centreWithTechs({ monday: { isOpen: true, startTime: '08:00', endTime: '09:00' } }),
      );
      userRepository.find.mockResolvedValue([
        { id: TECH_1, fullName: 'Ravi Kumar' },
        { id: TECH_2, fullName: 'Fahad Noor' },
      ]);
      appointmentRepository.find.mockResolvedValue([]);

      await service.getSchedulingGrid('sc-1', '2026-09-14');

      expect(userRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ role: { name: 'TECHNICIAN_FIELD' } }),
          relations: { role: true },
        }),
      );
      expect(appointmentRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ technicianId: expect.anything() }),
        }),
      );
    });

    it('builds a real slot grid end-to-end for the correct weekday', async () => {
      // 2026-09-14 is a Monday - the Sunday entry must not be consulted.
      serviceCentreRepository.findOne.mockResolvedValue(
        centreWithTechs({
          sunday: { isOpen: false, startTime: '00:00', endTime: '00:00' },
          monday: { isOpen: true, startTime: '08:00', endTime: '08:30' },
        }, [TECH_1]),
      );
      userRepository.find.mockResolvedValue([{ id: TECH_1, fullName: 'Ravi Kumar' }]);
      appointmentRepository.find.mockResolvedValue([]);

      const result = await service.getSchedulingGrid('sc-1', '2026-09-14');

      expect(result.isOpen).toBe(true);
      expect(result.technicians).toEqual([
        {
          id: TECH_1,
          name: 'Ravi Kumar',
          appointmentCount: 0,
          atDailyCap: false,
          slots: [
            { time: '08:00', iso: '2026-09-14T08:00:00.000Z', available: true },
            { time: '08:15', iso: '2026-09-14T08:15:00.000Z', available: true },
          ],
        },
      ]);
    });

    it('feeds each technician only their own appointments, not another technician\'s', async () => {
      serviceCentreRepository.findOne.mockResolvedValue(
        centreWithTechs({ monday: { isOpen: true, startTime: '08:00', endTime: '09:00' } }),
      );
      userRepository.find.mockResolvedValue([
        { id: TECH_1, fullName: 'Ravi Kumar' },
        { id: TECH_2, fullName: 'Fahad Noor' },
      ]);
      appointmentRepository.find.mockResolvedValue([
        { technicianId: TECH_1, scheduledAt: new Date('2026-09-14T08:00:00.000Z'), estimatedDurationMinutes: 60 },
      ]);

      const result = await service.getSchedulingGrid('sc-1', '2026-09-14');

      const tech1 = result.technicians.find((t) => t.id === TECH_1)!;
      const tech2 = result.technicians.find((t) => t.id === TECH_2)!;
      expect(tech1.slots.every((s) => !s.available)).toBe(true);
      expect(tech2.slots.every((s) => s.available)).toBe(true);
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

  // The resolution logic itself (redirect-following, host allowlisting, coordinate
  // extraction) is unit-tested directly against a fake fetch in
  // google-maps-link.util.spec.ts - these only cover this service method's own job: call
  // through, and translate a GoogleMapsLinkError into the 400 the controller/frontend expect.
  describe('resolveMapLink', () => {
    afterEach(() => jest.restoreAllMocks());

    it('returns the coordinates resolveGoogleMapsLink() finds', async () => {
      jest.spyOn(googleMapsLinkUtil, 'resolveGoogleMapsLink').mockResolvedValue({ lat: 25.2048493, lng: 55.2707828 });

      const result = await service.resolveMapLink('https://maps.app.goo.gl/AbCdEf');

      expect(result).toEqual({ lat: 25.2048493, lng: 55.2707828 });
      expect(googleMapsLinkUtil.resolveGoogleMapsLink).toHaveBeenCalledWith('https://maps.app.goo.gl/AbCdEf');
    });

    it('turns a GoogleMapsLinkError into a BadRequestException carrying the same message', async () => {
      jest.spyOn(googleMapsLinkUtil, 'resolveGoogleMapsLink').mockRejectedValue(
        new GoogleMapsLinkError('That does not look like a Google Maps link.'),
      );

      await expect(service.resolveMapLink('https://evil.example.com/')).rejects.toThrow(BadRequestException);
      await expect(service.resolveMapLink('https://evil.example.com/')).rejects.toThrow(
        'That does not look like a Google Maps link.',
      );
    });

    it('does not swallow an unrelated error as if it were a bad link', async () => {
      jest.spyOn(googleMapsLinkUtil, 'resolveGoogleMapsLink').mockRejectedValue(new Error('boom'));

      await expect(service.resolveMapLink('https://maps.app.goo.gl/AbCdEf')).rejects.toThrow('boom');
      await expect(service.resolveMapLink('https://maps.app.goo.gl/AbCdEf')).rejects.not.toBeInstanceOf(BadRequestException);
    });
  });
});
