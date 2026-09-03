// Shapes mirrored from the backend's Appointments + Technician modules
// (src/appointments/entities/appointment.entity.ts, src/appointments/dto/*, and
// src/technician/entities/technician-visit.entity.ts, src/technician/dto/*).

export const APPOINTMENT_TYPES = ['WARRANTY', 'OUT_OF_WARRANTY', 'AMC', 'PREVENTIVE', 'DISMANTLING'] as const;
export type AppointmentTypeValue = (typeof APPOINTMENT_TYPES)[number];

export const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'TECHNICIAN_ASSIGNED',
  'ON_SITE',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
] as const;
export type AppointmentStatusValue = (typeof APPOINTMENT_STATUSES)[number];

export const CUSTOMER_TYPES = ['B2C', 'B2B', 'B2B_SALES_CHANNEL'] as const;
export type CustomerTypeValue = (typeof CUSTOMER_TYPES)[number];

export interface ServiceCentreRef {
  id: string;
  code: string;
  name: string;
}

export interface UserRef {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface Appointment {
  id: string;
  appointmentNumber: string;
  type: AppointmentTypeValue;
  status: AppointmentStatusValue;
  customerType: CustomerTypeValue;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  customerAddress: string | null;
  customerCity: string | null;
  customerCountry: string | null;
  customerVatNumber: string | null;
  brand: string | null;
  modelNumber: string | null;
  serialNumber: string | null;
  purchaseDate: string | null;
  invoiceNumber: string | null;
  problemDescription: string | null;
  preferredDate: string | null;
  preferredTimeSlot: string | null;
  scheduledAt: string;
  estimatedDurationMinutes: number | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  notes: string | null;
  cancellationReason: string | null;
  serviceCentre?: ServiceCentreRef;
  serviceCentreId: string;
  technician?: UserRef | null;
  technicianId: string | null;
  createdBy?: UserRef | null;
  createdById: string | null;
  amcContractId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Matches CreateAppointmentDto exactly - every optional field here is optional there too.
export interface CreateAppointmentInput {
  type: AppointmentTypeValue;
  customerType: CustomerTypeValue;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerAddress?: string;
  customerCity?: string;
  customerCountry?: string;
  customerVatNumber?: string;
  brand?: string;
  modelNumber?: string;
  serialNumber?: string;
  purchaseDate?: string;
  invoiceNumber?: string;
  problemDescription?: string;
  preferredDate?: string;
  preferredTimeSlot?: string;
  scheduledAt: string;
  estimatedDurationMinutes?: number;
  serviceCentreId: string;
  technicianId?: string;
  notes?: string;
}

export interface AppointmentListFilters {
  serviceCentreId?: string;
  technicianId?: string;
  status?: AppointmentStatusValue;
  type?: AppointmentTypeValue;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

export interface AppointmentListResult {
  data: Appointment[];
  total: number;
  page: number;
  limit: number;
}

// Matches AppointmentsService.getDashboardStats()'s real return shape exactly. Despite the
// field name, `week` is a ROLLING 7-day window ending today (today-7d through tomorrow,
// see getDashboardStats()'s own Between() call) - not a calendar week (Mon-Sun or
// Sun-Sat). The dashboard-stats widget deliberately labels this "Last 7 days", not "This
// week", so the number matches what a reader would get counting it by hand.
export interface AppointmentDashboardStats {
  today: { scheduled: number; confirmed: number; onSite: number; completed: number; cancelled: number };
  week: { total: number; byStatus: Record<string, number> };
}

// Same @Roles(...) list as AppointmentsController.getDashboardStats() - a technician or CCE
// booking desk role other than these four never even fires the query (mirrors
// reportsTypes.ts's canViewReports pattern: gated client-side too, not just refused
// server-side).
export const DASHBOARD_STATS_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER', 'CCE'];

export function canViewDashboardStats(roleName: string | undefined): boolean {
  return !!roleName && DASHBOARD_STATS_ROLES.includes(roleName);
}

// === Technician visits (src/technician) ===

export const WARRANTY_STATUSES = ['IW', 'OOW'] as const;
export type WarrantyStatusValue = (typeof WARRANTY_STATUSES)[number];

export interface TechnicianVisit {
  id: string;
  appointmentId: string;
  technicianId: string;
  startGpsLat: number;
  startGpsLng: number;
  startedAt: string;
  serialNumber: string | null;
  brand: string | null;
  warrantyStatus: WarrantyStatusValue | null;
  warrantySupplier: string | null;
  warrantyPeriodMonths: number | null;
  serialNumberCapturedAt: string | null;
  faultCode: string | null;
  symptomCode: string | null;
  faultSymptomCapturedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StartVisitInput {
  gpsLat: number;
  gpsLng: number;
}

export interface CaptureSerialNumberInput {
  serialNumber: string;
  brand?: string;
}

export interface CaptureFaultSymptomInput {
  faultCode: string;
  symptomCode: string;
}
