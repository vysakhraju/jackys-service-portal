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

// Unassigned-item panel (2026-09-09): the "needs a technician" pools the board renders
// above the timeline, one section each, both drag sources - see
// TechnicianScheduleService.getGanttBoard's own doc comment for why Job Cards have no date
// scoping the way Appointments do.
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

// Field/workshop scheduling split (2026-09-10) - see
// src/technician-schedule/technician-schedule.service.ts's getWorkshopQueue()/
// getFieldSchedule() for the backend shapes these mirror exactly. The old combined Gantt
// board above (rows/GanttBoard) is untouched and stays live - these are its two
// purpose-built successor views, not a replacement.

export interface WorkshopQueueJob {
  id: string;
  jobCardNumber: string;
  status: string;
  faultCode: string;
  symptomCode: string;
  warrantyStatus: string;
  workshopAssignedAt: string;
}

export interface WorkshopQueueTechnicianRow {
  id: string;
  name: string;
  /** Display-only planning gauge - never enforced server-side. See the entity's own doc comment. */
  capacity: number;
  activeCount: number;
  overCapacity: boolean;
  /** Already FIFO-ordered (oldest workshopAssignedAt first) by the backend. */
  jobs: WorkshopQueueJob[];
}

export interface WorkshopQueueBoard {
  technicians: WorkshopQueueTechnicianRow[];
  unassignedJobCards: UnassignedJobCard[];
}

export interface FieldScheduleAppointment {
  id: string;
  appointmentNumber: string;
  customerName: string;
  status: string;
  scheduledAt: string;
  /** Set by a CCE/TL drag-reorder; null means "never reordered, falls back to time order". */
  priorityOrder: number | null;
  estimatedDurationMinutes: number | null;
}

export interface FieldScheduleTechnicianRow {
  id: string;
  name: string;
  /** Already ordered by priorityOrder (nulls last), then scheduledAt, by the backend. */
  appointments: FieldScheduleAppointment[];
}

export interface FieldScheduleBoard {
  date: string;
  technicians: FieldScheduleTechnicianRow[];
  unassignedAppointments: UnassignedAppointment[];
}
