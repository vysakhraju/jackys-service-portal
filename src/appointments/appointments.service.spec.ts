import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { In } from 'typeorm';
import { AppointmentsService } from './appointments.service';
import { AppointmentStatus, AppointmentType, AppointmentChannel, CustomerType, JobType } from './entities/appointment.entity';
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
  let workshopIntakeRepository: any;
  let inventoryService: any;
  let masterDataService: any;
  let appointmentActivityRepository: any;
  let appointmentActivityPauseRepository: any;

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
    workshopIntakeRepository = { find: jest.fn().mockResolvedValue([]) };
    inventoryService = { hasActiveReservationInCustody: jest.fn().mockResolvedValue(false) };
    // Phase 2 mandatory-field config - defaults to no configured rows so every pre-existing
    // test (written before this table existed) keeps passing unchanged; the dedicated
    // 'mandatory field config' describe block below overrides this per-test.
    // Phase 5 - Billing Channel override lookup used by update()'s relation-resync fix
    // (see that fix's own comment); defaults unused unless a test sets billingChannelId.
    masterDataService = {
      findAllAppointmentFieldConfigs: jest.fn().mockResolvedValue([]),
      findBillingChannelById: jest.fn(),
    };
    // Job Type split (2026-09-22) Phase 8 - appended at the end, matching the constructor's
    // own append-only ordering (see AppointmentsService's own comment on why).
    appointmentActivityRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d: any) => d),
      save: jest.fn((d: any) => Promise.resolve({ ...d, id: d.id || 'activity-1', startedAt: d.startedAt || new Date('2026-09-23T08:00:00Z') })),
      createQueryBuilder: jest.fn(),
    };
    appointmentActivityPauseRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((d: any) => d),
      save: jest.fn((d: any) => Promise.resolve({ ...d, id: d.id || 'pause-1', pausedAt: d.pausedAt || new Date('2026-09-23T09:00:00Z') })),
    };

    service = new AppointmentsService(
      appointmentRepository,
      serviceCentreRepository,
      userRepository,
      auditLogRepository,
      jobCardRepository,
      workshopIntakeRepository,
      inventoryService,
      masterDataService,
      appointmentActivityRepository,
      appointmentActivityPauseRepository,
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

  // Master-Data/New-Appointment billing modification Phase 2 (2026-09-22), req. 1 -
  // dynamic mandatory-field enforcement driven by AppointmentFieldConfig.
  describe('create - mandatory field config', () => {
    const dto = {
      type: AppointmentType.WARRANTY,
      customerType: CustomerType.B2C,
      customerName: 'John Doe',
      customerPhone: '+971501234567',
      scheduledAt: '2026-08-25T09:00:00Z',
      serviceCentreId: 'sc-1',
    } as any;

    it('rejects when a config-mandatory optional field is missing', async () => {
      masterDataService.findAllAppointmentFieldConfigs.mockResolvedValue([
        { fieldKey: 'jobType', fieldLabel: 'Job Type', isMandatory: true },
        { fieldKey: 'channel', fieldLabel: 'Channel', isMandatory: false },
      ]);

      await expect(service.create({ ...dto }, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create({ ...dto }, 'user-1')).rejects.toThrow(
        'Missing mandatory field(s): Job Type',
      );
      // Never gets as far as looking up the service centre once the field check rejects.
      expect(serviceCentreRepository.findOne).not.toHaveBeenCalled();
    });

    it('lists every missing mandatory field in one message', async () => {
      masterDataService.findAllAppointmentFieldConfigs.mockResolvedValue([
        { fieldKey: 'jobType', fieldLabel: 'Job Type', isMandatory: true },
        { fieldKey: 'channel', fieldLabel: 'Channel', isMandatory: true },
      ]);

      await expect(service.create({ ...dto }, 'user-1')).rejects.toThrow(
        'Missing mandatory field(s): Job Type, Channel',
      );
    });

    it('treats an empty/whitespace string as missing', async () => {
      masterDataService.findAllAppointmentFieldConfigs.mockResolvedValue([
        { fieldKey: 'notes', fieldLabel: 'Notes', isMandatory: true },
      ]);

      await expect(
        service.create({ ...dto, notes: '   ' }, 'user-1'),
      ).rejects.toThrow('Missing mandatory field(s): Notes');
    });

    it('passes when every config-mandatory field is present', async () => {
      masterDataService.findAllAppointmentFieldConfigs.mockResolvedValue([
        { fieldKey: 'jobType', fieldLabel: 'Job Type', isMandatory: true },
      ]);
      serviceCentreRepository.findOne.mockResolvedValue(serviceCentre({ tuesday: { isOpen: true, maxJobsPerDay: 5 } }));
      appointmentRepository.createQueryBuilder.mockReturnValue(buildQb({ getCount: 0 }));
      appointmentRepository.findOne.mockResolvedValue(appointment());

      const result = await service.create(
        { ...dto, jobType: 'REPAIR' },
        'user-1',
      );
      expect(result).toBeDefined();
    });

    it('ignores non-mandatory config rows entirely', async () => {
      masterDataService.findAllAppointmentFieldConfigs.mockResolvedValue([
        { fieldKey: 'jobType', fieldLabel: 'Job Type', isMandatory: false },
        { fieldKey: 'channel', fieldLabel: 'Channel', isMandatory: false },
      ]);
      serviceCentreRepository.findOne.mockResolvedValue(serviceCentre({ tuesday: { isOpen: true, maxJobsPerDay: 5 } }));
      appointmentRepository.createQueryBuilder.mockReturnValue(buildQb({ getCount: 0 }));
      appointmentRepository.findOne.mockResolvedValue(appointment());

      const result = await service.create({ ...dto }, 'user-1');
      expect(result).toBeDefined();
    });

    it('tolerates a stray type/customerType config row without double-blocking a valid request', async () => {
      // Per the entity's own doc comment, a config row should never exist for type/
      // customerType - they're permanently hard-enforced by CreateAppointmentDto's own
      // @IsEnum decorators (no @IsOptional), never by this table. This just proves that if
      // one ever did exist, it wouldn't crash or double-reject a request that already
      // supplies both.
      masterDataService.findAllAppointmentFieldConfigs.mockResolvedValue([
        { fieldKey: 'type', fieldLabel: 'Type', isMandatory: true },
        { fieldKey: 'customerType', fieldLabel: 'Customer Type', isMandatory: true },
      ]);
      serviceCentreRepository.findOne.mockResolvedValue(serviceCentre({ tuesday: { isOpen: true, maxJobsPerDay: 5 } }));
      appointmentRepository.createQueryBuilder.mockReturnValue(buildQb({ getCount: 0 }));
      appointmentRepository.findOne.mockResolvedValue(appointment());

      const result = await service.create({ ...dto }, 'user-1');
      expect(result).toBeDefined();
    });

    // Job Type split (requested 2026-09-22), Phase 6.
    it('resolves a Job-Type-scoped row over the global row for that Job Type', async () => {
      masterDataService.findAllAppointmentFieldConfigs.mockResolvedValue([
        { fieldKey: 'invoiceNumber', fieldLabel: 'Invoice Number', isMandatory: false, jobType: null, isVisible: true },
        { fieldKey: 'invoiceNumber', fieldLabel: 'Invoice Number', isMandatory: true, jobType: 'INSTALLATION', isVisible: true },
      ]);

      // REPAIR falls back to the global row (isMandatory: false) - passes.
      serviceCentreRepository.findOne.mockResolvedValue(serviceCentre({ tuesday: { isOpen: true, maxJobsPerDay: 5 } }));
      appointmentRepository.createQueryBuilder.mockReturnValue(buildQb({ getCount: 0 }));
      appointmentRepository.findOne.mockResolvedValue(appointment());
      await expect(service.create({ ...dto, jobType: 'REPAIR' }, 'user-1')).resolves.toBeDefined();

      // INSTALLATION matches its own scoped row (isMandatory: true) - rejects.
      await expect(
        service.create({ ...dto, jobType: 'INSTALLATION' }, 'user-1'),
      ).rejects.toThrow('Missing mandatory field(s): Invoice Number');
    });

    it('never enforces a hidden (isVisible: false) row, even if isMandatory is also true on it', async () => {
      masterDataService.findAllAppointmentFieldConfigs.mockResolvedValue([
        {
          fieldKey: 'problemDescription',
          fieldLabel: 'Problem Description',
          isMandatory: true,
          jobType: 'INSTALLATION',
          isVisible: false,
        },
      ]);
      serviceCentreRepository.findOne.mockResolvedValue(serviceCentre({ tuesday: { isOpen: true, maxJobsPerDay: 5 } }));
      appointmentRepository.createQueryBuilder.mockReturnValue(buildQb({ getCount: 0 }));
      appointmentRepository.findOne.mockResolvedValue(appointment());

      const result = await service.create({ ...dto, jobType: 'INSTALLATION' }, 'user-1');
      expect(result).toBeDefined();
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
      expect(result).toEqual({
        data: [{ ...appointment(), effectiveStatus: AppointmentStatus.SCHEDULED }],
        total: 1,
        page: 2,
        limit: 10,
      });
    });

    // req.txt Issue B/C - MARKED_RECEIVED and PENDING_JOB_CREATION aren't real
    // AppointmentStatus values; both filter to COLLECTED_TO_WS rows and then split on
    // whether that row's WorkshopIntake has captured a serial number yet.
    it('status=MARKED_RECEIVED: filters to COLLECTED_TO_WS rows whose intake has no serial number captured yet', async () => {
      const qb = buildQb();
      appointmentRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({ status: 'MARKED_RECEIVED' });

      expect(qb.andWhere).toHaveBeenCalledWith('apt.status = :collectedStatus', {
        collectedStatus: AppointmentStatus.COLLECTED_TO_WS,
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('"serialNumberCapturedAt" IS NULL'),
      );
    });

    it('status=PENDING_JOB_CREATION: filters to COLLECTED_TO_WS rows whose intake already has a serial number captured', async () => {
      const qb = buildQb();
      appointmentRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({ status: 'PENDING_JOB_CREATION' });

      expect(qb.andWhere).toHaveBeenCalledWith('apt.status = :collectedStatus', {
        collectedStatus: AppointmentStatus.COLLECTED_TO_WS,
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('"serialNumberCapturedAt" IS NOT NULL'),
      );
    });

    // Bug reported 2026-09-17: clicking the plain "Collected to WS" glance tile returned
    // MARKED_RECEIVED/PENDING_JOB_CREATION rows mixed in, because this branch used to fall
    // through to the generic `apt.status = :status` filter, which can't distinguish the sub-
    // stages since the raw column is identical across all three. Must stay mutually exclusive.
    it('status=COLLECTED_TO_WS: filters to COLLECTED_TO_WS rows with no WorkshopIntake row at all (excludes MARKED_RECEIVED/PENDING_JOB_CREATION)', async () => {
      const qb = buildQb();
      appointmentRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({ status: AppointmentStatus.COLLECTED_TO_WS });

      expect(qb.andWhere).toHaveBeenCalledWith('apt.status = :collectedStatus', {
        collectedStatus: AppointmentStatus.COLLECTED_TO_WS,
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('NOT EXISTS (SELECT 1 FROM workshop_intakes wi WHERE wi."appointmentId" = apt.id)'),
      );
    });

    it('attaches effectiveStatus: COLLECTED_TO_WS with no WorkshopIntake row reads as COLLECTED_TO_WS', async () => {
      const qb = buildQb({ getManyAndCount: [[appointment({ status: AppointmentStatus.COLLECTED_TO_WS })], 1] });
      appointmentRepository.createQueryBuilder.mockReturnValue(qb);
      workshopIntakeRepository.find.mockResolvedValue([]);

      const result = await service.findAll({});

      expect(result.data[0].effectiveStatus).toBe(AppointmentStatus.COLLECTED_TO_WS);
    });

    it('attaches effectiveStatus: COLLECTED_TO_WS with an intake row and no serialNumberCapturedAt reads as MARKED_RECEIVED', async () => {
      const qb = buildQb({ getManyAndCount: [[appointment({ status: AppointmentStatus.COLLECTED_TO_WS })], 1] });
      appointmentRepository.createQueryBuilder.mockReturnValue(qb);
      workshopIntakeRepository.find.mockResolvedValue([
        { appointmentId: 'apt-1', serialNumberCapturedAt: null },
      ]);

      const result = await service.findAll({});

      expect(result.data[0].effectiveStatus).toBe('MARKED_RECEIVED');
    });

    it('attaches effectiveStatus: COLLECTED_TO_WS with a captured serial number reads as PENDING_JOB_CREATION', async () => {
      const qb = buildQb({ getManyAndCount: [[appointment({ status: AppointmentStatus.COLLECTED_TO_WS })], 1] });
      appointmentRepository.createQueryBuilder.mockReturnValue(qb);
      workshopIntakeRepository.find.mockResolvedValue([
        { appointmentId: 'apt-1', serialNumberCapturedAt: new Date('2026-09-17T10:00:00Z') },
      ]);

      const result = await service.findAll({});

      expect(result.data[0].effectiveStatus).toBe('PENDING_JOB_CREATION');
    });

    it('does not query WorkshopIntake at all when no row in the page is COLLECTED_TO_WS', async () => {
      const qb = buildQb({ getManyAndCount: [[appointment({ status: AppointmentStatus.SCHEDULED })], 1] });
      appointmentRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({});

      expect(workshopIntakeRepository.find).not.toHaveBeenCalled();
    });

    // Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 2): apt.city/apt.applianceModel
    // are `eager: true` on the entity, but eager loading is silently ignored by QueryBuilder
    // (only repository find()/findOne() honour it) - this list must join them explicitly or
    // every row's `city`/`applianceModel` comes back undefined despite the eager flag.
    it('explicitly joins city and applianceModel - entity-level eager: true does not apply to QueryBuilder', async () => {
      const qb = buildQb();
      appointmentRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({});

      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('apt.city', 'city');
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('apt.applianceModel', 'am');
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

    // #218 pre-mortem follow-up (2026-09-14): JobCardsPage's appointment picker used to be
    // the one #218 picker that didn't narrow on partial input (an exact-number-only lookup),
    // which read as "broken" next to every other picker that does. This `q` filter is the
    // real fix - a true ILIKE search across appointment #, customer name, and phone - so it
    // behaves like every other converted picker.
    it('q: ILIKE-searches appointment #, customer name, phone, and serial number together, wrapped in %...%', async () => {
      const qb = buildQb();
      appointmentRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({ q: 'APT-005' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        "(apt.appointmentNumber ILIKE :q ESCAPE '\\' OR apt.customerName ILIKE :q ESCAPE '\\' OR apt.customerPhone ILIKE :q ESCAPE '\\' OR apt.serialNumber ILIKE :q ESCAPE '\\')",
        { q: '%APT-005%' },
      );
    });

    it('q: escapes literal %, _, and \\ in the search term so they match literally, not as ILIKE wildcards', async () => {
      const qb = buildQb();
      appointmentRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({ q: '50%_off\\promo' });

      expect(qb.andWhere).toHaveBeenCalledWith(expect.any(String), { q: '%50\\%\\_off\\\\promo%' });
    });

    it('q: a blank/whitespace-only search term is ignored, not turned into a %  %-matches-everything filter', async () => {
      const qb = buildQb();
      appointmentRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({ q: '   ' });

      expect(qb.andWhere).not.toHaveBeenCalledWith(expect.stringContaining('ILIKE'), expect.anything());
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
      // Also carries the synced `technician` relation object now (see the stale-relation
      // regression test above) - this is the fixed, correct shape, not an artifact.
      expect(result).toEqual(
        appointment({ technicianId: 'tech-2', technician: { id: 'tech-2', role: { name: 'TECHNICIAN_FIELD' } } } as any),
      );
    });

    // Regression (Technician Assignment Board drag-and-drop reassign-to-a-different-tech
    // bug report): update() is the drag-reassign path (assignTechnician() only handles the
    // very first assignment, from the Unassigned panel). A drag that changes BOTH
    // technicianId and scheduledAt together - the normal case, since the drop position on
    // the timeline computes the new time - re-checks capacity (service-centre-wide) AND the
    // new technician's own availability, but until now neither call excluded this
    // appointment's own row. Its own row still has the OLD technicianId/scheduledAt at query
    // time (not yet saved), so this exact appointment's row would only ever double-count
    // itself if the drop time or target technician landed close enough to its own current
    // slot to fall inside the checks' own +/-15-30 min windows - assignTechnician() already
    // guarded against exactly this for the first-assign path; update() must too, for the
    // reassign path drag-and-drop actually uses.
    it("excludes the appointment's own id from both the capacity and technician-availability checks when dragging it to a new technician and time together", async () => {
      appointmentRepository.findOne.mockResolvedValue(
        appointment({ technicianId: 'tech-1', scheduledAt: new Date('2026-08-25T13:00:00Z') }),
      );
      userRepository.findOne.mockResolvedValue({ id: 'tech-2', role: { name: 'TECHNICIAN_FIELD' } });
      serviceCentreRepository.findOne.mockResolvedValue(
        serviceCentre({ tuesday: { isOpen: true, maxJobsPerDay: 10 } }),
      );
      const capacityQb = buildQb({ getCount: 0 });
      const availabilityQb = buildQb({ getCount: 0 });
      appointmentRepository.createQueryBuilder
        .mockReturnValueOnce(capacityQb) // checkCapacity
        .mockReturnValueOnce(availabilityQb); // checkTechnicianAvailability

      await service.update(
        'apt-1',
        { technicianId: 'tech-2', scheduledAt: '2026-08-25T13:15:00Z' } as any,
        'user-1',
      );

      expect(capacityQb.andWhere).toHaveBeenCalledWith('apt.id != :excludeAppointmentId', {
        excludeAppointmentId: 'apt-1',
      });
      expect(availabilityQb.andWhere).toHaveBeenCalledWith('apt.id != :excludeAppointmentId', {
        excludeAppointmentId: 'apt-1',
      });
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

    // --- Technician Assignment Board drag-reassign silently not persisting (found
    // 2026-09-17 via live [DND-DEBUG] logging + a live-DB check: the drop reported success,
    // but the row's technicianId in Postgres never moved off the OLD technician) ------------
    //
    // Appointment declares BOTH `@ManyToOne() @JoinColumn({name:'technicianId'}) technician:
    // User` and a separate `@Column() technicianId: string` mapped to that same physical
    // column. findById() (which loads the `appointment` this method mutates) eager-loads
    // `technician`, so on a real TypeORM save() the still-attached, never-updated relation
    // object wins and its `.id` gets written back to the join column - silently reverting
    // the scalar `technicianId` change `update()` just made. This mock-based suite can't
    // reproduce TypeORM's own column-vs-relation precedence directly (jest's `save` mock
    // just echoes back whatever object it's called with), so the regression this test
    // actually guards is one level up: that `update()` keeps `appointment.technician` and
    // `appointment.technicianId` in lock-step whenever it changes the technician, so no
    // stale relation object is ever left on the entity handed to `save()` for TypeORM to
    // resolve inconsistently.
    it('syncs the technician relation object (not just the technicianId scalar) when reassigning to a different technician', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ technicianId: 'tech-1' }));
      const newTechnician = { id: 'tech-2', role: { name: 'TECHNICIAN_FIELD' } };
      userRepository.findOne.mockResolvedValue(newTechnician);
      appointmentRepository.createQueryBuilder.mockReturnValueOnce(buildQb({ getCount: 0 }));

      await service.update('apt-1', { technicianId: 'tech-2' } as any, 'user-1');

      const saved = appointmentRepository.save.mock.calls[0][0];
      expect(saved.technicianId).toBe('tech-2');
      expect(saved.technician).toEqual(newTechnician);
    });

    // Phase 5 (2026-09-22, per-appointment Billing Channel override) - the exact same
    // stale-eager-relation footgun as `technician` above, now for `billingChannel`; see
    // update()'s own comment on this fix.
    it('resyncs the billingChannel relation object (not just the scalar id) when billingChannelId changes', async () => {
      appointmentRepository.findOne.mockResolvedValue(
        appointment({ billingChannelId: 'bc-old', billingChannel: { id: 'bc-old', name: 'Old Channel' } }),
      );
      const newChannel = { id: 'bc-new', name: 'New Channel', defaultRate: 100 };
      masterDataService.findBillingChannelById.mockResolvedValue(newChannel);

      await service.update('apt-1', { billingChannelId: 'bc-new' } as any, 'user-1');

      const saved = appointmentRepository.save.mock.calls[0][0];
      expect(saved.billingChannelId).toBe('bc-new');
      expect(saved.billingChannel).toEqual(newChannel);
      expect(masterDataService.findBillingChannelById).toHaveBeenCalledWith('bc-new');
    });

    it('clears the billingChannel relation object (not just leaving the scalar null) when billingChannelId is explicitly unset', async () => {
      appointmentRepository.findOne.mockResolvedValue(
        appointment({ billingChannelId: 'bc-old', billingChannel: { id: 'bc-old', name: 'Old Channel' } }),
      );

      await service.update('apt-1', { billingChannelId: null } as any, 'user-1');

      const saved = appointmentRepository.save.mock.calls[0][0];
      expect(saved.billingChannelId).toBeNull();
      expect(saved.billingChannel).toBeNull();
      expect(masterDataService.findBillingChannelById).not.toHaveBeenCalled();
    });

    it('never looks up a Billing Channel when billingChannelId is absent from the update DTO entirely', async () => {
      appointmentRepository.findOne.mockResolvedValue(
        appointment({ billingChannelId: 'bc-old', billingChannel: { id: 'bc-old', name: 'Old Channel' } }),
      );

      await service.update('apt-1', { notes: 'just a note update' } as any, 'user-1');

      const saved = appointmentRepository.save.mock.calls[0][0];
      expect(saved.billingChannelId).toBe('bc-old');
      expect(saved.billingChannel).toEqual({ id: 'bc-old', name: 'Old Channel' });
      expect(masterDataService.findBillingChannelById).not.toHaveBeenCalled();
    });

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

      // Also carries the synced `technician` relation object now (see the stale-relation
      // regression test above) - this is the fixed, correct shape, not an artifact.
      expect(result).toEqual(
        appointment({ technicianId: 'tech-2', technician: { id: 'tech-2', role: { name: 'TECHNICIAN_FIELD' } } } as any),
      );
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

    // Idempotent since the Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 1,
    // decision #2): a duplicate cancel (e.g. mobile's offline queue re-firing, or a race
    // with a CCE's manual override) is a safe no-op, not an error.
    it('is a silent no-op when the appointment is already cancelled', async () => {
      const already = appointment({ status: AppointmentStatus.CANCELLED });
      appointmentRepository.findOne.mockResolvedValue(already);

      const result = await service.cancel('apt-1', 'reason', 'user-1');

      expect(result).toBe(already);
      expect(appointmentRepository.save).not.toHaveBeenCalled();
      expect(auditLogRepository.create).not.toHaveBeenCalled();
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

    // Phase 3, req. 3f: the mobile Cancellation reason dropdown's DB-backed reason -
    // set only when the caller passes one (CCE's web free-text cancel never does).
    it('sets cancellationReasonId when passed by the mobile reason-dropdown flow', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment());

      await service.cancel('apt-1', 'Customer not available', 'user-1', undefined, 'reason-id-1');

      expect(appointmentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AppointmentStatus.CANCELLED,
          cancellationReason: 'Customer not available',
          cancellationReasonId: 'reason-id-1',
        }),
      );
    });

    it('leaves cancellationReasonId unset when not passed (CCE web free-text cancel)', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment());

      await service.cancel('apt-1', 'Customer changed mind', 'user-1');

      const saved = appointmentRepository.save.mock.calls[0][0];
      expect(saved.cancellationReasonId).toBeFalsy();
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

    // Same TypeORM relation/scalar desync bug as update()'s own regression test above (see
    // its doc comment) - this is the Technician Assignment Board's drag-ASSIGN path rather
    // than drag-REASSIGN, but findById() eager-loads `technician` here too, so re-assigning
    // an appointment that already has a DIFFERENT technician hits the exact same stale-
    // relation-object risk on save().
    it('syncs the technician relation object (not just the technicianId scalar) when reassigning from a different technician', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ technicianId: 'tech-1' }));
      const newTechnician = { id: 'tech-2', role: { name: 'TECHNICIAN_FIELD' } };
      userRepository.findOne.mockResolvedValue(newTechnician);
      appointmentRepository.createQueryBuilder.mockReturnValue(buildQb({ getCount: 0 }));

      await service.assignTechnician('apt-1', 'tech-2', 'user-1');

      const saved = appointmentRepository.save.mock.calls[0][0];
      expect(saved.technicianId).toBe('tech-2');
      expect(saved.technician).toEqual(newTechnician);
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

    it('adds an id-exclusion clause to the query when excludeAppointmentId is passed', async () => {
      serviceCentreRepository.findOne.mockResolvedValue(serviceCentre({}));
      const qb = buildQb({ getCount: 0 });
      appointmentRepository.createQueryBuilder.mockReturnValue(qb);

      await service.checkCapacity('sc-1', new Date('2026-08-25T09:00:00Z'), 60, 'apt-1');

      expect(qb.andWhere).toHaveBeenCalledWith('apt.id != :excludeAppointmentId', {
        excludeAppointmentId: 'apt-1',
      });
    });

    it('does not add the id-exclusion clause when excludeAppointmentId is omitted', async () => {
      serviceCentreRepository.findOne.mockResolvedValue(serviceCentre({}));
      const qb = buildQb({ getCount: 0 });
      appointmentRepository.createQueryBuilder.mockReturnValue(qb);

      await service.checkCapacity('sc-1', new Date('2026-08-25T09:00:00Z'));

      expect(qb.andWhere).not.toHaveBeenCalledWith('apt.id != :excludeAppointmentId', expect.anything());
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

    it('confirmAppointment rejects a non-SCHEDULED, non-already-confirmed appointment (e.g. cancelled)', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ status: AppointmentStatus.CANCELLED }));
      await expect(service.confirmAppointment('apt-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    // Idempotent + manual-override (Appointment/Mobile/Job Card overhaul, 2026-09-16
    // Phase 1, decisions #1/#2): Confirm is no longer a hard precondition for the mobile
    // Onsite tap, so a late confirm on an appointment that already moved on is a safe
    // no-op rather than an error, for every status at or past CONFIRMED.
    it.each([
      AppointmentStatus.CONFIRMED,
      AppointmentStatus.TECHNICIAN_ASSIGNED,
      AppointmentStatus.ON_SITE,
      AppointmentStatus.COLLECTED_TO_WS,
      AppointmentStatus.COMPLETED,
    ])('confirmAppointment is a silent no-op when already %s', async (status) => {
      const already = appointment({ status });
      appointmentRepository.findOne.mockResolvedValue(already);

      const result = await service.confirmAppointment('apt-1', 'user-1');

      expect(result).toBe(already);
      expect(appointmentRepository.save).not.toHaveBeenCalled();
    });

    it('markOnSite moves CONFIRMED -> ON_SITE and stamps actualStartAt', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ status: AppointmentStatus.CONFIRMED }));
      await service.markOnSite('apt-1', 'user-1');
      expect(appointmentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: AppointmentStatus.ON_SITE, actualStartAt: expect.any(Date) }),
      );
    });

    // Decision #1: TECHNICIAN_ASSIGNED alone is enough for the mobile Onsite tap - no
    // CCE-confirm gate. CONFIRMED (tested above) and TECHNICIAN_ASSIGNED both succeed.
    it('markOnSite moves TECHNICIAN_ASSIGNED -> ON_SITE directly, without requiring a prior Confirm', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ status: AppointmentStatus.TECHNICIAN_ASSIGNED }));
      await service.markOnSite('apt-1', 'user-1');
      expect(appointmentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: AppointmentStatus.ON_SITE }),
      );
    });

    it('markOnSite rejects an appointment that is not confirmed/assigned', async () => {
      appointmentRepository.findOne.mockResolvedValue(appointment({ status: AppointmentStatus.SCHEDULED }));
      await expect(service.markOnSite('apt-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    // Idempotent (decision #2): a late-arriving duplicate from mobile's offline queue, or
    // a race with a CCE's manual override, must be a safe no-op once already on-site or
    // further along.
    it.each([AppointmentStatus.ON_SITE, AppointmentStatus.COLLECTED_TO_WS, AppointmentStatus.COMPLETED])(
      'markOnSite is a silent no-op when already %s',
      async (status) => {
        const already = appointment({ status });
        appointmentRepository.findOne.mockResolvedValue(already);

        const result = await service.markOnSite('apt-1', 'user-1');

        expect(result).toBe(already);
        expect(appointmentRepository.save).not.toHaveBeenCalled();
      },
    );

    // New mobile "Collection to WS" action (Appointment/Mobile/Job Card overhaul,
    // 2026-09-16 Phase 1, req. 3d/3e). Deliberately a distinct status from COMPLETED -
    // see AppointmentStatus's own doc comment (pre-mortem failure #3).
    describe('markCollectedToWorkshop', () => {
      it.each([AppointmentStatus.CONFIRMED, AppointmentStatus.TECHNICIAN_ASSIGNED, AppointmentStatus.ON_SITE])(
        'transitions %s -> COLLECTED_TO_WS',
        async (status) => {
          appointmentRepository.findOne.mockResolvedValue(appointment({ status }));

          await service.markCollectedToWorkshop('apt-1', 'user-1');

          expect(appointmentRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({ status: AppointmentStatus.COLLECTED_TO_WS }),
          );
          expect(auditLogRepository.create).toHaveBeenCalledWith(
            expect.objectContaining({ action: AuditAction.UPDATE }),
          );
        },
      );

      it('rejects an appointment that is not confirmed/assigned/on-site (e.g. still just SCHEDULED)', async () => {
        appointmentRepository.findOne.mockResolvedValue(appointment({ status: AppointmentStatus.SCHEDULED }));
        await expect(service.markCollectedToWorkshop('apt-1', 'user-1')).rejects.toThrow(BadRequestException);
      });

      // Idempotent, same reasoning as markOnSite/cancel above - a duplicate mobile
      // request or a race with the workshop's own "Mark Received" flow must be a
      // safe no-op, never an error.
      it.each([AppointmentStatus.COLLECTED_TO_WS, AppointmentStatus.COMPLETED])(
        'is a silent no-op when already %s',
        async (status) => {
          const already = appointment({ status });
          appointmentRepository.findOne.mockResolvedValue(already);

          const result = await service.markCollectedToWorkshop('apt-1', 'user-1');

          expect(result).toBe(already);
          expect(appointmentRepository.save).not.toHaveBeenCalled();
        },
      );
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

    // Job Type split (2026-09-22) Phase 7 - mobile's on-site "Correct Job Type" action.
    describe('correctJobType', () => {
      it('corrects the Job Type and logs the old/new value on the audit trail', async () => {
        appointmentRepository.findOne.mockResolvedValue(
          appointment({ status: AppointmentStatus.ON_SITE, jobType: JobType.REPAIR }),
        );

        await service.correctJobType('apt-1', JobType.INSTALLATION, 'user-1');

        expect(appointmentRepository.save).toHaveBeenCalledWith(
          expect.objectContaining({ jobType: JobType.INSTALLATION }),
        );
        expect(auditLogRepository.create).toHaveBeenCalledWith(
          expect.objectContaining({
            action: AuditAction.JOB_TYPE_CORRECTED,
            entityType: 'Appointment',
            entityId: 'apt-1',
            oldValues: { jobType: JobType.REPAIR },
            newValues: { jobType: JobType.INSTALLATION },
          }),
        );
      });

      it.each([AppointmentStatus.COLLECTED_TO_WS, AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED])(
        'rejects correcting the Job Type once the appointment is %s',
        async (status) => {
          appointmentRepository.findOne.mockResolvedValue(appointment({ status, jobType: JobType.REPAIR }));

          await expect(service.correctJobType('apt-1', JobType.INSTALLATION, 'user-1')).rejects.toThrow(
            BadRequestException,
          );
          expect(appointmentRepository.save).not.toHaveBeenCalled();
        },
      );

      it.each([AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.TECHNICIAN_ASSIGNED])(
        'allows correcting the Job Type while %s (any status before Collected-to-WS/Completed/Cancelled)',
        async (status) => {
          appointmentRepository.findOne.mockResolvedValue(appointment({ status, jobType: JobType.REPAIR }));

          await service.correctJobType('apt-1', JobType.DELIVERY_INSTALLATION, 'user-1');

          expect(appointmentRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({ jobType: JobType.DELIVERY_INSTALLATION }),
          );
        },
      );
    });

    // Job Type split (2026-09-22) Phase 8 - Start Work / Pause / Resume / Activity
    // Finished flow.
    describe('activity flow', () => {
      const buildActivityQb = (getOne: any = null) => ({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(getOne),
      });

      describe('getActivity', () => {
        it('returns NOT_STARTED when no activity row exists yet', async () => {
          appointmentRepository.findOne.mockResolvedValue(appointment());
          appointmentActivityRepository.findOne.mockResolvedValue(null);

          const result = await service.getActivity('apt-1');

          expect(result).toEqual({ status: 'NOT_STARTED', startedAt: null, finishedAt: null, pauses: [] });
        });
      });

      describe('startActivity', () => {
        it('rejects a REPAIR appointment', async () => {
          appointmentRepository.findOne.mockResolvedValue(
            appointment({ status: AppointmentStatus.CONFIRMED, jobType: JobType.REPAIR }),
          );

          await expect(service.startActivity('apt-1', 'user-1')).rejects.toThrow(BadRequestException);
          expect(appointmentActivityRepository.save).not.toHaveBeenCalled();
        });

        it.each([AppointmentStatus.COLLECTED_TO_WS, AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED])(
          'rejects starting once the appointment is %s',
          async (status) => {
            appointmentRepository.findOne.mockResolvedValue(appointment({ status, jobType: JobType.INSTALLATION }));

            await expect(service.startActivity('apt-1', 'user-1')).rejects.toThrow(BadRequestException);
          },
        );

        it('starts a new activity, audit-logs it, and blocks nothing when the technician has no other open activity', async () => {
          appointmentRepository.findOne.mockResolvedValue(
            appointment({ status: AppointmentStatus.CONFIRMED, jobType: JobType.INSTALLATION, technicianId: 'tech-1' }),
          );
          appointmentActivityRepository.findOne
            .mockResolvedValueOnce(null) // the "does one already exist" check inside startActivity
            .mockResolvedValueOnce({
              id: 'activity-1',
              appointmentId: 'apt-1',
              startedAt: new Date('2026-09-23T08:00:00Z'),
              finishedAt: null,
            }); // getActivity()'s own lookup once startActivity has saved the new row
          appointmentActivityRepository.createQueryBuilder.mockReturnValue(buildActivityQb(null));

          const result = await service.startActivity('apt-1', 'user-1');

          expect(appointmentActivityRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({ appointmentId: 'apt-1', startedByUserId: 'user-1' }),
          );
          expect(auditLogRepository.create).toHaveBeenCalledWith(
            expect.objectContaining({ action: AuditAction.ACTIVITY_STARTED, entityType: 'AppointmentActivity', entityId: 'apt-1' }),
          );
          expect(result.status).toBe('IN_PROGRESS');
        });

        it('is idempotent when the activity is already started (not finished)', async () => {
          appointmentRepository.findOne.mockResolvedValue(
            appointment({ status: AppointmentStatus.CONFIRMED, jobType: JobType.INSTALLATION }),
          );
          appointmentActivityRepository.findOne.mockResolvedValue({
            id: 'activity-1',
            appointmentId: 'apt-1',
            startedAt: new Date('2026-09-23T08:00:00Z'),
            finishedAt: null,
          });

          await service.startActivity('apt-1', 'user-1');

          expect(appointmentActivityRepository.save).not.toHaveBeenCalled();
        });

        it('rejects restarting an activity that was already marked finished', async () => {
          appointmentRepository.findOne.mockResolvedValue(
            appointment({ status: AppointmentStatus.CONFIRMED, jobType: JobType.INSTALLATION }),
          );
          appointmentActivityRepository.findOne.mockResolvedValue({
            id: 'activity-1',
            appointmentId: 'apt-1',
            finishedAt: new Date('2026-09-23T12:00:00Z'),
          });

          await expect(service.startActivity('apt-1', 'user-1')).rejects.toThrow(BadRequestException);
        });

        it('blocks starting a new activity while this technician already has one open on a different appointment', async () => {
          appointmentRepository.findOne.mockImplementation(({ where }: any) => {
            if (where.id === 'apt-1') {
              return Promise.resolve(
                appointment({ id: 'apt-1', status: AppointmentStatus.CONFIRMED, jobType: JobType.INSTALLATION, technicianId: 'tech-1' }),
              );
            }
            return Promise.resolve(
              appointment({ id: 'apt-2', appointmentNumber: 'APT-20260923-0002', status: AppointmentStatus.ON_SITE, technicianId: 'tech-1' }),
            );
          });
          appointmentActivityRepository.findOne.mockResolvedValue(null);
          appointmentActivityRepository.createQueryBuilder.mockReturnValue(buildActivityQb({ appointmentId: 'apt-2' }));

          await expect(service.startActivity('apt-1', 'user-1')).rejects.toThrow(ConflictException);
          expect(appointmentActivityRepository.save).not.toHaveBeenCalled();
        });
      });

      describe('pauseActivity', () => {
        it('rejects pausing before work has been started', async () => {
          appointmentActivityRepository.findOne.mockResolvedValue(null);

          await expect(service.pauseActivity('apt-1', { reason: 'BREAK' } as any, 'user-1')).rejects.toThrow(
            BadRequestException,
          );
        });

        it('opens a pause row and audit-logs it', async () => {
          appointmentRepository.findOne.mockResolvedValue(appointment());
          appointmentActivityRepository.findOne.mockResolvedValue({ id: 'activity-1', appointmentId: 'apt-1', finishedAt: null });
          appointmentActivityPauseRepository.findOne.mockResolvedValue(null);

          await service.pauseActivity('apt-1', { reason: 'CUSTOMER_UNAVAILABLE', notes: 'carry to tomorrow' } as any, 'user-1');

          expect(appointmentActivityPauseRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({
              appointmentActivityId: 'activity-1',
              reason: 'CUSTOMER_UNAVAILABLE',
              notes: 'carry to tomorrow',
              pausedByUserId: 'user-1',
            }),
          );
          expect(auditLogRepository.create).toHaveBeenCalledWith(
            expect.objectContaining({ action: AuditAction.ACTIVITY_PAUSED, entityType: 'AppointmentActivity', entityId: 'apt-1' }),
          );
        });

        it('is idempotent when a pause is already open', async () => {
          appointmentRepository.findOne.mockResolvedValue(appointment());
          appointmentActivityRepository.findOne.mockResolvedValue({ id: 'activity-1', appointmentId: 'apt-1', finishedAt: null });
          appointmentActivityPauseRepository.findOne.mockResolvedValue({ id: 'pause-1', resumedAt: null });

          await service.pauseActivity('apt-1', { reason: 'BREAK' } as any, 'user-1');

          expect(appointmentActivityPauseRepository.save).not.toHaveBeenCalled();
        });
      });

      describe('resumeActivity', () => {
        it('resumes an open pause and audit-logs it', async () => {
          appointmentRepository.findOne.mockResolvedValue(appointment());
          appointmentActivityRepository.findOne.mockResolvedValue({ id: 'activity-1', appointmentId: 'apt-1', finishedAt: null });
          appointmentActivityPauseRepository.findOne.mockResolvedValue({ id: 'pause-1', resumedAt: null });

          await service.resumeActivity('apt-1', 'user-1');

          expect(appointmentActivityPauseRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'pause-1', resumedByUserId: 'user-1', resumedAt: expect.any(Date) }),
          );
          expect(auditLogRepository.create).toHaveBeenCalledWith(
            expect.objectContaining({ action: AuditAction.ACTIVITY_RESUMED, entityType: 'AppointmentActivity', entityId: 'apt-1' }),
          );
        });

        it('is idempotent when there is no open pause to resume', async () => {
          appointmentRepository.findOne.mockResolvedValue(appointment());
          appointmentActivityRepository.findOne.mockResolvedValue({ id: 'activity-1', appointmentId: 'apt-1', finishedAt: null });
          appointmentActivityPauseRepository.findOne.mockResolvedValue(null);

          await service.resumeActivity('apt-1', 'user-1');

          expect(appointmentActivityPauseRepository.save).not.toHaveBeenCalled();
        });
      });

      describe('finishActivity', () => {
        it('rejects finishing before work has been started', async () => {
          appointmentActivityRepository.findOne.mockResolvedValue(null);

          await expect(service.finishActivity('apt-1', 'user-1')).rejects.toThrow(BadRequestException);
        });

        it('rejects finishing while still paused', async () => {
          appointmentActivityRepository.findOne.mockResolvedValue({ id: 'activity-1', appointmentId: 'apt-1', finishedAt: null });
          appointmentActivityPauseRepository.findOne.mockResolvedValue({ id: 'pause-1', resumedAt: null });

          await expect(service.finishActivity('apt-1', 'user-1')).rejects.toThrow(BadRequestException);
        });

        it('marks the activity finished and audit-logs it', async () => {
          appointmentRepository.findOne.mockResolvedValue(appointment());
          const activity: any = { id: 'activity-1', appointmentId: 'apt-1', finishedAt: null };
          appointmentActivityRepository.findOne.mockResolvedValue(activity);
          appointmentActivityPauseRepository.findOne.mockResolvedValue(null);

          await service.finishActivity('apt-1', 'user-1');

          expect(appointmentActivityRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({ finishedAt: expect.any(Date), finishedByUserId: 'user-1' }),
          );
          expect(auditLogRepository.create).toHaveBeenCalledWith(
            expect.objectContaining({ action: AuditAction.ACTIVITY_FINISHED, entityType: 'AppointmentActivity', entityId: 'apt-1' }),
          );
        });

        it('is idempotent once already finished', async () => {
          appointmentRepository.findOne.mockResolvedValue(appointment());
          appointmentActivityRepository.findOne.mockResolvedValue({
            id: 'activity-1',
            appointmentId: 'apt-1',
            finishedAt: new Date('2026-09-23T12:00:00Z'),
          });

          await service.finishActivity('apt-1', 'user-1');

          expect(appointmentActivityRepository.save).not.toHaveBeenCalled();
        });
      });
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

  describe('getTechnicianScheduleMonthCounts (mobile calendar view, 2026-09-16)', () => {
    it('groups appointments by calendar day and counts them', async () => {
      appointmentRepository.find.mockResolvedValue([
        appointment({ scheduledAt: new Date('2026-09-16T09:00:00Z') }),
        appointment({ scheduledAt: new Date('2026-09-16T14:00:00Z') }),
        appointment({ scheduledAt: new Date('2026-09-03T10:00:00Z') }),
      ]);

      const result = await service.getTechnicianScheduleMonthCounts('tech-1', 2026, 9);

      expect(result).toEqual([
        { date: '2026-09-03', count: 1 },
        { date: '2026-09-16', count: 2 },
      ]);
    });

    it('queries with the given technicianId and the active-status filter', async () => {
      appointmentRepository.find.mockResolvedValue([]);

      await service.getTechnicianScheduleMonthCounts('tech-1', 2026, 2); // Feb 2026 - 28 days, not a leap year

      expect(appointmentRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ technicianId: 'tech-1' }),
          select: { scheduledAt: true },
        }),
      );
    });

    it('returns an empty array when nothing is scheduled that month', async () => {
      appointmentRepository.find.mockResolvedValue([]);

      const result = await service.getTechnicianScheduleMonthCounts('tech-1', 2026, 9);

      expect(result).toEqual([]);
    });

    it('returns results sorted by date ascending regardless of appointment order', async () => {
      appointmentRepository.find.mockResolvedValue([
        appointment({ scheduledAt: new Date('2026-09-20T09:00:00Z') }),
        appointment({ scheduledAt: new Date('2026-09-01T09:00:00Z') }),
        appointment({ scheduledAt: new Date('2026-09-10T09:00:00Z') }),
      ]);

      const result = await service.getTechnicianScheduleMonthCounts('tech-1', 2026, 9);

      expect(result.map((r) => r.date)).toEqual(['2026-09-01', '2026-09-10', '2026-09-20']);
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
    // Live-tested bug fix (2026-09-17, 3rd round on this widget): "today"'s buckets used to
    // filter by `scheduledAt` falling inside today's calendar window, so an appointment
    // scheduled for a FUTURE day that gets completed today (real example: APT-20260917-0001,
    // scheduledAt tomorrow 15:15, walked to COMPLETED the same day it was created) never
    // showed up in the Completed tile at all. Confirmed with the user this should instead be
    // a live, unfiltered snapshot of current status counts (their explicit choice over
    // keeping a "due today" + new completedAt/cancelledAt timestamp approach) - every bucket
    // now counts by current status only, with no scheduledAt window.
    it('counts every appointment currently in each status, regardless of its scheduledAt date (no date window any more)', async () => {
      appointmentRepository.find
        .mockResolvedValueOnce([
          appointment({ status: AppointmentStatus.SCHEDULED, scheduledAt: new Date('2026-09-10T08:00:00Z') }),
          // The exact regression case: scheduled for a future day, already Completed.
          appointment({ status: AppointmentStatus.COMPLETED, scheduledAt: new Date('2026-09-18T15:15:00Z') }),
          appointment({ status: AppointmentStatus.CANCELLED, scheduledAt: new Date('2099-01-01T00:00:00Z') }),
        ])
        .mockResolvedValueOnce([]);

      const result = await service.getDashboardStats('sc-1');

      expect(result.today).toEqual({
        scheduled: 1,
        confirmed: 0,
        onSite: 0,
        completed: 1,
        cancelled: 1,
        collectedToWs: 0,
        markedReceived: 0,
        pendingJobCreation: 0,
      });
    });

    it('buckets current status counts and week appointments by status', async () => {
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

      expect(result.today).toEqual({
        scheduled: 1,
        confirmed: 0,
        onSite: 0,
        completed: 1,
        cancelled: 0,
        collectedToWs: 0,
        markedReceived: 0,
        pendingJobCreation: 0,
      });
      expect(result.week.total).toBe(2);
      expect(result.week.byStatus).toEqual({
        [AppointmentStatus.SCHEDULED]: 1,
        [AppointmentStatus.CANCELLED]: 1,
      });
    });

    // req.txt Issue A/C - the three COLLECTED_TO_WS sub-stages must show up in the widget's
    // count too, split the same way the list's Status column splits them.
    it('splits currently-COLLECTED_TO_WS appointments into collectedToWs / markedReceived / pendingJobCreation', async () => {
      appointmentRepository.find
        .mockResolvedValueOnce([
          appointment({ id: 'apt-1', status: AppointmentStatus.COLLECTED_TO_WS }), // no intake yet
          appointment({ id: 'apt-2', status: AppointmentStatus.COLLECTED_TO_WS }), // received, no S/N yet
          appointment({ id: 'apt-3', status: AppointmentStatus.COLLECTED_TO_WS }), // received + S/N captured
        ])
        .mockResolvedValueOnce([]);
      workshopIntakeRepository.find.mockResolvedValue([
        { appointmentId: 'apt-2', serialNumberCapturedAt: null },
        { appointmentId: 'apt-3', serialNumberCapturedAt: new Date('2026-09-17T10:00:00Z') },
      ]);

      const result = await service.getDashboardStats('sc-1');

      expect(result.today.collectedToWs).toBe(1);
      expect(result.today.markedReceived).toBe(1);
      expect(result.today.pendingJobCreation).toBe(1);
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
