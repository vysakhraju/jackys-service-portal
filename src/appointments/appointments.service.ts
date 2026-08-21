import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual, MoreThanOrEqual, In } from 'typeorm';
import { Appointment, AppointmentStatus, AppointmentType, CustomerType } from './entities/appointment.entity';
import { ServiceCentre } from '../master-data/entities/service-centre.entity';
import { User } from '../auth/entities/user.entity';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AuditLog } from '../auth/entities/audit-log.entity';
import { AuditAction } from '../auth/entities/audit-log.entity';

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
    dateFrom?: Date;
    dateTo?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ data: Appointment[]; total: number; page: number; limit: number }> {
    const query = this.appointmentRepository
      .createQueryBuilder('apt')
      .leftJoinAndSelect('apt.serviceCentre', 'sc')
      .leftJoinAndSelect('apt.technician', 'tech')
      .leftJoinAndSelect('apt.createdBy', 'createdBy')
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
    }

    if (filters?.status) {
      query.andWhere('apt.status = :status', { status: filters.status });
    }

    if (filters?.type) {
      query.andWhere('apt.type = :type', { type: filters.type });
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
      relations: ['serviceCentre', 'technician', 'createdBy', 'jobCards'],
    });
    if (!appointment) {
      throw new NotFoundException(`Appointment ${id} not found`);
    }
    return appointment;
  }

  async findByAppointmentNumber(appointmentNumber: string): Promise<Appointment> {
    const appointment = await this.appointmentRepository.findOne({
      where: { appointmentNumber },
      relations: ['serviceCentre', 'technician', 'createdBy', 'jobCards'],
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

    const maxCapacity = serviceCentre.dailyCapacity || 10; // default 10 per day
    const available = currentBookings < maxCapacity;

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
  ): Promise<boolean> {
    const start = new Date(scheduledAt);
    start.setMinutes(start.getMinutes() - 15);
    const end = new Date(scheduledAt);
    end.setMinutes(end.getMinutes() + durationMinutes + 15);

    const conflicts = await this.appointmentRepository
      .createQueryBuilder('apt')
      .where('apt.technicianId = :technicianId', { technicianId })
      .andWhere('apt.status IN (:...statuses)', {
        statuses: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.TECHNICIAN_ASSIGNED, AppointmentStatus.ON_SITE],
      })
      .andWhere('apt.scheduledAt BETWEEN :start AND :end', { start, end })
      .getCount();

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
      relations: ['serviceCentre'],
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
      relations: ['technician'],
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

    if (appointment.status !== AppointmentStatus.ON_SITE) {
      throw new BadRequestException(`Can only complete on-site appointments`);
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