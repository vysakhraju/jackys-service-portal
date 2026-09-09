import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User, UserStatus } from '../auth/entities/user.entity';
import { AppointmentsService } from '../appointments/appointments.service';
import { AppointmentStatus } from '../appointments/entities/appointment.entity';
import { JobCardsService } from '../job-cards/job-cards.service';
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

  async getGanttBoard(date: string): Promise<{ date: string; rows: TechnicianScheduleRow[] }> {
    if (!DATE_ONLY.test(date)) {
      throw new BadRequestException('date must be in YYYY-MM-DD format.');
    }
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const now = new Date();

    const [technicians, appointmentsPage, workshopJobs, crewHelpers] = await Promise.all([
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

    return { date, rows };
  }
}
