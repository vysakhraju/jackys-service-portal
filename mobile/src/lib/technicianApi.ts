// Thin wrapper over the real backend endpoint, matching the web app's
// src/lib/appointmentsApi.ts one-function-per-route pattern. Only the schedule read is
// needed for Phase 1 - startVisit/captureSerialNumber/captureFaultSymptom land in
// Phase 2/3 alongside the screens that call them.
import { api } from './api';
import type { ScheduledAppointment } from './types';

const TECH_BASE = '/technician';

export const getMySchedule = (date?: string) =>
  api.get<ScheduledAppointment[]>(`${TECH_BASE}/schedule`, { params: date ? { date } : {} }).then((r) => r.data);
