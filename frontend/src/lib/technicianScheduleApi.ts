// Thin wrapper over src/technician-schedule/technician-schedule.controller.ts.
import { api } from './api';
import type { GanttBoard } from './technicianScheduleTypes';

export const getGanttBoard = (date: string) =>
  api.get<GanttBoard>('/technician-schedule/gantt', { params: { date } }).then((r) => r.data);
