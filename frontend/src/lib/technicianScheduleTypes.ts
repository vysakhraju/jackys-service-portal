// Shapes mirror src/technician-schedule/technician-schedule.util.ts's TechnicianScheduleRow/
// ScheduleBlock exactly - this is the Gantt-style technician assignment board (2026-09-09).
export type ScheduleBlockType = 'appointment' | 'workshop_job' | 'crew_helper';

export interface ScheduleBlock {
  id: string;
  type: ScheduleBlockType;
  technicianId: string;
  refId: string;
  refNumber: string;
  detail: string;
  status: string;
  startAt: string;
  endAt: string;
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

// Click-to-assign panel (2026-09-09): the "needs a technician" pools the board renders
// above the timeline, one section each - see TechnicianScheduleService.getGanttBoard's own
// doc comment for why Job Cards have no date scoping the way Appointments do.
export interface UnassignedAppointment {
  id: string;
  appointmentNumber: string;
  customerName: string;
  type: string;
  scheduledAt: string;
  estimatedDurationMinutes: number | null;
}

export interface UnassignedJobCard {
  id: string;
  jobCardNumber: string;
  faultCode: string;
  symptomCode: string;
  warrantyStatus: string;
  createdAt: string;
}

export interface GanttBoard {
  date: string;
  rows: TechnicianScheduleRow[];
  unassignedAppointments: UnassignedAppointment[];
  unassignedJobCards: UnassignedJobCard[];
}
