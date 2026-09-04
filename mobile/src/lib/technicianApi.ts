// Thin wrapper over the real backend endpoint, matching the web app's
// src/lib/appointmentsApi.ts one-function-per-route pattern. captureSerialNumber/
// captureFaultSymptom land in Phase 3 alongside the screens that call them.
import { api } from './api';
import type { ScheduledAppointment, StartVisitInput, TechnicianVisit } from './types';

const TECH_BASE = '/technician';

export const getMySchedule = (date?: string) =>
  api.get<ScheduledAppointment[]>(`${TECH_BASE}/schedule`, { params: date ? { date } : {} }).then((r) => r.data);

export const startVisit = (appointmentId: string, data: StartVisitInput) =>
  api.post<TechnicianVisit>(`${TECH_BASE}/visits/${appointmentId}/start`, data).then((r) => r.data);

// 404 means "not started yet" - callers should treat that as expected, not an error to
// surface (mirrors the web app's FieldVisitsPage.tsx `visitNotFound` handling).
export const getVisit = (appointmentId: string) =>
  api.get<TechnicianVisit>(`${TECH_BASE}/visits/${appointmentId}`).then((r) => r.data);
