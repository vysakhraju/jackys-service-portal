import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User, UserStatus } from '../auth/entities/user.entity';
import { RoleName } from '../auth/entities/role.entity';
import { AppointmentsService } from '../appointments/appointments.service';
import { Appointment, AppointmentStatus } from '../appointments/entities/appointment.entity';
import { JobCardsService } from '../job-cards/job-cards.service';
import { JobCard } from '../job-cards/entities/job-card.entity';
import { buildTechnicianSchedule, TechnicianScheduleRow } from './technician-schedule.util';

// Same active-status set AppointmentsService.checkTechnicianAvailability() already uses
// for its own double-booking check at create/update time - COMPLETED/CANCELLED/NO_SHOW/
// RESCHEDULED appointments aren't actually occupying the technician any more, so they'd
// be noise (or worse, false conflicts) on the board.
const ACTIVE_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.TECHNICIAN_ASSIGNED,
  AppointmentStatus.ON_SITE,
];

const TECHNICIAN_ROLES = ['TECHNICIAN_FIELD', 'TECHNICIAN_WORKSHOP'];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Field/workshop scheduling split (2026-09-10) - one row per workshop technician on the
// Workshop Queue board.
export interface WorkshopQueueTechnicianRow {
  id: string;
  name: string;
  capacity: number;
  activeCount: number;
  overCapacity: boolean;
  jobs: {
    id: string;
    jobCardNumber: string;
    status: string;
    faultCode: string;
    symptomCode: string;
    warrantyStatus: string;
    workshopAssignedAt: Date;
  }[];
}

// One row per field technician on the Field Technician Schedule board - ordered by
// priorityOrder/scheduledAt exactly as AppointmentsService.getTechnicianSchedule() would
// return for that technician alone, just aggregated across every field technician in one
// call the same way getGanttBoard() already aggregates across both technician types.
export interface FieldScheduleTechnicianRow {
  id: string;
  name: string;
  appointments: {
    id: string;
    appointmentNumber: string;
    customerName: string;
    status: string;
    scheduledAt: Date;
    priorityOrder: number | null;
    estimatedDurationMinutes: number | null;
  }[];
}

// The board's click-to-assign panel (2026-09-09) - just enough per row for a card + the
// "Assign" action's own request, not the full Appointment/JobCard shape.
export interface UnassignedAppointment {
  id: string;
  appointmentNumber: string;
  customerName: string;
  type: string;
  scheduledAt: Date;
  estimatedDurationMinutes: number | null;
}

export interface UnassignedJobCard {
  id: string;
  jobCardNumber: string;
  faultCode: string;
  symptomCode: string;
  warrantyStatus: string;
  createdAt: Date;
}

/**
 * Backs the Gantt-style technician assignment board (2026-09-09) - a per-technician,
 * per-day timeline spanning two independent assignment tracks that don't otherwise share
 * a table (Appointment.technicianId/scheduledAt for field visits, JobCard.
 * assignedWorkshopTechnicianId/workshopAssignedAt + JobCardCrewHelper for workshop jobs),
 * with double-booking conflicts computed by technician-schedule.util.ts's pure
 * buildTechnicianSchedule(). Deliberately its own top-level module rather than folded
 * into WorkshopModule or AppointmentsModule, same "read-only aggregator sitting above
 * everything, imported by nothing" reasoning as JobCardJourneyModule.
 */
