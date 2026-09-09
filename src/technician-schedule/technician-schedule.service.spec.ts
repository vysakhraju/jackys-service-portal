import { BadRequestException } from '@nestjs/common';
import { TechnicianScheduleService } from './technician-schedule.service';
import { AppointmentStatus } from '../appointments/entities/appointment.entity';
import { JobCardStatus } from '../job-cards/entities/job-card.entity';

describe('TechnicianScheduleService', () => {
  let service: TechnicianScheduleService;
  let userRepository: any;
  let appointmentsService: any;
  let jobCardsService: any;

  const technician = (overrides: any = {}) => ({
    id: 'tech-1',
    firstName: 'Ravi',
    lastName: 'Kumar',
    fullName: 'Ravi Kumar',
    role: { name: 'TECHNICIAN_FIELD' },
    ...overrides,
  });

  beforeEach(() => {
    userRepository = { find: jest.fn().mockResolvedValue([technician()]) };
    appointmentsService = {
      findAll: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 500 }),
    };
    jobCardsService = {
      findWorkshopScheduleForDate: jest.fn().mockResolvedValue([]),
      findCrewHelpersForDate: jest.fn().mockResolvedValue([]),
    };
    service = new TechnicianScheduleService(userRepository, appointmentsService, jobCardsService);
  });

  it('rejects a malformed date', async () => {
    await expect(service.getGanttBoard('09-09-2026')).rejects.toThrow(BadRequestException);
    await expect(service.getGanttBoard('not-a-date')).rejects.toThrow(BadRequestException);
  });

  it('queries technicians by TECHNICIAN_FIELD/TECHNICIAN_WORKSHOP role and ACTIVE status only', async () => {
    await service.getGanttBoard('2026-09-09');

    expect(userRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
  });

  it('queries appointments for the full day window with a generous limit', async () => {
    await service.getGanttBoard('2026-09-09');

    expect(appointmentsService.findAll).toHaveBeenCalledWith({
      dateFrom: new Date('2026-09-09T00:00:00.000Z'),
      dateTo: new Date('2026-09-10T00:00:00.000Z'),
      limit: 500,
    });
  });

  it('filters out appointments with no technician assigned yet', async () => {
    appointmentsService.findAll.mockResolvedValue({
      data: [
        {
          id: 'apt-1',
          appointmentNumber: 'APT-0001',
          customerName: 'Jane',
          status: AppointmentStatus.SCHEDULED,
          technicianId: null,
          scheduledAt: new Date('2026-09-09T09:00:00Z'),
          estimatedDurationMinutes: 60,
        },
      ],
      total: 1,
      page: 1,
      limit: 500,
    });

    const result = await service.getGanttBoard('2026-09-09');

    expect(result.rows[0].blocks).toHaveLength(0);
  });

  it('filters out appointments in an inactive status (COMPLETED/CANCELLED/NO_SHOW/RESCHEDULED)', async () => {
    appointmentsService.findAll.mockResolvedValue({
      data: [
        {
          id: 'apt-1',
          appointmentNumber: 'APT-0001',
          customerName: 'Jane',
          status: AppointmentStatus.CANCELLED,
          technicianId: 'tech-1',
          scheduledAt: new Date('2026-09-09T09:00:00Z'),
          estimatedDurationMinutes: 60,
        },
      ],
      total: 1,
      page: 1,
      limit: 500,
    });

    const result = await service.getGanttBoard('2026-09-09');

    expect(result.rows[0].blocks).toHaveLength(0);
  });

  it('includes an active-status appointment as a block on the right technician row', async () => {
    appointmentsService.findAll.mockResolvedValue({
      data: [
        {
          id: 'apt-1',
          appointmentNumber: 'APT-0001',
          customerName: 'Jane',
          status: AppointmentStatus.CONFIRMED,
          technicianId: 'tech-1',
          scheduledAt: new Date('2026-09-09T09:00:00Z'),
          estimatedDurationMinutes: 60,
        },
      ],
      total: 1,
      page: 1,
      limit: 500,
    });

    const result = await service.getGanttBoard('2026-09-09');

    expect(result.rows[0].blocks).toHaveLength(1);
    expect(result.rows[0].blocks[0].refNumber).toBe('APT-0001');
  });

  it('maps workshop jobs and crew helpers (with the joined jobCard fields) into blocks', async () => {
    userRepository.find.mockResolvedValue([technician({ id: 'tech-2', role: { name: 'TECHNICIAN_WORKSHOP' } })]);
    jobCardsService.findWorkshopScheduleForDate.mockResolvedValue([
      {
        id: 'jc-1',
        jobCardNumber: 'JC-0100',
        status: JobCardStatus.IN_PROGRESS,
        assignedWorkshopTechnicianId: 'tech-2',
        workshopAssignedAt: new Date('2026-09-09T08:00:00Z'),
        qcApprovedAt: null,
      },
    ]);
    jobCardsService.findCrewHelpersForDate.mockResolvedValue([
      {
        id: 'helper-1',
        jobCardId: 'jc-2',
        technicianId: 'tech-2',
        addedAt: new Date('2026-09-09T09:00:00Z'),
        removedAt: null,
        jobCard: { jobCardNumber: 'JC-0101', status: JobCardStatus.IN_PROGRESS, qcApprovedAt: null },
      },
    ]);

    const result = await service.getGanttBoard('2026-09-09');

    expect(result.rows[0].blocks.map((b) => b.type).sort()).toEqual(['crew_helper', 'workshop_job']);
    expect(result.rows[0].blocks.find((b) => b.type === 'crew_helper')!.refNumber).toBe('JC-0101');
  });

  it('returns the requested date on the result', async () => {
    const result = await service.getGanttBoard('2026-09-09');
    expect(result.date).toBe('2026-09-09');
  });
});
