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

export interface GanttBoard {
  date: string;
  rows: TechnicianScheduleRow[];
}