@Injectable()
export class TechnicianScheduleService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private appointmentsService: AppointmentsService,
    private jobCardsService: JobCardsService,
  ) {}

  async getGanttBoard(date: string): Promise<{
    date: string;
    rows: TechnicianScheduleRow[];
    unassignedAppointments: UnassignedAppointment[];
    unassignedJobCards: UnassignedJobCard[];
  }> {
    if (!DATE_ONLY.test(date)) {
      throw new BadRequestException('date must be in YYYY-MM-DD format.');
    }
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const now = new Date();

    const [technicians, appointmentsPage, workshopJobs, crewHelpers, unassignedAppointmentsPage, unassignedJobCardEntities] = await Promise.all([
      this.userRepository.find({
        where: { role: { name: In(TECHNICIAN_ROLES) }, status: UserStatus.ACTIVE },
        relations: { role: true },
        order: { firstName: 'ASC', lastName: 'ASC' },
      }),
      // limit: 500 - generous enough for one service centre's one-day schedule; findAll()
      // paginates by default (20/page) since it's normally a browse screen, not a
      // day's-worth-in-one-shot query like this is.
      this.appointmentsService.findAll({ dateFrom: dayStart, dateTo: dayEnd, limit: 500 }),
      this.jobCardsService.findWorkshopScheduleForDate(dayStart, dayEnd),
      this.jobCardsService.findCrewHelpersForDate(dayStart, dayEnd),
      // The board's click-to-assign panel (2026-09-09) - scheduled-but-technicianless
      // appointments for this same day, and every WORKSHOP job still waiting on its first
      // technician (no date scoping possible for those - see
      // findUnassignedWorkshopJobs()'s own doc comment).
      this.appointmentsService.findAll({ dateFrom: dayStart, dateTo: dayEnd, unassigned: true, limit: 500 }),
      this.jobCardsService.findUnassignedWorkshopJobs(),
    ]);

    const rows = buildTechnicianSchedule({
      technicians: technicians.map((t) => ({ id: t.id, name: t.fullName, role: t.role.name as 'TECHNICIAN_FIELD' | 'TECHNICIAN_WORKSHOP' })),
      appointments: appointmentsPage.data
        .filter((a) => a.technicianId && ACTIVE_APPOINTMENT_STATUSES.includes(a.status))
        .map((a) => ({
          id: a.id,
          appointmentNumber: a.appointmentNumber,
          customerName: a.customerName,
          status: a.status,
          technicianId: a.technicianId!,
          scheduledAt: a.scheduledAt,
          estimatedDurationMinutes: a.estimatedDurationMinutes,
        })),
      workshopJobs: workshopJobs.map((j) => ({
        id: j.id,
        jobCardNumber: j.jobCardNumber,
        status: j.status,
        assignedWorkshopTechnicianId: j.assignedWorkshopTechnicianId!,
        workshopAssignedAt: j.workshopAssignedAt!,
        qcApprovedAt: j.qcApprovedAt,
      })),
      crewHelpers: crewHelpers.map((h) => ({
        id: h.id,
        jobCardId: h.jobCardId,
        jobCardNumber: h.jobCard.jobCardNumber,
        jobCardStatus: h.jobCard.status,
        technicianId: h.technicianId,
        addedAt: h.addedAt,
        removedAt: h.removedAt,
        jobQcApprovedAt: h.jobCard.qcApprovedAt,
      })),
      now,
    });

    const unassignedAppointments: UnassignedAppointment[] = unassignedAppointmentsPage.data.map((a) => ({
      id: a.id,
      appointmentNumber: a.appointmentNumber,
      customerName: a.customerName,
      type: a.type,
      scheduledAt: a.scheduledAt,
      estimatedDurationMinutes: a.estimatedDurationMinutes,
    }));

    const unassignedJobCards: UnassignedJobCard[] = unassignedJobCardEntities.map((j) => ({
      id: j.id,
      jobCardNumber: j.jobCardNumber,
      faultCode: j.faultCode,
      symptomCode: j.symptomCode,
      warrantyStatus: j.warrantyStatus,
      createdAt: j.createdAt,
    }));

    return { date, rows, unassignedAppointments, unassignedJobCards };
  }

  /**
   * Workshop Queue board (2026-09-10, field/workshop scheduling split): replaces the
   * workshop half of getGanttBoard() above with a no-time-axis, FIFO, capacity-gauge view -
   * "workshop technician is not cared about appointment, he repairs what is assigned to
   * him" (the business's own framing). Capacity is display-only (User.workshopDailyCapacity)
   * - per the business's decision, a technician already at capacity still accepts new
   * assignments, they just queue; overCapacity only drives the gauge's colour, nothing is
   * ever blocked here.
   */
  async getWorkshopQueue(): Promise<{
    technicians: WorkshopQueueTechnicianRow[];
    unassignedJobCards: UnassignedJobCard[];
  }> {
    const [technicians, activeJobs, unassignedJobCardEntities] = await Promise.all([
      this.userRepository.find({
        where: { role: { name: RoleName.TECHNICIAN_WORKSHOP }, status: UserStatus.ACTIVE },
        relations: { role: true },
        order: { firstName: 'ASC', lastName: 'ASC' },
      }),
      this.jobCardsService.findActiveWorkshopQueue(),
      this.jobCardsService.findUnassignedWorkshopJobs(),
    ]);

    const jobsByTechnician = new Map<string, JobCard[]>();
    for (const job of activeJobs) {
      const list = jobsByTechnician.get(job.assignedWorkshopTechnicianId!) ?? [];
      list.push(job);
      jobsByTechnician.set(job.assignedWorkshopTechnicianId!, list);
    }

    const rows: WorkshopQueueTechnicianRow[] = technicians.map((t) => {
      // Already FIFO-ordered (workshopAssignedAt ASC) by findActiveWorkshopQueue()'s own
      // query - grouping here preserves that order, no re-sort needed.
      const jobs = jobsByTechnician.get(t.id) ?? [];
      return {
        id: t.id,
        name: t.fullName,
        capacity: t.workshopDailyCapacity,
        activeCount: jobs.length,
        overCapacity: jobs.length > t.workshopDailyCapacity,
        jobs: jobs.map((j) => ({
          id: j.id,
          jobCardNumber: j.jobCardNumber,
          status: j.status,
          faultCode: j.faultCode,
          symptomCode: j.symptomCode,
          warrantyStatus: j.warrantyStatus,
          workshopAssignedAt: j.workshopAssignedAt!,
        })),
      };
    });

    const unassignedJobCards: UnassignedJobCard[] = unassignedJobCardEntities.map((j) => ({
      id: j.id,
      jobCardNumber: j.jobCardNumber,
      faultCode: j.faultCode,
      symptomCode: j.symptomCode,
      warrantyStatus: j.warrantyStatus,
      createdAt: j.createdAt,
    }));

    return { technicians: rows, unassignedJobCards };
  }

  /**
   * Field/workshop scheduling split (2026-09-10) - planning-visibility capacity number for
   * a workshop technician's Workshop Queue gauge. Never enforced (see getWorkshopQueue()'s
   * own doc comment) - purely what CCE/TL sees at a glance.
   */
  async setWorkshopCapacity(technicianId: string, capacity: number): Promise<{ id: string; workshopDailyCapacity: number }> {
    if (!Number.isInteger(capacity) || capacity < 0) {
      throw new BadRequestException('capacity must be a non-negative integer.');
    }
    const technician = await this.userRepository.findOne({ where: { id: technicianId }, relations: { role: true } });
    if (!technician) {
      throw new NotFoundException(`Technician ${technicianId} not found.`);
    }
    if (technician.role.name !== RoleName.TECHNICIAN_WORKSHOP) {
      throw new BadRequestException(`${technician.fullName} is not a workshop technician.`);
    }
    technician.workshopDailyCapacity = capacity;
    await this.userRepository.save(technician);
    return { id: technician.id, workshopDailyCapacity: technician.workshopDailyCapacity };
  }

  /**
   * Field Technician Schedule board (2026-09-10, field/workshop scheduling split): replaces
   * the field half of getGanttBoard() above with a per-technician ordered list (priority
   * order first, falling back to time - see Appointment.priorityOrder's own doc comment),
   * still scoped to one day the same way appointments naturally are. Single findAll() call
   * plus in-memory grouping, same pattern getGanttBoard() already uses, rather than one
   * query per technician.
   */
  async getFieldSchedule(date: string): Promise<{
    date: string;
    technicians: FieldScheduleTechnicianRow[];
    unassignedAppointments: UnassignedAppointment[];
  }> {
    if (!DATE_ONLY.test(date)) {
      throw new BadRequestException('date must be in YYYY-MM-DD format.');
    }
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const [technicians, appointmentsPage, unassignedAppointmentsPage] = await Promise.all([
      this.userRepository.find({
        where: { role: { name: RoleName.TECHNICIAN_FIELD }, status: UserStatus.ACTIVE },
        relations: { role: true },
        order: { firstName: 'ASC', lastName: 'ASC' },
      }),
      this.appointmentsService.findAll({ dateFrom: dayStart, dateTo: dayEnd, limit: 500 }),
      this.appointmentsService.findAll({ dateFrom: dayStart, dateTo: dayEnd, unassigned: true, limit: 500 }),
    ]);

    const appointmentsByTechnician = new Map<string, Appointment[]>();
    for (const a of appointmentsPage.data) {
      if (!a.technicianId || !ACTIVE_APPOINTMENT_STATUSES.includes(a.status)) continue;
      const list = appointmentsByTechnician.get(a.technicianId) ?? [];
      list.push(a);
      appointmentsByTechnician.set(a.technicianId, list);
    }
    // findAll() orders by scheduledAt globally - re-sort each technician's own list by
    // priorityOrder first (nulls last) now that a reorder can diverge from time order.
    for (const list of appointmentsByTechnician.values()) {
      list.sort((a, b) => {
        const pa = a.priorityOrder ?? Number.MAX_SAFE_INTEGER;
        const pb = b.priorityOrder ?? Number.MAX_SAFE_INTEGER;
        if (pa !== pb) return pa - pb;
        return a.scheduledAt.getTime() - b.scheduledAt.getTime();
      });
    }

    const rows: FieldScheduleTechnicianRow[] = technicians.map((t) => ({
      id: t.id,
      name: t.fullName,
      appointments: (appointmentsByTechnician.get(t.id) ?? []).map((a) => ({
        id: a.id,
        appointmentNumber: a.appointmentNumber,
        customerName: a.customerName,
        status: a.status,
        scheduledAt: a.scheduledAt,
        priorityOrder: a.priorityOrder,
        estimatedDurationMinutes: a.estimatedDurationMinutes,
      })),
    }));

    const unassignedAppointments: UnassignedAppointment[] = unassignedAppointmentsPage.data.map((a) => ({
      id: a.id,
      appointmentNumber: a.appointmentNumber,
      customerName: a.customerName,
      type: a.type,
      scheduledAt: a.scheduledAt,
      estimatedDurationMinutes: a.estimatedDurationMinutes,
    }));

    return { date, technicians: rows, unassignedAppointments };
  }

  // Thin passthrough (same "everything goes through the schedule service" convention this
  // file already follows for the read endpoints above) to
  // AppointmentsService.reorderTechnicianSchedule() - see that method's own doc comment for
  // the actual validation/priorityOrder logic.
  async reorderFieldSchedule(technicianId: string, orderedAppointmentIds: string[]) {
    return this.appointmentsService.reorderTechnicianSchedule(technicianId, orderedAppointmentIds);
  }
}
