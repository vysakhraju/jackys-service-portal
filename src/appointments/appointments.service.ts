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
import { User } from '../auth/entities/user.entity';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AuditLog } from '../auth/entities/audit-log.entity';
import { AuditAction } from '../auth/entities/audit-log.entity';
// Entity-only import, not JobCardsModule - see AppointmentsModule's doc comment on why
// (JobCardsModule already imports this module, so the reverse would be a cycle).
import { JobCard } from '../job-cards/entities/job-card.entity';
import { InventoryService } from '../inventory/inventory.service';

interface CapacityCheckResult {
  available: boolean;
  currentBookings: number;
  maxCapacity: number;
  message?: string;
}

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
    private inventoryService: InventoryService,
  ) {}

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
    status?: AppointmentStatus;
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
  }): Promise<{ data: Appointment[]; total: number; page: number; limit: number }> {
    const query = this.appointmentRepository
      .createQueryBuilder('apt')
      .leftJoinAndSelect('apt.serviceCentre', 'sc')
      .leftJoinAndSelect('apt.technician', 'tech')
      .leftJoinAndSelect('apt.createdBy', 'createdBy')
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

    if (filters?.status) {
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

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    query.skip((page - 1) * limit).take(limit);

    const [data, total] = await query.getManyAndCount();

    return { data, total, page, limit };
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

    // If rescheduling, check capacity again
    if (updateAppointmentDto.scheduledAt && updateAppointmentDto.scheduledAt !== appointment.scheduledAt.toISOString()) {
      const newDate = new Date(updateAppointmentDto.scheduledAt);
      const duration = updateAppointmentDto.estimatedDurationMinutes || appointment.estimatedDurationMinutes || 60;
      const scId = updateAppointmentDto.serviceCentreId || appointment.serviceCentreId;

      const capacityCheck = await this.checkCapacity(scId, newDate, duration);
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
      const newDate = updateAppointmentDto.scheduledAt ? new Date(updateAppointmentDto.scheduledAt) : appointment.scheduledAt;
      const duration = updateAppointmentDto.estimatedDurationMinutes || appointment.estimatedDurationMinutes || 60;
      const techAvailable = await this.checkTechnicianAvailability(updateAppointmentDto.technicianId, newDate, duration);
      if (!techAvailable) {
        throw new ConflictException('Technician not available at this time');
      }
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

  async cancel(id: string, reason: string, userId: string, req?: any): Promise<Appointment> {
    const appointment = await this.findById(id);

    if ([AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED].includes(appointment.status)) {
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
    const saved = await this.appointmentRepository.save(appointment);

    await this.logAudit(
      userId,
      AuditAction.CANCEL,
      'Appointment',
      id,
      { status: appointment.status },
      { status: AppointmentStatus.CANCELLED, cancellationReason: reason },
      req,
    );

    return this.findById(id);
  }

  async assignTechnician(id: string, technicianId: string, userId: string, req?: any): Promise<Appointment> {
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

    const techAvailable = await this.checkTechnicianAvailability(
      technicianId,
      appointment.scheduledAt,
      appointment.estimatedDurationMinutes || 60,
      id,
    );
    if (!techAvailable) {
      throw new ConflictException('Technician not available at this time');
    }

    appointment.technicianId = technicianId;
    appointment.status = AppointmentStatus.TECHNICIAN_ASSIGNED;
    const saved = await this.appointmentRepository.save(appointment);

    await this.logAudit(
      userId,
      AuditAction.UPDATE,
      'Appointment',
      id,
      { technicianId: appointment.technicianId, status: appointment.status },
      { technicianId, status: AppointmentStatus.TECHNICIAN_ASSIGNED },
      req,
    );

    return this.findById(id);
  }

  async checkCapacity(
    serviceCentreId: string,
    scheduledAt: Date,
    durationMinutes: number = 60,
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

    const currentBookings = await this.appointmentRepository
      .createQueryBuilder('apt')
      .where('apt.serviceCentreId = :serviceCentreId', { serviceCentreId })
      .andWhere('apt.status IN (:...statuses)', {
        statuses: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.TECHNICIAN_ASSIGNED],
      })
      .andWhere('apt.scheduledAt BETWEEN :start AND :end', { start, end })
      .getCount();

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
      order: { scheduledAt: 'ASC' },
    });
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

  async confirmAppointment(id: string, userId: string, req?: any): Promise<Appointment> {
    const appointment = await this.findById(id);

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
    today: { scheduled: number; confirmed: number; onSite: number; completed: number; cancelled: number };
    week: { total: number; byStatus: Record<string, number> };
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - 7);

    const whereBase = serviceCentreId ? { serviceCentreId } : {};

    const todayAppointments = await this.appointmentRepository.find({
      where: { ...whereBase, scheduledAt: Between(today, tomorrow) },
    });

    const weekAppointments = await this.appointmentRepository.find({
      where: { ...whereBase, scheduledAt: Between(weekStart, tomorrow) },
    });

    const todayStats = {
      scheduled: todayAppointments.filter((a) => a.status === AppointmentStatus.SCHEDULED).length,
      confirmed: todayAppointments.filter((a) => a.status === AppointmentStatus.CONFIRMED).length,
      onSite: todayAppointments.filter((a) => a.status === AppointmentStatus.ON_SITE).length,
      completed: todayAppointments.filter((a) => a.status === AppointmentStatus.COMPLETED).length,
      cancelled: todayAppointments.filter((a) => a.status === AppointmentStatus.CANCELLED).length,
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