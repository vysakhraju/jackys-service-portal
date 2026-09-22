import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual, MoreThanOrEqual, In } from 'typeorm';
import { Appointment, AppointmentStatus, AppointmentType, AppointmentChannel, CustomerType } from './entities/appointment.entity';
import { resolveGoogleMapsLink, GoogleMapsLinkError, LatLng } from './google-maps-link.util';
import { ServiceCentre } from '../master-data/entities/service-centre.entity';
import { User, UserStatus } from '../auth/entities/user.entity';
import { RoleName } from '../auth/entities/role.entity';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AuditLog } from '../auth/entities/audit-log.entity';
import { AuditAction } from '../auth/entities/audit-log.entity';
// Entity-only import, not JobCardsModule - see AppointmentsModule's doc comment on why
// (JobCardsModule already imports this module, so the reverse would be a cycle).
import { JobCard } from '../job-cards/entities/job-card.entity';
// Same entity-only-repo pattern as JobCard above, same reason: WorkshopIntakeModule already
// imports AppointmentsModule (to read the appointment being received against), so importing
// WorkshopIntakeModule back here would be a cycle. Needed below purely to tell a bare
// COLLECTED_TO_WS appointment apart from one that's actually been received/intake-processed
// at the workshop - see attachEffectiveStatuses()'s doc comment.
import { WorkshopIntake } from '../workshop-intake/entities/workshop-intake.entity';
import { InventoryService } from '../inventory/inventory.service';
import { buildSchedulingGrid, SchedulingGridResult } from './appointment-scheduling-grid.util';
// Master-Data/New-Appointment billing modification Phase 2 (2026-09-22): reads
// AppointmentFieldConfig rows to decide which optional CreateAppointmentDto fields are
// currently admin-marked mandatory. AppointmentsModule already imports MasterDataModule
// (for other lookups), which exports MasterDataService, so no module change needed here.
import { MasterDataService } from '../master-data/master-data.service';

// Appointment Scheduling page fixes (2026-09-17, user-reported req.txt Issues A-D) -
// COLLECTED_TO_WS is one raw AppointmentStatus value covering three real operational
// stages the CCE/workshop actually care about (a unit in transit to the workshop vs. one
// that's physically arrived vs. one that's fully intake-processed and just waiting on Job
// Card creation) - see WorkshopIntake's own doc comment for why that's a separate entity
// rather than a richer AppointmentStatus enum. These two synthetic values are never stored
// anywhere; they only exist as ?status= filter values and as the `effectiveStatus` field
// attached to list/dashboard-stats responses by attachEffectiveStatuses() below.
export type EffectiveAppointmentStatus = AppointmentStatus | 'MARKED_RECEIVED' | 'PENDING_JOB_CREATION';

interface CapacityCheckResult {
  available: boolean;
  currentBookings: number;
  maxCapacity: number;
  message?: string;
}

// Technician Assignment Board reassign-until-visit-start rule (2026-09-09, a the-fool
// pre-mortem on this exact rule): a CCE can freely drag-reassign an appointment's technician
// and/or time right up until the field technician actually starts the visit
// (AppointmentStatus.ON_SITE, set by markOnSite()) - after that it's no longer just a plan,
// there's a technician physically at the customer's door. The OTHER half of the user's rule
// ("...or once a Job Card is created from it") doesn't need its own check here: creating a
// Job Card already auto-completes the appointment (see completeFromJobCardCreation(), called
// from JobCardsService.createFromVisit()), and COMPLETED isn't reassignable either since it's
// not in this set - one rule covers both cutoffs.
const REASSIGNABLE_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.TECHNICIAN_ASSIGNED,
];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// ServiceCentre.assignedTechnicianIds is a jsonb string[] with no per-item format validation
// at the DTO level (only @IsArray()) - so a service centre saved before that gap is closed, or
// edited by hand, can already contain a non-UUID entry (a stray space, a pasted name, a typo).
// Handing a malformed value straight to TypeORM's In() on a uuid column makes Postgres throw
// "invalid input syntax for type uuid", which surfaces to the New Appointment scheduling grid
// as a bare 500 with no useful message. Filtering to well-formed UUIDs here means one bad
// entry just gets silently skipped instead of taking down the whole grid for every technician
// at that service centre.
const UUID_V4_ISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Sunday-indexed to match Date.getUTCDay() directly (0 = Sunday) - used by getSchedulingGrid()
// below to look up ServiceCentre.schedule's per-weekday entry for a bare 'YYYY-MM-DD' date
// without going through toLocaleDateString() (locale/timezone-dependent, and this call site
// only has a date, not a real instant, to format in the first place).
const WEEKDAY_KEYS_BY_UTC_DAY = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Monday-first order, purely for the scheduling grid's "Mon-Sat"-style roster badge - see
// appointment-scheduling-grid.util.ts's own doc comment.
const WEEKDAY_BADGE_ORDER: { key: string; abbr: string }[] = [
  { key: 'monday', abbr: 'Mon' },
  { key: 'tuesday', abbr: 'Tue' },
  { key: 'wednesday', abbr: 'Wed' },
  { key: 'thursday', abbr: 'Thu' },
  { key: 'friday', abbr: 'Fri' },
  { key: 'saturday', abbr: 'Sat' },
  { key: 'sunday', abbr: 'Sun' },
];

