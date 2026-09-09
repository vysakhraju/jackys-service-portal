// Pure, side-effect-free helper for the Gantt-style technician assignment board
// (2026-09-09) - turns raw rows from three independent sources (Appointments for field
// visits, Job Cards for workshop assignments, JobCardCrewHelper for extra hands on a
// workshop job) into one per-technician timeline, with double-booking conflicts flagged.
//
// Field and workshop assignment are genuinely two different shapes today (see the research
// this was built from): an Appointment has a real scheduledAt + estimatedDurationMinutes,
// while a Job Card's workshop assignment only has a start (workshopAssignedAt) and no
// defined duration - it's occupied until QC passes (qcApprovedAt) or, if still in
// progress, until `now`. Both are normalized into the same {startAt, endAt} shape here so
// one conflict algorithm covers both, rather than two different ones.
export type ScheduleBlockType = 'appointment' | 'workshop_job' | 'crew_helper';

export interface ScheduleBlock {
  id: string;
  type: ScheduleBlockType;
  technicianId: string;
  refId: string;
  refNumber: string;
  detail: string;
  status: string;
  startAt: Date;
  endAt: Date;
  /** True once no defined end exists yet (still WORKSHOP_ASSIGNED/IN_PROGRESS/
   * SPARE_PENDING, or a still-active crew helper) - endAt is `now` in that case, so the
   * block visually runs "to the present moment", not a real known end. */
  ongoing: boolean;
  hasConflict: boolean;
}

export interface TechnicianScheduleRow {
  technicianId: string;
  technicianName: string;
  role: 'TECHNICIAN_FIELD' | 'TECHNICIAN_WORKSHOP';
  blocks: ScheduleBlock[];
  hasConflict: boolean;
}

export interface TechnicianInput {
  id: string;
  name: string;
  role: 'TECHNICIAN_FIELD' | 'TECHNICIAN_WORKSHOP';
}

export interface AppointmentInput {
  id: string;
  appointmentNumber: string;
  customerName: string;
  status: string;
  technicianId: string;
  scheduledAt: Date;
  estimatedDurationMinutes: number | null;
}

export interface WorkshopJobInput {
  id: string;
  jobCardNumber: string;
  status: string;
  assignedWorkshopTechnicianId: string;
  workshopAssignedAt: Date;
  qcApprovedAt: Date | null;
}

export interface CrewHelperInput {
  id: string;
  jobCardId: string;
  jobCardNumber: string;
  jobCardStatus: string;
  technicianId: string;
  addedAt: Date;
  removedAt: Date | null;
  /** The job's own end (same source as WorkshopJobInput.qcApprovedAt) - a helper's block
   * never outlives the job they were helping on. */
  jobQcApprovedAt: Date | null;
}

export interface BuildScheduleInput {
  technicians: TechnicianInput[];
  appointments: AppointmentInput[];
  workshopJobs: WorkshopJobInput[];
  crewHelpers: CrewHelperInput[];
  now: Date;
}

const DEFAULT_APPOINTMENT_DURATION_MINUTES = 60;

function appointmentBlock(a: AppointmentInput): ScheduleBlock {
  const startAt = a.scheduledAt;
  const durationMs = (a.estimatedDurationMinutes ?? DEFAULT_APPOINTMENT_DURATION_MINUTES) * 60_000;
  return {
    id: a.id,
    type: 'appointment',
    technicianId: a.technicianId,
    refId: a.id,
    refNumber: a.appointmentNumber,
    detail: a.customerName,
    status: a.status,
    startAt,
    endAt: new Date(startAt.getTime() + durationMs),
    ongoing: false,
    hasConflict: false,
  };
}

function workshopJobBlock(j: WorkshopJobInput, now: Date): ScheduleBlock {
  const ongoing = !j.qcApprovedAt;
  return {
    id: j.id,
    type: 'workshop_job',
    technicianId: j.assignedWorkshopTechnicianId,
    refId: j.id,
    refNumber: j.jobCardNumber,
    detail: 'Primary assignment',
    status: j.status,
    startAt: j.workshopAssignedAt,
    endAt: j.qcApprovedAt ?? now,
    ongoing,
    hasConflict: false,
  };
}

function crewHelperBlock(h: CrewHelperInput, now: Date): ScheduleBlock {
  const endAt = h.removedAt ?? h.jobQcApprovedAt ?? now;
  return {
    id: h.id,
    type: 'crew_helper',
    technicianId: h.technicianId,
    refId: h.jobCardId,
    refNumber: h.jobCardNumber,
    detail: 'Crew helper',
    status: h.jobCardStatus,
    startAt: h.addedAt,
    endAt,
    ongoing: !h.removedAt && !h.jobQcApprovedAt,
    hasConflict: false,
  };
}

function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** Marks hasConflict on every block that overlaps another block for the SAME technician -
 * mutates the array in place (internal helper, blocks are freshly built above so this is
 * safe/expected), O(n^2) within each technician's own block list which is small (a day's
 * worth of one person's work, never more than a handful of entries). */
function flagConflicts(blocks: ScheduleBlock[]): boolean {
  let anyConflict = false;
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (intervalsOverlap(blocks[i].startAt, blocks[i].endAt, blocks[j].startAt, blocks[j].endAt)) {
        blocks[i].hasConflict = true;
        blocks[j].hasConflict = true;
        anyConflict = true;
      }
    }
  }
  return anyConflict;
}

export function buildTechnicianSchedule(input: BuildScheduleInput): TechnicianScheduleRow[] {
  const { technicians, appointments, workshopJobs, crewHelpers, now } = input;

  const blocksByTechnician = new Map<string, ScheduleBlock[]>();
  const pushBlock = (block: ScheduleBlock) => {
    const existing = blocksByTechnician.get(block.technicianId) ?? [];
    existing.push(block);
    blocksByTechnician.set(block.technicianId, existing);
  };

  appointments.forEach((a) => pushBlock(appointmentBlock(a)));
  workshopJobs.forEach((j) => pushBlock(workshopJobBlock(j, now)));
  crewHelpers.forEach((h) => pushBlock(crewHelperBlock(h, now)));

  return technicians.map((tech) => {
    const blocks = (blocksByTechnician.get(tech.id) ?? []).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    const hasConflict = flagConflicts(blocks);
    return {
      technicianId: tech.id,
      technicianName: tech.name,
      role: tech.role,
      blocks,
      hasConflict,
    };
  });
}
