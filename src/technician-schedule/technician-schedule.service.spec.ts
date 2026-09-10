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
    userRepository = {
      find: jest.fn().mockResolvedValue([technician()]),
      findOne: jest.fn(),
      save: jest.fn((u: any) => Promise.resolve(u)),
    };
    appointmentsService = {
      findAll: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 500 }),
      reorderTechnicianSchedule: jest.fn().mockResolvedValue([]),
    };
    jobCardsService = {
      findWorkshopScheduleForDate: jest.fn().mockResolvedValue([]),
      findCrewHelpersForDate: jest.fn().mockResolvedValue([]),
      findUnassignedWorkshopJobs: jest.fn().mockResolvedValue([]),
      findActiveWorkshopQueue: jest.fn().mockResolvedValue([]),
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

  describe('click-to-assign panel: unassignedAppointments / unassignedJobCards', () => {
    it('queries appointments a second time with unassigned=true for the same day window', async () => {
      await service.getGanttBoard('2026-09-09');

      expect(appointmentsService.findAll).toHaveBeenCalledWith({
        dateFrom: new Date('2026-09-09T00:00:00.000Z'),
        dateTo: new Date('2026-09-10T00:00:00.000Z'),
        unassigned: true,
        limit: 500,
      });
    });

    it('maps unassigned appointments and unassigned workshop job cards onto the result', async () => {
      appointmentsService.findAll.mockImplementation((filters: any) =>
        Promise.resolve(
          filters?.unassigned
            ? {
                data: [
                  {
                    id: 'apt-9',
                    appointmentNumber: 'APT-0009',
                    customerName: 'Amir',
                    type: 'WARRANTY',
                    scheduledAt: new Date('2026-09-09T11:00:00Z'),
                    estimatedDurationMinutes: 45,
                  },
                ],
                total: 1,
                page: 1,
                limit: 500,
              }
            : { data: [], total: 0, page: 1, limit: 500 },
        ),
      );
      jobCardsService.findUnassignedWorkshopJobs.mockResolvedValue([
        {
          id: 'jc-9',
          jobCardNumber: 'JC-0200',
          faultCode: 'F002',
          symptomCode: 'S002',
          warrantyStatus: 'OUT_OF_WARRANTY',
          createdAt: new Date('2026-09-08T12:00:00Z'),
        },
      ]);

      const result = await service.getGanttBoard('2026-09-09');

      expect(result.unassignedAppointments).toEqual([
        {
          id: 'apt-9',
          appointmentNumber: 'APT-0009',
          customerName: 'Amir',
          type: 'WARRANTY',
          scheduledAt: new Date('2026-09-09T11:00:00Z'),
          estimatedDurationMinutes: 45,
        },
      ]);
      expect(result.unassignedJobCards).toEqual([
        {
          id: 'jc-9',
          jobCardNumber: 'JC-0200',
          faultCode: 'F002',
          symptomCode: 'S002',
          warrantyStatus: 'OUT_OF_WARRANTY',
          createdAt: new Date('2026-09-08T12:00:00Z'),
        },
      ]);
    });

    it('returns empty arrays when nothing is unassigned', async () => {
      const result = await service.getGanttBoard('2026-09-09');

      expect(result.unassignedAppointments).toEqual([]);
      expect(result.unassignedJobCards).toEqual([]);
    });
  });

  describe('getWorkshopQueue (field/workshop scheduling split, 2026-09-10)', () => {
    const workshopTech = (overrides: any = {}) =>
      technician({ id: 'wtech-1', role: { name: 'TECHNICIAN_WORKSHOP' }, workshopDailyCapacity: 6, ...overrides });

    it('queries only active TECHNICIAN_WORKSHOP users, no date param', async () => {
      userRepository.find.mockResolvedValue([workshopTech()]);

      await service.getWorkshopQueue();

      expect(userRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
      expect(jobCardsService.findActiveWorkshopQueue).toHaveBeenCalledWith();
    });

    it('groups active jobs under their assigned technician, preserving FIFO order', async () => {
      userRepository.find.mockResolvedValue([workshopTech()]);
      jobCardsService.findActiveWorkshopQueue.mockResolvedValue([
        {
          id: 'jc-1',
          jobCardNumber: 'JC-0001',
          status: JobCardStatus.IN_PROGRESS,
          assignedWorkshopTechnicianId: 'wtech-1',
          workshopAssignedAt: new Date('2026-09-08T08:00:00Z'),
          faultCode: 'F001',
          symptomCode: 'S001',
          warrantyStatus: 'IN_WARRANTY',
        },
        {
          id: 'jc-2',
          jobCardNumber: 'JC-0002',
          status: JobCardStatus.WORKSHOP_ASSIGNED,
          assignedWorkshopTechnicianId: 'wtech-1',
          workshopAssignedAt: new Date('2026-09-09T08:00:00Z'),
          faultCode: 'F002',
          symptomCode: 'S002',
          warrantyStatus: 'OUT_OF_WARRANTY',
        },
      ]);

      const result = await service.getWorkshopQueue();

      expect(result.technicians).toHaveLength(1);
      expect(result.technicians[0].id).toBe('wtech-1');
      expect(result.technicians[0].jobs.map((j: any) => j.id)).toEqual(['jc-1', 'jc-2']);
      expect(result.technicians[0].activeCount).toBe(2);
    });

    it('flags overCapacity once active jobs exceed the technician\'s capacity, without blocking anything', async () => {
      userRepository.find.mockResolvedValue([workshopTech({ workshopDailyCapacity: 1 })]);
      jobCardsService.findActiveWorkshopQueue.mockResolvedValue([
        { id: 'jc-1', jobCardNumber: 'JC-0001', status: JobCardStatus.IN_PROGRESS, assignedWorkshopTechnicianId: 'wtech-1', workshopAssignedAt: new Date(), faultCode: 'F1', symptomCode: 'S1', warrantyStatus: 'IN_WARRANTY' },
        { id: 'jc-2', jobCardNumber: 'JC-0002', status: JobCardStatus.IN_PROGRESS, assignedWorkshopTechnicianId: 'wtech-1', workshopAssignedAt: new Date(), faultCode: 'F2', symptomCode: 'S2', warrantyStatus: 'IN_WARRANTY' },
      ]);

      const result = await service.getWorkshopQueue();

      expect(result.technicians[0].overCapacity).toBe(true);
      expect(result.technicians[0].activeCount).toBe(2);
    });

    it('returns a technician with an empty queue and overCapacity false when nothing is assigned', async () => {
      userRepository.find.mockResolvedValue([workshopTech()]);

      const result = await service.getWorkshopQueue();

      expect(result.technicians[0].jobs).toEqual([]);
      expect(result.technicians[0].activeCount).toBe(0);
      expect(result.technicians[0].overCapacity).toBe(false);
    });

    it('maps the unassigned workshop job pool onto the result', async () => {
      jobCardsService.findUnassignedWorkshopJobs.mockResolvedValue([
        { id: 'jc-9', jobCardNumber: 'JC-0300', faultCode: 'F009', symptomCode: 'S009', warrantyStatus: 'IN_WARRANTY', createdAt: new Date('2026-09-08T12:00:00Z') },
      ]);

      const result = await service.getWorkshopQueue();

      expect(result.unassignedJobCards).toEqual([
        { id: 'jc-9', jobCardNumber: 'JC-0300', faultCode: 'F009', symptomCode: 'S009', warrantyStatus: 'IN_WARRANTY', createdAt: new Date('2026-09-08T12:00:00Z') },
      ]);
    });
  });

  describe('setWorkshopCapacity (field/workshop scheduling split, 2026-09-10)', () => {
    it('rejects a negative or non-integer capacity without querying the technician', async () => {
      await expect(service.setWorkshopCapacity('wtech-1', -1)).rejects.toThrow(BadRequestException);
      await expect(service.setWorkshopCapacity('wtech-1', 2.5)).rejects.toThrow(BadRequestException);
      expect(userRepository.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown technician', async () => {
      userRepository.findOne.mockResolvedValue(null);
      await expect(service.setWorkshopCapacity('unknown', 6)).rejects.toThrow('not found');
    });

    it('rejects a technician who is not TECHNICIAN_WORKSHOP', async () => {
      userRepository.findOne.mockResolvedValue(technician({ role: { name: 'TECHNICIAN_FIELD' } }));
      await expect(service.setWorkshopCapacity('tech-1', 6)).rejects.toThrow(BadRequestException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('updates and saves the new capacity for a workshop technician', async () => {
      userRepository.findOne.mockResolvedValue(technician({ id: 'wtech-1', role: { name: 'TECHNICIAN_WORKSHOP' }, workshopDailyCapacity: 6 }));

      const result = await service.setWorkshopCapacity('wtech-1', 10);

      expect(userRepository.save).toHaveBeenCalledWith(expect.objectContaining({ workshopDailyCapacity: 10 }));
      expect(result).toEqual({ id: 'wtech-1', workshopDailyCapacity: 10 });
    });
  });

  describe('getFieldSchedule (field/workshop scheduling split, 2026-09-10)', () => {
    it('rejects a malformed date', async () => {
      await expect(service.getFieldSchedule('09-09-2026')).rejects.toThrow(BadRequestException);
    });

    it('queries only active TECHNICIAN_FIELD users', async () => {
      await service.getFieldSchedule('2026-09-09');

      expect(userRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
    });

    it("orders a technician's appointments by priorityOrder first, falling back to scheduledAt", async () => {
      appointmentsService.findAll.mockImplementation((filters: any) =>
        Promise.resolve(
          filters?.unassigned
            ? { data: [], total: 0, page: 1, limit: 500 }
            : {
                data: [
                  { id: 'apt-late-but-priority-0', appointmentNumber: 'APT-0002', customerName: 'B', status: AppointmentStatus.CONFIRMED, technicianId: 'tech-1', scheduledAt: new Date('2026-09-09T14:00:00Z'), priorityOrder: 0, estimatedDurationMinutes: 30 },
                  { id: 'apt-early-no-priority', appointmentNumber: 'APT-0001', customerName: 'A', status: AppointmentStatus.CONFIRMED, technicianId: 'tech-1', scheduledAt: new Date('2026-09-09T09:00:00Z'), priorityOrder: null, estimatedDurationMinutes: 30 },
                ],
                total: 2,
                page: 1,
                limit: 500,
              },
        ),
      );

      const result = await service.getFieldSchedule('2026-09-09');

      expect(result.technicians[0].appointments.map((a: any) => a.id)).toEqual([
        'apt-late-but-priority-0',
        'apt-early-no-priority',
      ]);
    });

    it('filters out appointments with no technician or an inactive status', async () => {
      appointmentsService.findAll.mockImplementation((filters: any) =>
        Promise.resolve(
          filters?.unassigned
            ? { data: [], total: 0, page: 1, limit: 500 }
            : {
                data: [
                  { id: 'apt-1', appointmentNumber: 'APT-0001', customerName: 'A', status: AppointmentStatus.SCHEDULED, technicianId: null, scheduledAt: new Date(), priorityOrder: null, estimatedDurationMinutes: 30 },
                  { id: 'apt-2', appointmentNumber: 'APT-0002', customerName: 'B', status: AppointmentStatus.CANCELLED, technicianId: 'tech-1', scheduledAt: new Date(), priorityOrder: null, estimatedDurationMinutes: 30 },
                ],
                total: 2,
                page: 1,
                limit: 500,
              },
        ),
      );

      const result = await service.getFieldSchedule('2026-09-09');

      expect(result.technicians[0].appointments).toEqual([]);
    });
  });

  describe('reorderFieldSchedule (passthrough)', () => {
    it('delegates to AppointmentsService.reorderTechnicianSchedule', async () => {
      await service.reorderFieldSchedule('tech-1', ['a', 'b']);
      expect(appointmentsService.reorderTechnicianSchedule).toHaveBeenCalledWith('tech-1', ['a', 'b']);
    });
  });
});