// Same active-status set checkTechnicianAvailability()/getTechnicianSchedule() already use -
// these are the appointments that actually occupy a technician's day for the scheduling grid.
const ACTIVE_APPOINTMENT_STATUSES_FOR_GRID: readonly AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.TECHNICIAN_ASSIGNED,
  AppointmentStatus.ON_SITE,
];

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectRepository(Appointment)
    private appointmentRepository: Repository<Appointment>,
    @InjectRepository(ServiceCentre)
    private serviceCentreRepository: Repository<ServiceCentre>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
    @InjectRepository(JobCard)
    private jobCardRepository: Repository<JobCard>,
    @InjectRepository(WorkshopIntake)
    private workshopIntakeRepository: Repository<WorkshopIntake>,
    private inventoryService: InventoryService,
    private masterDataService: MasterDataService,
  ) {}

  // Appointment Scheduling page fixes (2026-09-17, req.txt Issues B/C) - resolves each
  // COLLECTED_TO_WS appointment to which of the three real workshop stages it's actually
  // in, by checking whether it has a WorkshopIntake row yet and, if so, whether the serial
  // number step on it is done:
  //   no WorkshopIntake row at all       -> 'COLLECTED_TO_WS' (in transit / not yet arrived)
  //   row exists, serialNumberCapturedAt is null -> 'MARKED_RECEIVED' (arrived, S/N not captured)
  //   row exists, serialNumberCapturedAt is set  -> 'PENDING_JOB_CREATION' (intake done, just needs a Job Card)
  // Every other AppointmentStatus passes through unchanged. A single batched
  // find({ appointmentId: In(...) }) covers the whole list, not one query per row.
  private async attachEffectiveStatuses<T extends Appointment>(
    appointments: T[],
  ): Promise<(T & { effectiveStatus: EffectiveAppointmentStatus })[]> {
    const collectedIds = appointments
      .filter((a) => a.status === AppointmentStatus.COLLECTED_TO_WS)
      .map((a) => a.id);

    const intakeByAppointmentId = new Map<string, WorkshopIntake>();
    if (collectedIds.length) {
      const intakes = await this.workshopIntakeRepository.find({
        where: { appointmentId: In(collectedIds) },
      });
      for (const intake of intakes) {
        intakeByAppointmentId.set(intake.appointmentId, intake);
      }
    }

    return appointments.map((a) => {
      let effectiveStatus: EffectiveAppointmentStatus = a.status;
      if (a.status === AppointmentStatus.COLLECTED_TO_WS) {
        const intake = intakeByAppointmentId.get(a.id);
        if (!intake) {
          effectiveStatus = AppointmentStatus.COLLECTED_TO_WS;
        } else if (!intake.serialNumberCapturedAt) {
          effectiveStatus = 'MARKED_RECEIVED';
        } else {
          effectiveStatus = 'PENDING_JOB_CREATION';
        }
      }
      return { ...a, effectiveStatus };
    });
  }

  // Master-Data/New-Appointment billing modification Phase 2 (2026-09-22), req. 1: enforces
  // the Super-Admin-editable AppointmentFieldConfig table against a create payload. Only
  // covers fields that ARE optional in CreateAppointmentDto today (`type`/`customerType`
  // stay permanently decorator-enforced, per the locked Phase 1 decision - this method
  // never touches those two even if a stray config row existed for them). "Missing" means
  // undefined/null/empty-string - good enough for every field type on this form today
  // (strings, dates-as-strings, UUIDs); a 0/false value never appears on any mandatory-
  // eligible field, so there's no numeric-zero/boolean-false false-positive to guard here.
  private async validateMandatoryFields(dto: CreateAppointmentDto): Promise<void> {
    const configs = await this.masterDataService.findAllAppointmentFieldConfigs();
    const missingLabels: string[] = [];
    for (const config of configs) {
      if (!config.isMandatory) continue;
      const value = (dto as unknown as Record<string, unknown>)[config.fieldKey];
      const isMissing =
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '');
      if (isMissing) {
        missingLabels.push(config.fieldLabel);
      }
    }
    if (missingLabels.length > 0) {
      throw new BadRequestException(
        `Missing mandatory field(s): ${missingLabels.join(', ')}`,
      );
    }
  }

  private async generateAppointmentNumber(): Promise<string> {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `APT-${dateStr}-`;

    const lastAppointment = await this.appointmentRepository
      .createQueryBuilder('apt')
      .where('apt.appointmentNumber LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('apt.appointmentNumber', 'DESC')
      .getOne();

    let sequence = 1;
    if (lastAppointment) {
      const lastSeq = parseInt(lastAppointment.appointmentNumber.replace(prefix, ''), 10);
      sequence = lastSeq + 1;
    }

    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }

  async create(
    createAppointmentDto: CreateAppointmentDto,
    userId: string,
    req?: any,
  ): Promise<Appointment> {
    // Master-Data/New-Appointment billing modification Phase 2, req. 1 - dynamic
    // mandatory-field check first, before any DB-state lookups, since a missing field is
    // a pure client-input error (400), not a business-rule conflict.
    await this.validateMandatoryFields(createAppointmentDto);

    // Validate service centre exists and is active
    const serviceCentre = await this.serviceCentreRepository.findOne({
      where: { id: createAppointmentDto.serviceCentreId, isActive: true },
    });
    if (!serviceCentre) {
      throw new NotFoundException('Service centre not found or inactive');
    }

    // Check capacity
    const capacityCheck = await this.checkCapacity(
      createAppointmentDto.serviceCentreId,
      new Date(createAppointmentDto.scheduledAt),
      createAppointmentDto.estimatedDurationMinutes || 60,
    );

    if (!capacityCheck.available) {
      throw new ConflictException(capacityCheck.message || 'Service centre at capacity for this time slot');
    }

    // Validate technician if provided
    if (createAppointmentDto.technicianId) {
      const technician = await this.userRepository.findOne({
        where: { id: createAppointmentDto.technicianId },
        relations: { role: true },
      });
      if (!technician) {
        throw new NotFoundException('Technician not found');
      }
      if (!['TECHNICIAN_FIELD', 'TECHNICIAN_WORKSHOP'].includes(technician.role.name)) {
        throw new BadRequestException('Assigned user is not a technician');
      }
      // Check technician availability
      const techAvailable = await this.checkTechnicianAvailability(
        createAppointmentDto.technicianId,
        new Date(createAppointmentDto.scheduledAt),
        createAppointmentDto.estimatedDurationMinutes || 60,
      );
      if (!techAvailable) {
        throw new ConflictException('Technician not available at this time');
      }
    }

    // Generate appointment number
    const appointmentNumber = await this.generateAppointmentNumber();

    // Create appointment
    const appointment = this.appointmentRepository.create({
      ...createAppointmentDto,
      appointmentNumber,
      scheduledAt: new Date(createAppointmentDto.scheduledAt),
      createdById: userId,
      status: AppointmentStatus.SCHEDULED,
    });

    const saved = await this.appointmentRepository.save(appointment);

    // Audit log
    await this.logAudit(
      userId,
      AuditAction.CREATE,
      'Appointment',
      saved.id,
      null,
      { appointmentNumber: saved.appointmentNumber, ...createAppointmentDto },
      req,
    );

    return this.findById(saved.id);
  }

  async findAll(filters?: {
    serviceCentreId?: string;
    technicianId?: string;
    // Appointment Scheduling page fixes (req.txt Issue B) - accepts the two synthetic
    // sub-statuses below in addition to a real AppointmentStatus; see the status filter
    // block below and attachEffectiveStatuses()'s doc comment for what they mean.
    status?: EffectiveAppointmentStatus;
    type?: AppointmentType;
    channel?: AppointmentChannel;
    dateFrom?: Date;
    dateTo?: Date;
    // Technician Assignment Board (2026-09-09): the "unassigned" pool for a given day -
    // mutually exclusive with technicianId above (a specific id and "has none" can't both
    // apply), so a caller passing both gets technicianId's narrower behaviour; TechnicianScheduleService
    // never does.
    unassigned?: boolean;
    page?: number;
    limit?: number;
    // #218 pre-mortem follow-up (2026-09-14): free-text search across appointmentNumber/
    // customerName/customerPhone, for JobCardsPage's "find the appointment" picker - see the
    // ILIKE-escaping comment below for why the wildcard characters are escaped. Also matches
    // serialNumber since 2026-09-16 Phase 2 (the New Appointment popup's customer lookup).
    q?: string;
  }): Promise<{
    data: (Appointment & { effectiveStatus: EffectiveAppointmentStatus })[];
    total: number;
    page: number;
    limit: number;
  }> {
    const query = this.appointmentRepository
      .createQueryBuilder('apt')
      .leftJoinAndSelect('apt.serviceCentre', 'sc')
      .leftJoinAndSelect('apt.technician', 'tech')
      .leftJoinAndSelect('apt.createdBy', 'createdBy')
      // Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 2): apt.city/apt.applianceModel
      // are declared `eager: true` on the entity, but TypeORM's eager loading only applies to
      // repository find()/findOne() calls, NOT QueryBuilder - a real gap this findAll() (which
      // has always used createQueryBuilder for its filters) would otherwise hit silently,
      // coming back with `city`/`applianceModel` always undefined even though `cityId`/
      // `applianceModelId` are plain columns and would still be present. Explicit join, same
      // as every other relation this list already needs.
      .leftJoinAndSelect('apt.city', 'city')
      .leftJoinAndSelect('apt.applianceModel', 'am')
      // Partial select (id + jobCardNumber only, not the full Job Card) so the schedule
      // list can know whether an appointment is already "fulfilled" - see cancel()'s
      // guard - without hydrating the whole nested Job Card into every list row.
      .leftJoin('apt.jobCard', 'jc')
      .addSelect(['jc.id', 'jc.jobCardNumber'])
      .orderBy('apt.scheduledAt', 'ASC')
      .addOrderBy('apt.createdAt', 'DESC');

    if (filters?.serviceCentreId) {
      query.andWhere('apt.serviceCentreId = :serviceCentreId', {
        serviceCentreId: filters.serviceCentreId,
      });
    }

    if (filters?.technicianId) {
      query.andWhere('apt.technicianId = :technicianId', {
        technicianId: filters.technicianId,
      });
    } else if (filters?.unassigned) {
      query.andWhere('apt.technicianId IS NULL');
    }

    // Appointment Scheduling page fixes (req.txt Issue B) - 'MARKED_RECEIVED' and
    // 'PENDING_JOB_CREATION' aren't real AppointmentStatus values (see
    // attachEffectiveStatuses()'s doc comment); both narrow to the underlying
    // COLLECTED_TO_WS rows and then split on whether that row's WorkshopIntake has had its
    // serial number captured yet. A plain EXISTS subquery keeps LIMIT/OFFSET pagination and
    // the `total` count correct - filtering in JS after the page was already fetched would
    // silently give a wrong `total` and a short page.
    if (
      filters?.status === 'MARKED_RECEIVED' ||
      filters?.status === 'PENDING_JOB_CREATION' ||
      filters?.status === AppointmentStatus.COLLECTED_TO_WS
    ) {
      query.andWhere('apt.status = :collectedStatus', { collectedStatus: AppointmentStatus.COLLECTED_TO_WS });
      query.andWhere(
        filters.status === 'MARKED_RECEIVED'
          ? 'EXISTS (SELECT 1 FROM workshop_intakes wi WHERE wi."appointmentId" = apt.id AND wi."serialNumberCapturedAt" IS NULL)'
          : filters.status === 'PENDING_JOB_CREATION'
            ? 'EXISTS (SELECT 1 FROM workshop_intakes wi WHERE wi."appointmentId" = apt.id AND wi."serialNumberCapturedAt" IS NOT NULL)'
            // Plain COLLECTED_TO_WS (the raw status, e.g. from the glance tile click) must
            // stay mutually exclusive with the two sub-statuses above - otherwise clicking
            // "Collected to WS" showed Pending Job Creation/Marked Received rows mixed in,
            // since the raw column is identical across all three sub-stages (bug reported
            // 2026-09-17 against the fix just above).
            : 'NOT EXISTS (SELECT 1 FROM workshop_intakes wi WHERE wi."appointmentId" = apt.id)',
      );
    } else if (filters?.status) {
      query.andWhere('apt.status = :status', { status: filters.status });
    }

    if (filters?.type) {
      query.andWhere('apt.type = :type', { type: filters.type });
    }

    if (filters?.channel) {
      query.andWhere('apt.channel = :channel', { channel: filters.channel });
    }

    if (filters?.dateFrom) {
      query.andWhere('apt.scheduledAt >= :dateFrom', { dateFrom: filters.dateFrom });
    }

    if (filters?.dateTo) {
      query.andWhere('apt.scheduledAt <= :dateTo', { dateTo: filters.dateTo });
    }

    const trimmedQ = filters?.q?.trim();
    if (trimmedQ) {
      // Same ILIKE-with-escaping pattern as JobCardJourneyService.search(): TypeORM's :like
      // binding already parameterizes the value (no SQL injection risk), but a literal '%',
      // '_' or '\' the user typed - e.g. in a phone number - would otherwise be interpreted
      // as an ILIKE wildcard/escape character instead of a literal one, silently widening
      // the match. Escaping them plus the explicit ESCAPE clause keeps the search literal.
      const escaped = trimmedQ.replace(/[\\%_]/g, (c) => `\\${c}`);
      const like = `%${escaped}%`;
      // Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 2): also matches
      // serialNumber, so the New Appointment popup's customer-lookup search (req. 1b -
      // "name / phone / serial number") can reuse this one endpoint instead of a
      // purpose-built lookup route. Same escaping, same ESCAPE clause.
      query.andWhere(
        "(apt.appointmentNumber ILIKE :q ESCAPE '\\' OR apt.customerName ILIKE :q ESCAPE '\\' OR apt.customerPhone ILIKE :q ESCAPE '\\' OR apt.serialNumber ILIKE :q ESCAPE '\\')",
        { q: like },
      );
    }

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    query.skip((page - 1) * limit).take(limit);

    const [data, total] = await query.getManyAndCount();

    // req.txt Issue C/D - the Status column and the "Today at a Glance" click-to-filter
    // both need to show the real sub-stage for a COLLECTED_TO_WS row, not just the raw
    // status. See attachEffectiveStatuses()'s doc comment.
    const dataWithEffectiveStatus = await this.attachEffectiveStatuses(data);

    return { data: dataWithEffectiveStatus, total, page, limit };
  }

  async findById(id: string): Promise<Appointment> {
    const appointment = await this.appointmentRepository.findOne({
      where: { id },
      relations: { serviceCentre: true, technician: true, createdBy: true },
    });
    if (!appointment) {
      throw new NotFoundException(`Appointment ${id} not found`);
    }
    return appointment;
  }

  async findByAppointmentNumber(appointmentNumber: string): Promise<Appointment> {
    const appointment = await this.appointmentRepository.findOne({
      where: { appointmentNumber },
      relations: { serviceCentre: true, technician: true, createdBy: true },
    });
    if (!appointment) {
      throw new NotFoundException(`Appointment ${appointmentNumber} not found`);
    }
    return appointment;
  }

  async update(
    id: string,
    updateAppointmentDto: UpdateAppointmentDto,
    userId: string,
    req?: any,
  ): Promise<Appointment> {
    const appointment = await this.findById(id);
    const oldValues = { ...appointment };

    // Reassign-until-visit-start rule - see REASSIGNABLE_APPOINTMENT_STATUSES's own doc
    // comment. Scoped to only the two fields the rule is actually about (technicianId,
    // scheduledAt) so an unrelated edit - notes, customer details - on an ON_SITE
    // appointment is untouched by this. Checked against the freshly-fetched `appointment`
    // above, not any client-supplied assumption of current status, so a stale drag racing
    // against the technician's own "Start Visit" tap on mobile is always caught here.
    const isReschedulingTime =
      updateAppointmentDto.scheduledAt !== undefined && updateAppointmentDto.scheduledAt !== appointment.scheduledAt.toISOString();
    const isReassigningTechnician =
      updateAppointmentDto.technicianId !== undefined && updateAppointmentDto.technicianId !== appointment.technicianId;
    if ((isReschedulingTime || isReassigningTechnician) && !REASSIGNABLE_APPOINTMENT_STATUSES.includes(appointment.status)) {
      throw new BadRequestException(
        `Cannot change the technician or time for ${appointment.appointmentNumber}: it is ${appointment.status} - the technician has ` +
          `already started this visit (or it's since moved on). Reassignment is only available before the visit starts.`,
      );
    }

    // If rescheduling, check capacity again
    if (updateAppointmentDto.scheduledAt && updateAppointmentDto.scheduledAt !== appointment.scheduledAt.toISOString()) {
      const newDate = new Date(updateAppointmentDto.scheduledAt);
      const duration = updateAppointmentDto.estimatedDurationMinutes || appointment.estimatedDurationMinutes || 60;
      const scId = updateAppointmentDto.serviceCentreId || appointment.serviceCentreId;

      const capacityCheck = await this.checkCapacity(scId, newDate, duration, id);
      if (!capacityCheck.available) {
        throw new ConflictException(capacityCheck.message || 'Service centre at capacity for new time slot');
      }
    }

    // If reassigning technician, check availability
    if (updateAppointmentDto.technicianId && updateAppointmentDto.technicianId !== appointment.technicianId) {
      // Mobile Phase 5 guardrail (the-fool pre-mortem finding): don't silently strand a
      // spare-parts reservation with the outgoing technician - refuse the reassignment
      // until whoever's handling it explicitly releases the reservation first
      // (POST /inventory/reservations/:id/release), same as any other Job Card mutation
      // that needs InventoryService's involvement (see JobCardsController.cancel()).
      if (appointment.technicianId) {
        const jobCard = await this.jobCardRepository.findOne({ where: { appointmentId: id } });
        if (jobCard) {
          const hasOpenReservation = await this.inventoryService.hasActiveReservationInCustody(jobCard.id, appointment.technicianId);
          if (hasOpenReservation) {
            throw new ConflictException(
              `Cannot reassign this appointment: the current technician still holds an open spare-parts reservation (PENDING_REVIEW/HELD/PARTIALLY_RESERVED) on Job Card ${jobCard.jobCardNumber}. Release it first via POST /inventory/reservations/:id/release, then reassign.`,
            );
          }
        }
      }

      const technician = await this.userRepository.findOne({
        where: { id: updateAppointmentDto.technicianId },
        relations: { role: true },
      });
      if (!technician) {
        throw new NotFoundException('Technician not found');
      }
      // Same role check assignTechnician() has always had (2026-09-09: added here too, a
      // the-fool pre-mortem finding on the Technician Assignment Board's drag-and-drop -
      // update() previously accepted ANY user id as technicianId with no role check at all,
      // and reassignment-by-drag now goes through this method far more often than before).
      if (!['TECHNICIAN_FIELD', 'TECHNICIAN_WORKSHOP'].includes(technician.role.name)) {
        throw new BadRequestException('Invalid technician');
      }
      const newDate = updateAppointmentDto.scheduledAt ? new Date(updateAppointmentDto.scheduledAt) : appointment.scheduledAt;
      const duration = updateAppointmentDto.estimatedDurationMinutes || appointment.estimatedDurationMinutes || 60;
      // Exclude this appointment's own row from the conflict count - see checkTechnicianAvailability()'s
      // own doc comment. assignTechnician() already passed this; update() was missing it, which meant a
      // drag-reassign that lands this appointment back near a time window its own (not-yet-saved) row
      // still occupies could spuriously self-conflict.
      const techAvailable = await this.checkTechnicianAvailability(updateAppointmentDto.technicianId, newDate, duration, id);
      if (!techAvailable) {
        throw new ConflictException('Technician not available at this time');
      }

      // Root cause of the Technician Assignment Board's "drag to a different technician
      // silently doesn't move it" bug (found 2026-09-17 via [DND-DEBUG] console logging +
      // a live-DB check after a drag reported success but the row's technicianId hadn't
      // moved): `appointment` was loaded by findById() with its `technician` relation
      // EAGERLY JOINED (still holding the OLD technician's full User row). Object.assign()
      // below only overwrites the plain `technicianId` scalar column - it never touches
      // this now-stale `technician` relation object still sitting on the entity. Appointment
      // has both `@ManyToOne() @JoinColumn({name:'technicianId'}) technician: User` AND a
      // separate `@Column() technicianId: string` mapped to that SAME physical column - a
      // known TypeORM footgun: on save(), the loaded relation object wins and its `.id` gets
      // written back to the join column, silently reverting the scalar change you just made.
      // The reassignment therefore looked like it worked (200 OK, no thrown error, `update()`
      // returns fine) while the database quietly kept the appointment on its original
      // technician - exactly "works dropped on the same technician, not on a different one",
      // since a same-technician drag never enters this block and never disturbs the relation
      // at all. Fix: keep the relation object in lock-step with the scalar whenever this
      // block actually changes it, using the very same `technician` entity already fetched
      // and validated two lines up - not a second query.
      appointment.technician = technician;
      appointment.technicianId = technician.id;
    }

    Object.assign(appointment, updateAppointmentDto);
    if (updateAppointmentDto.scheduledAt) {
      appointment.scheduledAt = new Date(updateAppointmentDto.scheduledAt);
    }

    const saved = await this.appointmentRepository.save(appointment);

    // Audit log
    await this.logAudit(
      userId,
      AuditAction.UPDATE,
      'Appointment',
      id,
      { status: oldValues.status, scheduledAt: oldValues.scheduledAt, technicianId: oldValues.technicianId },
      { status: saved.status, scheduledAt: saved.scheduledAt, technicianId: saved.technicianId },
      req,
    );

    return this.findById(id);
  }

  async cancel(id: string, reason: string, userId: string, req?: any, cancellationReasonId?: string): Promise<Appointment> {
    const appointment = await this.findById(id);

    // Idempotent (Appointment/Mobile/Job Card overhaul, 2026-09-16 Phase 1, decision #2):
    // a duplicate cancel - e.g. mobile's offline queue re-firing a request that already
    // landed once connectivity returns, or a CCE's manual override racing the same mobile
    // request - must be a safe no-op, not an error. COMPLETED still hard-blocks below:
    // that's a genuine conflicting state (the job already finished), not a duplicate
    // request, so it stays an error.
    if (appointment.status === AppointmentStatus.CANCELLED) {
      return appointment;
    }

    if (appointment.status === AppointmentStatus.COMPLETED) {
      throw new BadRequestException(`Cannot cancel appointment with status ${appointment.status}`);
    }

    // Business rule (2026-09-08): an appointment is really only ever in one of 3
    // meaningful stages - scheduled (in flight), completed, or cancelled - and
    // cancellation is only valid while it's still purely a "schedule". The moment ANY
    // Job Card exists for it (created by a technician on-site or by CCE for a workshop
    // repair, for whatever reason), the appointment is considered fulfilled and control
    // has passed to the Job Card's own lifecycle - the appointment must never be
    // cancelled out from under an in-progress or completed repair. Entity-only import of
    // JobCard (not JobCardsModule) - see this file's import comment on why; reuses the
    // same jobCardRepository already injected for update()'s reassignment guard above.
    const existingJobCard = await this.jobCardRepository.findOne({ where: { appointmentId: id } });
    if (existingJobCard) {
      throw new ConflictException(
        `Cannot cancel this appointment: Job Card ${existingJobCard.jobCardNumber} already exists for it. ` +
          `Once a Job Card is created the appointment is fulfilled - cancel or manage the repair through the Job Card instead.`,
      );
    }

    appointment.status = AppointmentStatus.CANCELLED;
    appointment.cancellationReason = reason;
    // Phase 3, req. 3f: only ever set by the mobile Cancellation reason dropdown - CCE's
    // web free-text cancel never sends this, so it stays null on that path (no FK lookup
    // here, see this service's own precedent for cityId/applianceModelId above).
    if (cancellationReasonId) {
      appointment.cancellationReasonId = cancellationReasonId;
    }
    const saved = await this.appointmentRepository.save(appointment);

    await this.logAudit(
      userId,
      AuditAction.CANCEL,
      'Appointment',
      id,
      { status: appointment.status },
      { status: AppointmentStatus.CANCELLED, cancellationReason: reason, cancellationReasonId: appointment.cancellationReasonId ?? null },
      req,
    );

    return this.findById(id);
  }

  async assignTechnician(id: string, technicianId: string, userId: string, req?: any, scheduledAt?: string): Promise<Appointment> {
    const appointment = await this.findById(id);

    if (appointment.status !== AppointmentStatus.SCHEDULED && appointment.status !== AppointmentStatus.CONFIRMED) {
      throw new BadRequestException(`Cannot assign technician to appointment with status ${appointment.status}`);
    }

    const technician = await this.userRepository.findOne({
      where: { id: technicianId },
      relations: { role: true },
    });
    if (!technician || !['TECHNICIAN_FIELD', 'TECHNICIAN_WORKSHOP'].includes(technician.role.name)) {
      throw new BadRequestException('Invalid technician');
    }

    // Optional (2026-09-09, Technician Assignment Board drag-and-drop) - the whole point of
    // accepting scheduledAt here rather than making the caller do a follow-up update() call
    // is atomicity: a technician's assignment and the time it's assigned to land in one
    // save(), so there's no window where the appointment is assigned to someone but still
    // sitting on its old (often stale/misleading) time - see this DTO's own doc comment.
    const effectiveScheduledAt = scheduledAt ? new Date(scheduledAt) : appointment.scheduledAt;
    const duration = appointment.estimatedDurationMinutes || 60;

    if (scheduledAt) {
      const capacityCheck = await this.checkCapacity(appointment.serviceCentreId, effectiveScheduledAt, duration, id);
      if (!capacityCheck.available) {
        throw new ConflictException(capacityCheck.message || 'Service centre at capacity for new time slot');
      }
    }

    const techAvailable = await this.checkTechnicianAvailability(technicianId, effectiveScheduledAt, duration, id);
    if (!techAvailable) {
      throw new ConflictException('Technician not available at this time');
    }

    const oldValues = { technicianId: appointment.technicianId, status: appointment.status, scheduledAt: appointment.scheduledAt };
    // Same relation/scalar desync fix as update() above - see its doc comment for the full
    // TypeORM explanation. findById() eager-loads the `technician` relation; on a REASSIGN
    // (appointment.technician already held the previous technician's full User row) that
    // stale relation object would win on save() and silently write the OLD technicianId
    // back to the join column even though this line correctly set the new one. Keeping both
    // in sync here means this method's own reassignment path (drag-assign to a technician
    // who already had a DIFFERENT technician on this appointment) actually persists.
    appointment.technician = technician;
    appointment.technicianId = technicianId;
    appointment.status = AppointmentStatus.TECHNICIAN_ASSIGNED;
    if (scheduledAt) {
      appointment.scheduledAt = effectiveScheduledAt;
    }
    const saved = await this.appointmentRepository.save(appointment);

    await this.logAudit(
      userId,
      AuditAction.UPDATE,
      'Appointment',
      id,
      oldValues,
      { technicianId: saved.technicianId, status: saved.status, scheduledAt: saved.scheduledAt },
      req,
    );

    return this.findById(id);
  }

  async checkCapacity(
    serviceCentreId: string,
    scheduledAt: Date,
    durationMinutes: number = 60,
    excludeAppointmentId?: string,
  ): Promise<CapacityCheckResult> {
    const serviceCentre = await this.serviceCentreRepository.findOne({
      where: { id: serviceCentreId },
    });

    if (!serviceCentre) {
      return { available: false, currentBookings: 0, maxCapacity: 0, message: 'Service centre not found' };
    }

    // Calculate time window
    const start = new Date(scheduledAt);
    start.setMinutes(start.getMinutes() - 30); // 30 min buffer before
    const end = new Date(scheduledAt);
    end.setMinutes(end.getMinutes() + durationMinutes + 30); // duration + 30 min buffer after

    const query = this.appointmentRepository
      .createQueryBuilder('apt')
      .where('apt.serviceCentreId = :serviceCentreId', { serviceCentreId })
      .andWhere('apt.status IN (:...statuses)', {
        statuses: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.TECHNICIAN_ASSIGNED],
      })
      .andWhere('apt.scheduledAt BETWEEN :start AND :end', { start, end });

    // Reassigning/rescheduling an appointment that's already sitting in this exact window
    // (e.g. the Technician Assignment Board's drag-and-drop dropping it back near its own
    // current time) would otherwise count itself as one of the "current bookings" it's
    // being checked against - the same self-conflict checkTechnicianAvailability() below
    // already guards against via this same parameter. Exclude it explicitly.
    if (excludeAppointmentId) {
      query.andWhere('apt.id != :excludeAppointmentId', { excludeAppointmentId });
    }

    const currentBookings = await query.getCount();

    // Capacity is defined per weekday in ServiceCentre.schedule (jsonb); fall back to 10/day if unset.
    const dayKey = new Date(scheduledAt)
      .toLocaleDateString('en-US', { weekday: 'long' })
      .toLowerCase();
    const daySchedule = serviceCentre.schedule?.[dayKey];
    const maxCapacity = daySchedule?.maxJobsPerDay ?? 10;
    const available = daySchedule?.isOpen === false ? false : currentBookings < maxCapacity;

    return {
      available,
      currentBookings,
      maxCapacity,
      message: available ? undefined : `Service centre at capacity (${currentBookings}/${maxCapacity})`,
    };
  }

  async checkTechnicianAvailability(
    technicianId: string,
    scheduledAt: Date,
    durationMinutes: number = 60,
    excludeAppointmentId?: string,
  ): Promise<boolean> {
    const start = new Date(scheduledAt);
    start.setMinutes(start.getMinutes() - 15);
    const end = new Date(scheduledAt);
    end.setMinutes(end.getMinutes() + durationMinutes + 15);

    const query = this.appointmentRepository
      .createQueryBuilder('apt')
      .where('apt.technicianId = :technicianId', { technicianId })
      .andWhere('apt.status IN (:...statuses)', {
        statuses: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.TECHNICIAN_ASSIGNED, AppointmentStatus.ON_SITE],
      })
      .andWhere('apt.scheduledAt BETWEEN :start AND :end', { start, end });

    // Assigning (or re-assigning) a technician on an appointment that already carries
    // this same technicianId - e.g. one created with technicianId set directly, then
    // later confirmed via assignTechnician() - would otherwise conflict with itself: its
    // own row already matches technicianId/status/window above. Exclude it explicitly
    // rather than relying on status/timing to happen not to overlap.
    if (excludeAppointmentId) {
      query.andWhere('apt.id != :excludeAppointmentId', { excludeAppointmentId });
    }

    const conflicts = await query.getCount();

    return conflicts === 0;
  }

  // Sort order: priorityOrder ASC first (Postgres's default ASC-NULLS-LAST means an
  // appointment nobody has ever drag-reordered just falls through to the scheduledAt
  // tiebreaker, unchanged from before the field-scheduling split), scheduledAt ASC second.
  // This IS "what shows in the mobile app" for a field technician - TechnicianService.
  // getMySchedule() calls straight through to this method, so a CCE reorder on the Field
  // Technician Schedule board (reorderTechnicianSchedule() below) is reflected here with no
  // separate mobile-side change needed.
  async getTechnicianSchedule(technicianId: string, date: Date): Promise<Appointment[]> {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    return this.appointmentRepository.find({
      where: {
        technicianId,
        scheduledAt: Between(start, end),
        status: In([AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.TECHNICIAN_ASSIGNED, AppointmentStatus.ON_SITE]),
      },
      relations: { serviceCentre: true },
      order: { priorityOrder: 'ASC', scheduledAt: 'ASC' },
    });
  }

  /**
   * Mobile calendar view (2026-09-16): per-day appointment counts for one calendar month,
   * for the calendar-grid dashboard added alongside the day-grouped Dashboard. One query for
   * the whole month (not one per day) - same active-status filter as getTechnicianSchedule()
   * above, so a day's count here always agrees with what that day's own list shows.
   * `month` is 1-12 (calendar convention), converted to the 0-11 JS Date expects below.
   */
  async getTechnicianScheduleMonthCounts(
    technicianId: string,
    year: number,
    month: number,
  ): Promise<{ date: string; count: number }[]> {
    const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const end = new Date(year, month, 0, 23, 59, 59, 999); // day 0 of next month = last day of this one

    const appointments = await this.appointmentRepository.find({
      where: {
        technicianId,
        scheduledAt: Between(start, end),
        status: In([AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.TECHNICIAN_ASSIGNED, AppointmentStatus.ON_SITE]),
      },
      select: { scheduledAt: true },
    });

    const counts = new Map<string, number>();
    for (const appt of appointments) {
      const d = new Date(appt.scheduledAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Field/workshop technician scheduling split (2026-09-10): a CCE drag-reorder on the
   * Field Technician Schedule board. Sets priorityOrder = array index for every id in
   * orderedAppointmentIds, and ONLY priorityOrder - scheduledAt/technicianId are never
   * touched here, per the business's own decision that reprioritizing the mobile app's
   * order is independent of the customer's actual promised appointment time. Reassigning an
   * appointment to a DIFFERENT technician is a separate, already-existing action
   * (assignTechnician()/update()'s own technicianId path, with its own availability check) -
   * this method only reorders within one technician's own list, so it deliberately does not
   * re-run checkTechnicianAvailability() at all (no time or technician is changing).
   *
   * orderedAppointmentIds must be exactly that technician's own current active-status
   * appointments for today or later - not just "any ids that happen to belong to them" -
   * so a stale/partial client-side list can never silently drop an appointment out of
   * order by omitting it. Every change is audit-logged by the controller's @Audit()
   * decorator (FIELD_SCHEDULE_REORDER), per the business's explicit "every CCE
   * drag-and-drop update must be logged in the DB" requirement.
   */
  async reorderTechnicianSchedule(technicianId: string, orderedAppointmentIds: string[]): Promise<Appointment[]> {
    if (orderedAppointmentIds.length === 0) {
      throw new BadRequestException('orderedAppointmentIds cannot be empty.');
    }
    const uniqueIds = new Set(orderedAppointmentIds);
    if (uniqueIds.size !== orderedAppointmentIds.length) {
      throw new BadRequestException('orderedAppointmentIds contains duplicate ids.');
    }

    const current = await this.appointmentRepository.find({
      where: {
        technicianId,
        status: In([AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.TECHNICIAN_ASSIGNED, AppointmentStatus.ON_SITE]),
      },
    });
    const currentIds = new Set(current.map((a) => a.id));

    if (currentIds.size !== uniqueIds.size || ![...currentIds].every((id) => uniqueIds.has(id))) {
      throw new BadRequestException(
        'orderedAppointmentIds must contain exactly this technician\'s current active appointments (no missing, extra, or foreign ids).',
      );
    }

    await Promise.all(
      orderedAppointmentIds.map((id, index) => this.appointmentRepository.update({ id }, { priorityOrder: index })),
    );

    const reordered = await this.appointmentRepository.find({
      where: { id: In(orderedAppointmentIds) },
      relations: { serviceCentre: true },
      order: { priorityOrder: 'ASC' },
    });
    return reordered;
  }

  async getServiceCentreSchedule(serviceCentreId: string, date: Date): Promise<Appointment[]> {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    return this.appointmentRepository.find({
      where: {
        serviceCentreId,
        scheduledAt: Between(start, end),
        status: In([AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.TECHNICIAN_ASSIGNED, AppointmentStatus.ON_SITE]),
      },
      relations: { technician: true },
      order: { scheduledAt: 'ASC' },
    });
  }

  // Backs the "New Appointment" scheduling grid (2026-09-09) - a Redtra360-style
  // per-technician grid of tappable 15-minute chips, replacing a plain datetime input +
  // pasted technician id. Scoped to field technicians actually assigned to the selected
  // service centre (ServiceCentre.assignedTechnicianIds), unlike the Gantt board's
  // getGanttBoard() which deliberately shows every active technician company-wide - this is
  // about booking one visit at one centre, not a cross-centre operational view.
  async getSchedulingGrid(serviceCentreId: string, date: string): Promise<SchedulingGridResult> {
    if (!DATE_ONLY.test(date)) {
      throw new BadRequestException('date must be in YYYY-MM-DD format.');
    }
    const serviceCentre = await this.serviceCentreRepository.findOne({ where: { id: serviceCentreId } });
    if (!serviceCentre) {
      throw new NotFoundException(`Service centre ${serviceCentreId} not found.`);
    }

    const technicianIds = (serviceCentre.assignedTechnicianIds ?? []).filter((id) => UUID_V4_ISH.test(id));
    const technicians = technicianIds.length
      ? await this.userRepository.find({
          where: { id: In(technicianIds), role: { name: RoleName.TECHNICIAN_FIELD }, status: UserStatus.ACTIVE },
          relations: { role: true },
          order: { firstName: 'ASC', lastName: 'ASC' },
        })
      : [];

    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const appointments = technicians.length
      ? await this.appointmentRepository.find({
          where: {
            technicianId: In(technicians.map((t) => t.id)),
            scheduledAt: Between(dayStart, dayEnd),
            status: In(ACTIVE_APPOINTMENT_STATUSES_FOR_GRID),
          },
        })
      : [];

    const dayKey = WEEKDAY_KEYS_BY_UTC_DAY[dayStart.getUTCDay()];

    return buildSchedulingGrid({
      date,
      daySchedule: serviceCentre.schedule?.[dayKey] ?? null,
      openDayAbbreviations: WEEKDAY_BADGE_ORDER.filter((d) => serviceCentre.schedule?.[d.key]?.isOpen).map((d) => d.abbr),
      technicians: technicians.map((t) => ({
        id: t.id,
        name: t.fullName,
        appointments: appointments
          .filter((a) => a.technicianId === t.id)
          .map((a) => ({ scheduledAt: a.scheduledAt, estimatedDurationMinutes: a.estimatedDurationMinutes })),
      })),
    });
  }

  async confirmAppointment(id: string, userId: string, req?: any): Promise<Appointment> {
    const appointment = await this.findById(id);

    // Idempotent, and now a manual-override action rather than a hard precondition
    // (Appointment/Mobile/Job Card overhaul, 2026-09-16 Phase 1, decisions #1/#2): a
    // technician no longer needs a CCE confirm before tapping Onsite on mobile (see
    // markOnSite below, already unblocked by TECHNICIAN_ASSIGNED alone), so this endpoint
    // is now the "manual override" a CCE can click if mobile's own status genuinely can't
    // reach the server. Any status at or past CONFIRMED is treated as already-confirmed,
    // a safe no-op rather than an error, so a late-arriving duplicate can never conflict
    // with a CCE's manual click (or vice versa).
    const alreadyConfirmedOrLater = [
      AppointmentStatus.CONFIRMED,
      AppointmentStatus.TECHNICIAN_ASSIGNED,
      AppointmentStatus.ON_SITE,
      AppointmentStatus.COLLECTED_TO_WS,
      AppointmentStatus.COMPLETED,
    ];
    if (alreadyConfirmedOrLater.includes(appointment.status)) {
      return appointment;
    }

    if (appointment.status !== AppointmentStatus.SCHEDULED) {
      throw new BadRequestException(`Can only confirm scheduled appointments`);
    }

    appointment.status = AppointmentStatus.CONFIRMED;
    const saved = await this.appointmentRepository.save(appointment);

    await this.logAudit(
      userId,
      AuditAction.UPDATE,
      'Appointment',
      id,
      { status: AppointmentStatus.SCHEDULED },
      { status: AppointmentStatus.CONFIRMED },
      req,
    );

    return this.findById(id);
  }

  async markOnSite(id: string, userId: string, req?: any): Promise<Appointment> {
    const appointment = await this.findById(id);

    // Idempotent (Appointment/Mobile/Job Card overhaul, 2026-09-16 Phase 1, decision #2):
    // a late-arriving duplicate from mobile's offline queue, or a race with a CCE's manual
    // override, must be a safe no-op once already on-site or further along.
    if (
      [
        AppointmentStatus.ON_SITE,
        AppointmentStatus.COLLECTED_TO_WS,
        AppointmentStatus.COMPLETED,
      ].includes(appointment.status)
    ) {
      return appointment;
    }

    // Decision #1: no CCE-confirm precondition for the mobile Onsite tap - TECHNICIAN_
    // ASSIGNED alone is already enough here (CONFIRMED remains accepted too, since the
    // manual-override path above can still move an appointment there first).
    if (appointment.status !== AppointmentStatus.CONFIRMED && appointment.status !== AppointmentStatus.TECHNICIAN_ASSIGNED) {
      throw new BadRequestException(`Can only mark on-site for confirmed/assigned appointments`);
    }

    appointment.status = AppointmentStatus.ON_SITE;
    appointment.actualStartAt = new Date();
    const saved = await this.appointmentRepository.save(appointment);

    await this.logAudit(
      userId,
      AuditAction.UPDATE,
      'Appointment',
      id,
      { status: appointment.status, actualStartAt: appointment.actualStartAt },
      { status: AppointmentStatus.ON_SITE, actualStartAt: saved.actualStartAt },
      req,
    );

    return this.findById(id);
  }

  // Appointment/Mobile/Job Card overhaul (2026-09-16) Phase 1, req. 3d/3e: mobile's
  // "Collection to WS" action. Deliberately transitions to COLLECTED_TO_WS, NOT
  // COMPLETED - see AppointmentStatus's own doc comment for why (the pre-mortem's
  // failure #3: COMPLETED would collide with cancel()'s "can't cancel once COMPLETED"
  // rule and with completeFromJobCardCreation()'s own idempotency below). The web's
  // "Mark Received" step (Phase 4) is what eventually moves this to COMPLETED, once a
  // Job Card is created from the workshop-validated S/N. Same preconditions as
  // markOnSite - either can happen from mobile once a technician is assigned, no
  // CCE-confirm gate.
  async markCollectedToWorkshop(id: string, userId: string, req?: any): Promise<Appointment> {
    const appointment = await this.findById(id);

    // Idempotent, same reasoning as markOnSite/cancel above.
    if ([AppointmentStatus.COLLECTED_TO_WS, AppointmentStatus.COMPLETED].includes(appointment.status)) {
      return appointment;
    }

    if (
      appointment.status !== AppointmentStatus.CONFIRMED &&
      appointment.status !== AppointmentStatus.TECHNICIAN_ASSIGNED &&
      appointment.status !== AppointmentStatus.ON_SITE
    ) {
      throw new BadRequestException(`Can only mark collected-to-workshop for confirmed/assigned/on-site appointments`);
    }

    const oldStatus = appointment.status;
    appointment.status = AppointmentStatus.COLLECTED_TO_WS;
    const saved = await this.appointmentRepository.save(appointment);

    await this.logAudit(
      userId,
      AuditAction.UPDATE,
      'Appointment',
      id,
      { status: oldStatus },
      { status: saved.status },
      req,
    );

    return this.findById(id);
  }

  async completeAppointment(id: string, userId: string, req?: any): Promise<Appointment> {
    const appointment = await this.findById(id);

    // Idempotent: since 2026-09-08, JobCardsService.create() auto-completes the appointment
    // the instant its Job Card exists (see completeFromJobCardCreation below) - so by the
    // time this endpoint runs, either from a technician's own on-site completion call or a
    // staff member manually clicking Complete, the appointment is very often already
    // COMPLETED. Treat that as success rather than an error, so neither caller needs its own
    // special-case handling for a race that's now the common case, not the exception.
    if (appointment.status === AppointmentStatus.COMPLETED) {
      return appointment;
    }

    if (appointment.status !== AppointmentStatus.ON_SITE) {
      throw new BadRequestException(`Can only complete on-site appointments`);
    }

    // Frontend Phase 10 (AMC Management) pre-mortem finding: this generic path used to be
    // reachable for an AMC PM-visit appointment too, silently marking it COMPLETED without
    // ever creating its AmcVisitCompletion record (checklist/signature/extra-charge) -
    // AmcService.completeVisit() unconditionally refuses to run once status is COMPLETED, so
    // that data would become permanently uncapturable. Blocked here at the source rather than
    // only in the UI, since this endpoint is directly callable via Swagger/curl too.
    if (appointment.type === AppointmentType.AMC) {
      throw new BadRequestException(
        'AMC PM visits are completed via POST /amc/visits/:appointmentId/complete, not this endpoint - that records the required checklist/signature/extra-charge approval instead of just flipping status.',
      );
    }

    appointment.status = AppointmentStatus.COMPLETED;
    appointment.actualEndAt = new Date();
    const saved = await this.appointmentRepository.save(appointment);

    await this.logAudit(
      userId,
      AuditAction.UPDATE,
      'Appointment',
      id,
      { status: AppointmentStatus.ON_SITE, actualEndAt: appointment.actualEndAt },
      { status: AppointmentStatus.COMPLETED, actualEndAt: saved.actualEndAt },
      req,
    );

    return this.findById(id);
  }

  /**
   * Business rule (2026-09-08): an appointment is only ever scheduled, completed, or
   * cancelled (see cancel()'s doc comment for the mirror-image rule). The moment a Job Card
   * exists for it, its job as a "schedule" is done - so JobCardsService.create() calls this
   * right after saving the new Job Card, instead of requiring a human to separately click
   * Complete. Deliberately its OWN lenient method rather than a call to completeAppointment()
   * above: this must never itself fail and take a successfully-created Job Card down with it
   * (no transaction wraps the two calls), so every case completeAppointment() would reject on
   * is a silent no-op here instead of a thrown exception - callers that still want the strict
   * on-site-only/AMC-blocked behavior should keep using completeAppointment() directly.
   */
  async completeFromJobCardCreation(id: string, userId: string): Promise<void> {
    const appointment = await this.findById(id);

    // Already fulfilled (most calls to this land here, in fact - the appointment usually
    // isn't ON_SITE by name for long before a Job Card follows) or somehow already
    // cancelled (shouldn't be reachable given cancel()'s own Job-Card-existence guard, but
    // never worth throwing over here regardless) - either way, nothing to do.
    if ([AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED].includes(appointment.status)) {
      return;
    }

    // AMC PM visits complete via their own checklist/signature/extra-charge flow
    // (AmcService.completeVisit()), never via a Job Card - Job Cards aren't part of that
    // flow at all in practice, but skip rather than throw if one somehow gets created here.
    if (appointment.type === AppointmentType.AMC) {
      return;
    }

    const previousStatus = appointment.status;
    appointment.status = AppointmentStatus.COMPLETED;
    appointment.actualEndAt = new Date();
    const saved = await this.appointmentRepository.save(appointment);

    await this.logAudit(
      userId,
      AuditAction.UPDATE,
      'Appointment',
      id,
      { status: previousStatus, actualEndAt: appointment.actualEndAt },
      { status: AppointmentStatus.COMPLETED, actualEndAt: saved.actualEndAt, note: 'Auto-completed: Job Card created' },
    );
  }

  async getDashboardStats(serviceCentreId?: string): Promise<{
    today: {
      scheduled: number;
      confirmed: number;
      onSite: number;
      completed: number;
      cancelled: number;
      // req.txt Issue A/C - the three COLLECTED_TO_WS sub-stages, split out the same way
      // attachEffectiveStatuses() splits them for the list/Status column, so this widget
      // and the table below always agree on what each bucket contains.
      collectedToWs: number;
      markedReceived: number;
      pendingJobCreation: number;
    };
    week: { total: number; byStatus: Record<string, number> };
  }> {
    // "Today at a Glance" redefinition (live-tested 2026-09-17, 3rd round on this exact
    // widget): it used to bucket by `scheduledAt` falling inside today's calendar window -
    // meaning an appointment scheduled for tomorrow that gets walked all the way to
    // COMPLETED *today* (real example: APT-20260917-0001, scheduledAt tomorrow 15:15,
    // completed today) never showed up anywhere on the widget, even though it was very
    // much "today's" activity from the CCE's point of view. Confirmed with the user this
    // was the actual bug, not just sparse data (the two earlier rounds on this widget - see
    // MODIFICATION_REQUESTS.md's Issue A history - really were just sparse test data, but
    // this round exposed a real design flaw: scheduledAt-based bucketing).
    //
    // Fix (per the user's explicit choice - "Live snapshot, no date filter"): every bucket
    // below is now a live, unfiltered count of appointments CURRENTLY in that status/
    // sub-status, with no scheduledAt window at all - the same "what does the board look
    // like right now" semantics every other status board in this app already uses (Job
    // Status Kanban, Workshop Queue). `today.completed` means "currently Completed",
    // `today.scheduled` means "currently Scheduled", etc., regardless of which calendar day
    // any of them were scheduled for. The `today` key name is kept (not renamed) purely so
    // the frontend/API contract doesn't change - DashboardStatsWidget's tile labels already
    // read fine either way ("Completed" doesn't claim "completed today").
    //
    // `week` below is intentionally UNCHANGED (still scheduledAt-bounded, last 7 days) -
    // it's a separate "recent schedule volume" stat, not one of the tiles this fix is about.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - 7);

    const whereBase = serviceCentreId ? { serviceCentreId } : {};

    const allAppointments = await this.appointmentRepository.find({ where: whereBase });

    const weekAppointments = await this.appointmentRepository.find({
      where: { ...whereBase, scheduledAt: Between(weekStart, tomorrow) },
    });

    const collectedNow = await this.attachEffectiveStatuses(
      allAppointments.filter((a) => a.status === AppointmentStatus.COLLECTED_TO_WS),
    );

    const todayStats = {
      scheduled: allAppointments.filter((a) => a.status === AppointmentStatus.SCHEDULED).length,
      confirmed: allAppointments.filter((a) => a.status === AppointmentStatus.CONFIRMED).length,
      onSite: allAppointments.filter((a) => a.status === AppointmentStatus.ON_SITE).length,
      completed: allAppointments.filter((a) => a.status === AppointmentStatus.COMPLETED).length,
      cancelled: allAppointments.filter((a) => a.status === AppointmentStatus.CANCELLED).length,
      collectedToWs: collectedNow.filter((a) => a.effectiveStatus === AppointmentStatus.COLLECTED_TO_WS).length,
      markedReceived: collectedNow.filter((a) => a.effectiveStatus === 'MARKED_RECEIVED').length,
      pendingJobCreation: collectedNow.filter((a) => a.effectiveStatus === 'PENDING_JOB_CREATION').length,
    };

    const byStatus: Record<string, number> = {};
    for (const apt of weekAppointments) {
      byStatus[apt.status] = (byStatus[apt.status] || 0) + 1;
    }

    return {
      today: todayStats,
      week: { total: weekAppointments.length, byStatus },
    };
  }

  // Backs POST /appointments/resolve-map-link - a standalone endpoint the create/edit form
  // calls live (same shape as the mobile "Use my location" GPS flow: resolve first, then
  // submit the resulting numbers as ordinary fields) rather than something wired into
  // create()/update() itself. Keeping it standalone means a bad/unreachable link only fails
  // this one lookup - it can never block or fail an appointment save, and the CCE gets
  // immediate feedback (or can fall back to typing lat/lng by hand) before submitting rather
  // than after.
  async resolveMapLink(url: string): Promise<LatLng> {
    try {
      return await resolveGoogleMapsLink(url);
    } catch (err) {
      if (err instanceof GoogleMapsLinkError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  private async logAudit(
    userId: string,
    action: AuditAction,
    entityType: string,
    entityId: string,
    oldValues: Record<string, any> | null,
    newValues: Record<string, any> | null,
    req?: any,
  ): Promise<void> {
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      const auditLog = this.auditLogRepository.create({
        action: action as any,
        entityType,
        entityId,
        oldValues,
        newValues,
        userId: user?.id,
        ipAddress: req?.ip || req?.connection?.remoteAddress,
        userAgent: req?.headers?.['user-agent'],
        metadata: { method: req?.method, url: req?.url },
      });
      await this.auditLogRepository.save(auditLog);
    } catch (error) {
      console.error('Audit log failed:', error);
    }
  }
}