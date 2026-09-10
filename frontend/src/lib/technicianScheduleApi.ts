// Thin wrapper over src/technician-schedule/technician-schedule.controller.ts.
import { api } from './api';
import type { FieldScheduleBoard, GanttBoard, WorkshopQueueBoard } from './technicianScheduleTypes';

export const getGanttBoard = (date: string) =>
  api.get<GanttBoard>('/technician-schedule/gantt', { params: { date } }).then((r) => r.data);

// Field/workshop scheduling split (2026-09-10) - see technicianScheduleTypes.ts's own header
// comment. getGanttBoard() above is untouched.

export const getWorkshopQueue = () =>
  api.get<WorkshopQueueBoard>('/technician-schedule/workshop-queue').then((r) => r.data);

export const setWorkshopCapacity = (technicianId: string, capacity: number) =>
  api
    .patch<{ id: string; workshopDailyCapacity: number }>(
      `/technician-schedule/workshop-queue/technicians/${technicianId}/capacity`,
      { capacity },
    )
    .then((r) => r.data);

export const getFieldSchedule = (date: string) =>
  api.get<FieldScheduleBoard>('/technician-schedule/field-schedule', { params: { date } }).then((r) => r.data);

export const reorderFieldSchedule = (technicianId: string, orderedAppointmentIds: string[]) =>
  api
    .post('/technician-schedule/field/reorder', { technicianId, orderedAppointmentIds })
    .then((r) => r.data);
