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
  // Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 1) - mobile's "Collection to
  // WS" action lands here, NOT COMPLETED (see AppointmentStatus's own backend doc comment
  // for why). Only reachable server-side today via the web's manual-override action below
  // (mobile itself doesn't build this until Phase 3) or the Phase-1 API directly.
  'COLLECTED_TO_WS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
] as const;
export type AppointmentStatusValue = (typeof APPOINTMENT_STATUSES)[number];

// Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 1) - orthogonal to
// AppointmentTypeValue (coverage: Warranty/AMC/etc), mirrors the new JobType enum on the
// backend entity. Defaults to REPAIR (the DB column default) when omitted.
export const JOB_TYPES = ['REPAIR', 'INSTALLATION', 'DELIVERY_INSTALLATION', 'MAINTENANCE'] as const;
export type JobTypeValue = (typeof JOB_TYPES)[number];

// Informational only (decision #5 in the spec doc) - never used for VAT, which stays
// Service Centre-driven. Mirrors the new AppointmentCountry enum on the backend entity.
export const APPOINTMENT_COUNTRIES = ['UAE', 'KSA'] as const;
export type AppointmentCountryValue = (typeof APPOINTMENT_COUNTRIES)[number];

export const CUSTOMER_TYPES = ['B2C', 'B2B', 'B2B_SALES_CHANNEL'] as const;
export type CustomerTypeValue = (typeof CUSTOMER_TYPES)[number];

// Mirrors AppointmentChannel in src/appointments/entities/appointment.entity.ts - how the
// request came in (Service Desk triage gap from REDTRA360_REVIEW.md).
export const APPOINTMENT_CHANNELS = ['PHONE', 'EMAIL', 'WHATSAPP', 'WALK_IN', 'PORTAL', 'DEALER'] as const;
export type AppointmentChannelValue = (typeof APPOINTMENT_CHANNELS)[number];

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

export interface ApplianceModelRef {
  id: string;
  brand: string;
  model: string;
}

export interface CityRef {
  id: string;
  name: string;
}

export interface Appointment {
  id: string;
  appointmentNumber: string;
  type: AppointmentTypeValue;
  // Phase 1 (2026-09-16) - not returned by every older row until re-saved, but the DB
  // column default (REPAIR) means it's never actually null once read back.
  jobType: JobTypeValue;
  status: AppointmentStatusValue;
  channel: AppointmentChannelValue;
  customerType: CustomerTypeValue;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  customerAddress: string | null;
  customerLat: number | null;
  customerLng: number | null;
  // Old free-text fields - kept for backward-read-compat on appointments created before
  // Phase 2 (2026-09-16); the New Appointment popup now writes cityId/country/
  // applianceModelId below instead. Still read here so an old row's own values show up if
  // its new FK fields were never set.
  customerCity: string | null;
  customerCountry: string | null;
  customerVatNumber: string | null;
  brand: string | null;
  modelNumber: string | null;
  // Phase 1/2 (2026-09-16) - new FK fields, eager-loaded by the backend entity. Nullable:
  // an appointment created before Phase 2, or one where the CCE didn't pick a City/model
  // from the master, has neither.
  cityId: string | null;
  city?: CityRef | null;
  country: AppointmentCountryValue;
  applianceModelId: string | null;
  applianceModel?: ApplianceModelRef | null;
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
  // Partial (id + jobCardNumber only) - present once ANY Job Card has been created for
  // this appointment (on-site or workshop, whatever the reason), which per
  // AppointmentsService.cancel() means the appointment is fulfilled and can no longer be
  // cancelled - control has moved to the Job Card's own lifecycle. Undefined on rows this
  // type is also (ab)used for before the backend attaches it; null once the query ran and
  // found none.
  jobCard?: { id: string; jobCardNumber: string } | null;
  amcContractId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Matches CreateAppointmentDto exactly - every optional field here is optional there too.
export interface CreateAppointmentInput {
  type: AppointmentTypeValue;
  jobType?: JobTypeValue;
  channel?: AppointmentChannelValue;
  customerType: CustomerTypeValue;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerAddress?: string;
  customerLat?: number;
  customerLng?: number;
  // Superseded by cityId below for anything the New Appointment popup writes from Phase 2
  // onward - still accepted by the backend for old-style callers, but this frontend no
  // longer sends it.
  customerCity?: string;
  customerCountry?: string;
  customerVatNumber?: string;
  cityId?: string;
  country?: AppointmentCountryValue;
  // Superseded by applianceModelId below, same reasoning as customerCity.
  brand?: string;
  modelNumber?: string;
  applianceModelId?: string;
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
  channel?: AppointmentChannelValue;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
  /** Free-text search across appointment #, customer name, and phone - see appointmentsApi's searchAppointments(). */
  q?: string;
}

export interface ResolvedMapLink {
  lat: number;
  lng: number;
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

// 2026-09-14 (Group B): AppointmentsController.getDashboardStats() migrated to
// @RequiresCapability('SCHEDULE_VIEW_UPDATE') a while back - this comment's old claim that
// it was "still a plain @Roles() list" went stale then. canViewDashboardStats() now takes a
// has()-style capability checker instead of a role name, same pattern as every other
// converted permissions helper this round, so a role granted SCHEDULE_VIEW_UPDATE via
// Designation access sees the widget too, not just its default role membership.
export function canViewDashboardStats(has: (key: string) => boolean): boolean {
  return has('SCHEDULE_VIEW_UPDATE');
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

// New Appointment scheduling grid (2026-09-09) - the Redtra360-style per-technician grid of
// tappable 15-minute chips, backed by GET /appointments/scheduling-grid. See
// appointment-scheduling-grid.util.ts on the backend for how these are computed - hours come
// from the selected Service Centre's own schedule for that weekday, not a fixed constant.
export interface SchedulingGridSlot {
  time: string; // 'HH:MM', 24h
  iso: string;
  available: boolean;
}

export interface SchedulingGridTechnician {
  id: string;
  name: string;
  appointmentCount: number;
  atDailyCap: boolean;
  slots: SchedulingGridSlot[];
}

export interface SchedulingGrid {
  date: string;
  isOpen: boolean;
  startTime: string | null;
  endTime: string | null;
  breakStart: string | null;
  breakEnd: string | null;
  rosterLabel: string;
  technicians: SchedulingGridTechnician[];
}
