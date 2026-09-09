// Thin wrappers over the real backend endpoints in src/appointments/appointments.controller.ts
// and src/technician/technician.controller.ts - one function per route actually exposed.
// There is no "list technicians" endpoint anywhere in this app (only GET /auth/profile),
// so technician assignment below takes a pasted user id, the same way the backend's own
// TESTING_GUIDE.md walkthrough does - this isn't a shortcut, it's what the API supports.
import { api } from './api';
import type {
  Appointment,
  AppointmentDashboardStats,
  AppointmentListFilters,
  AppointmentListResult,
  CaptureFaultSymptomInput,
  CaptureSerialNumberInput,
  CreateAppointmentInput,
  ResolvedMapLink,
  StartVisitInput,
  TechnicianVisit,
} from './appointmentsTypes';

const BASE = '/appointments';

// === Appointments (admin/CCE) ===
export const createAppointment = (data: CreateAppointmentInput) =>
  api.post<Appointment>(BASE, data).then((r) => r.data);

export const listAppointments = (filters: AppointmentListFilters) =>
  api
    .get<AppointmentListResult>(BASE, {
      params: {
        serviceCentreId: filters.serviceCentreId || undefined,
        technicianId: filters.technicianId || undefined,
        status: filters.status || undefined,
        type: filters.type || undefined,
        channel: filters.channel || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        page: filters.page,
        limit: filters.limit,
      },
    })
    .then((r) => r.data);

export const getAppointmentDashboardStats = (serviceCentreId?: string) =>
  api
    .get<AppointmentDashboardStats>(`${BASE}/dashboard/stats`, { params: serviceCentreId ? { serviceCentreId } : {} })
    .then((r) => r.data);

export const getAppointment = (id: string) => api.get<Appointment>(`${BASE}/${id}`).then((r) => r.data);

export const getAppointmentByNumber = (appointmentNumber: string) =>
  api.get<Appointment>(`${BASE}/number/${encodeURIComponent(appointmentNumber)}`).then((r) => r.data);

export const updateAppointment = (id: string, data: Partial<CreateAppointmentInput>) =>
  api.put<Appointment>(`${BASE}/${id}`, data).then((r) => r.data);

export const cancelAppointment = (id: string, reason: string) =>
  api.put<Appointment>(`${BASE}/${id}/cancel`, { reason }).then((r) => r.data);

// scheduledAt is optional (2026-09-09, Technician Assignment Board drag-and-drop) - passing
// it sets the appointment's time in the SAME call as the technician assignment, so a fresh
// drag-assign is one atomic backend call rather than assign-then-update, which could
// otherwise leave an appointment assigned to a technician but still on its old time if the
// second call failed.
export const assignTechnician = (id: string, technicianId: string, scheduledAt?: string) =>
  api.put<Appointment>(`${BASE}/${id}/assign-technician`, { technicianId, scheduledAt }).then((r) => r.data);

export const confirmAppointment = (id: string) => api.put<Appointment>(`${BASE}/${id}/confirm`).then((r) => r.data);

export const markAppointmentOnSite = (id: string) => api.put<Appointment>(`${BASE}/${id}/on-site`).then((r) => r.data);

export const completeAppointment = (id: string) => api.put<Appointment>(`${BASE}/${id}/complete`).then((r) => r.data);

export const deleteAppointment = (id: string) => api.delete(`${BASE}/${id}`).then((r) => r.data);

// The user's own idea from the REDTRA360 review call: paste a Google Maps short link
// instead of typing lat/lng by hand. Resolved live (a separate step, like the mobile "Use
// my location" GPS flow), then submitted as plain customerLat/customerLng numbers alongside
// the rest of the create form - see google-maps-link.util.ts for how resolution works.
export const resolveMapLink = (url: string) =>
  api.post<ResolvedMapLink>(`${BASE}/resolve-map-link`, { url }).then((r) => r.data);

// === Technician field view (src/technician) ===
const TECH_BASE = '/technician';

export const getMyTechnicianSchedule = (date?: string) =>
  api.get<Appointment[]>(`${TECH_BASE}/schedule`, { params: date ? { date } : {} }).then((r) => r.data);

export const startVisit = (appointmentId: string, data: StartVisitInput) =>
  api.post<TechnicianVisit>(`${TECH_BASE}/visits/${appointmentId}/start`, data).then((r) => r.data);

export const captureSerialNumber = (appointmentId: string, data: CaptureSerialNumberInput) =>
  api.post<TechnicianVisit>(`${TECH_BASE}/visits/${appointmentId}/serial-number`, data).then((r) => r.data);

export const captureFaultSymptom = (appointmentId: string, data: CaptureFaultSymptomInput) =>
  api.post<TechnicianVisit>(`${TECH_BASE}/visits/${appointmentId}/fault-symptom`, data).then((r) => r.data);

export const getVisit = (appointmentId: string) =>
  api.get<TechnicianVisit>(`${TECH_BASE}/visits/${appointmentId}`).then((r) => r.data);
