import { buildTechnicianSchedule, BuildScheduleInput } from './technician-schedule.util';

const NOW = new Date('2026-09-09T12:00:00Z');

function baseInput(overrides: Partial<BuildScheduleInput> = {}): BuildScheduleInput {
  return {
    technicians: [{ id: 'tech-1', name: 'Ravi Kumar', role: 'TECHNICIAN_FIELD' }],
    appointments: [],
    workshopJobs: [],
    crewHelpers: [],
    now: NOW,
    ...overrides,
  };
}

describe('buildTechnicianSchedule', () => {
  it('returns one row per technician, even with no blocks at all', () => {
    const rows = buildTechnicianSchedule(baseInput());

    expect(rows).toEqual([
      { technicianId: 'tech-1', technicianName: 'Ravi Kumar', role: 'TECHNICIAN_FIELD', blocks: [], hasConflict: false },
    ]);
  });

  it('builds an appointment block using estimatedDurationMinutes when set', () => {
    const rows = buildTechnicianSchedule(
      baseInput({
        appointments: [
          {
            id: 'apt-1',
            appointmentNumber: 'APT-0001',
            customerName: 'Jane Doe',
            status: 'SCHEDULED',
            technicianId: 'tech-1',
            scheduledAt: new Date('2026-09-09T09:00:00Z'),
            estimatedDurationMinutes: 90,
          },
        ],
      }),
    );

    expect(rows[0].blocks).toHaveLength(1);
    expect(rows[0].blocks[0]).toMatchObject({
      type: 'appointment',
      refNumber: 'APT-0001',
      startAt: new Date('2026-09-09T09:00:00Z'),
      endAt: new Date('2026-09-09T10:30:00Z'),
      ongoing: false,
      hasConflict: false,
    });
  });

  it('defaults an appointment with no estimatedDurationMinutes to 60 minutes (matches AppointmentsService.create/update)', () => {
    const rows = buildTechnicianSchedule(
      baseInput({
        appointments: [
          {
            id: 'apt-1',
            appointmentNumber: 'APT-0001',
            customerName: 'Jane Doe',
            status: 'SCHEDULED',
            technicianId: 'tech-1',
            scheduledAt: new Date('2026-09-09T09:00:00Z'),
            estimatedDurationMinutes: null,
          },
        ],
      }),
    );

    expect(rows[0].blocks[0].endAt).toEqual(new Date('2026-09-09T10:00:00Z'));
  });

  it('builds an ongoing workshop_job block ending at `now` when qcApprovedAt is not yet set', () => {
    const rows = buildTechnicianSchedule(
      baseInput({
        technicians: [{ id: 'tech-2', name: 'Ali Hassan', role: 'TECHNICIAN_WORKSHOP' }],
        workshopJobs: [
          {
            id: 'jc-1',
            jobCardNumber: 'JC-0100',
            status: 'IN_PROGRESS',
            assignedWorkshopTechnicianId: 'tech-2',
            workshopAssignedAt: new Date('2026-09-09T08:00:00Z'),
            qcApprovedAt: null,
          },
        ],
      }),
    );

    expect(rows[0].blocks[0]).toMatchObject({ type: 'workshop_job', ongoing: true, endAt: NOW });
  });

  it('builds a finished workshop_job block ending at qcApprovedAt, not `now`', () => {
    const rows = buildTechnicianSchedule(
      baseInput({
        technicians: [{ id: 'tech-2', name: 'Ali Hassan', role: 'TECHNICIAN_WORKSHOP' }],
        workshopJobs: [
          {
            id: 'jc-1',
            jobCardNumber: 'JC-0100',
            status: 'QC_PASSED',
            assignedWorkshopTechnicianId: 'tech-2',
            workshopAssignedAt: new Date('2026-09-09T08:00:00Z'),
            qcApprovedAt: new Date('2026-09-09T10:00:00Z'),
          },
        ],
      }),
    );

    expect(rows[0].blocks[0]).toMatchObject({
      ongoing: false,
      endAt: new Date('2026-09-09T10:00:00Z'),
    });
  });

  it('builds a crew_helper block ending when the helper was removed, even if the job is still ongoing', () => {
    const rows = buildTechnicianSchedule(
      baseInput({
        technicians: [{ id: 'tech-3', name: 'Sunil Perera', role: 'TECHNICIAN_WORKSHOP' }],
        crewHelpers: [
          {
            id: 'helper-1',
            jobCardId: 'jc-1',
            jobCardNumber: 'JC-0100',
            jobCardStatus: 'IN_PROGRESS',
            technicianId: 'tech-3',
            addedAt: new Date('2026-09-09T08:00:00Z'),
            removedAt: new Date('2026-09-09T09:00:00Z'),
            jobQcApprovedAt: null,
          },
        ],
      }),
    );

    expect(rows[0].blocks[0]).toMatchObject({
      type: 'crew_helper',
      ongoing: false,
      endAt: new Date('2026-09-09T09:00:00Z'),
    });
  });

  it('flags a double-booking: two overlapping appointments for the same technician', () => {
    const rows = buildTechnicianSchedule(
      baseInput({
        appointments: [
          {
            id: 'apt-1',
            appointmentNumber: 'APT-0001',
            customerName: 'Jane Doe',
            status: 'SCHEDULED',
            technicianId: 'tech-1',
            scheduledAt: new Date('2026-09-09T09:00:00Z'),
            estimatedDurationMinutes: 90,
          },
          {
            id: 'apt-2',
            appointmentNumber: 'APT-0002',
            customerName: 'John Smith',
            status: 'CONFIRMED',
            technicianId: 'tech-1',
            scheduledAt: new Date('2026-09-09T09:30:00Z'),
            estimatedDurationMinutes: 60,
          },
        ],
      }),
    );

    expect(rows[0].hasConflict).toBe(true);
    expect(rows[0].blocks.every((b) => b.hasConflict)).toBe(true);
  });

  it('does not flag back-to-back (non-overlapping) appointments as a conflict', () => {
    const rows = buildTechnicianSchedule(
      baseInput({
        appointments: [
          {
            id: 'apt-1',
            appointmentNumber: 'APT-0001',
            customerName: 'Jane Doe',
            status: 'SCHEDULED',
            technicianId: 'tech-1',
            scheduledAt: new Date('2026-09-09T09:00:00Z'),
            estimatedDurationMinutes: 60,
          },
          {
            id: 'apt-2',
            appointmentNumber: 'APT-0002',
            customerName: 'John Smith',
            status: 'CONFIRMED',
            technicianId: 'tech-1',
            scheduledAt: new Date('2026-09-09T10:00:00Z'),
            estimatedDurationMinutes: 60,
          },
        ],
      }),
    );

    expect(rows[0].hasConflict).toBe(false);
    expect(rows[0].blocks.every((b) => !b.hasConflict)).toBe(true);
  });

  it('flags a workshop double-booking: a technician assigned as primary on one job and crew helper on an overlapping one', () => {
    const rows = buildTechnicianSchedule(
      baseInput({
        technicians: [{ id: 'tech-2', name: 'Ali Hassan', role: 'TECHNICIAN_WORKSHOP' }],
        workshopJobs: [
          {
            id: 'jc-1',
            jobCardNumber: 'JC-0100',
            status: 'IN_PROGRESS',
            assignedWorkshopTechnicianId: 'tech-2',
            workshopAssignedAt: new Date('2026-09-09T08:00:00Z'),
            qcApprovedAt: null,
          },
        ],
        crewHelpers: [
          {
            id: 'helper-1',
            jobCardId: 'jc-2',
            jobCardNumber: 'JC-0101',
            jobCardStatus: 'IN_PROGRESS',
            technicianId: 'tech-2',
            addedAt: new Date('2026-09-09T09:00:00Z'),
            removedAt: null,
            jobQcApprovedAt: null,
          },
        ],
      }),
    );

    expect(rows[0].hasConflict).toBe(true);
    expect(rows[0].blocks.map((b) => b.type).sort()).toEqual(['crew_helper', 'workshop_job']);
  });

  it('keeps conflicts scoped per-technician - two different technicians overlapping is not a conflict', () => {
    const rows = buildTechnicianSchedule(
      baseInput({
        technicians: [
          { id: 'tech-1', name: 'Ravi Kumar', role: 'TECHNICIAN_FIELD' },
          { id: 'tech-4', name: 'Second Tech', role: 'TECHNICIAN_FIELD' },
        ],
        appointments: [
          {
            id: 'apt-1',
            appointmentNumber: 'APT-0001',
            customerName: 'Jane Doe',
            status: 'SCHEDULED',
            technicianId: 'tech-1',
            scheduledAt: new Date('2026-09-09T09:00:00Z'),
            estimatedDurationMinutes: 60,
          },
          {
            id: 'apt-2',
            appointmentNumber: 'APT-0002',
            customerName: 'John Smith',
            status: 'CONFIRMED',
            technicianId: 'tech-4',
            scheduledAt: new Date('2026-09-09T09:00:00Z'),
            estimatedDurationMinutes: 60,
          },
        ],
      }),
    );

    expect(rows.every((r) => !r.hasConflict)).toBe(true);
  });

  it('sorts each technician\'s blocks by start time', () => {
    const rows = buildTechnicianSchedule(
      baseInput({
        appointments: [
          {
            id: 'apt-2',
            appointmentNumber: 'APT-0002',
            customerName: 'Later',
            status: 'SCHEDULED',
            technicianId: 'tech-1',
            scheduledAt: new Date('2026-09-09T14:00:00Z'),
            estimatedDurationMinutes: 30,
          },
          {
            id: 'apt-1',
            appointmentNumber: 'APT-0001',
            customerName: 'Earlier',
            status: 'SCHEDULED',
            technicianId: 'tech-1',
            scheduledAt: new Date('2026-09-09T09:00:00Z'),
            estimatedDurationMinutes: 30,
          },
        ],
      }),
    );

    expect(rows[0].blocks.map((b) => b.refNumber)).toEqual(['APT-0001', 'APT-0002']);
  });
});
