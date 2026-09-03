// Shapes mirrored from the backend's real DTOs/entities - kept in lockstep with the
// same source of truth the web app's src/lib/types.ts and src/lib/appointmentsTypes.ts
// already use (src/auth/entities, src/appointments/entities, src/technician/entities
// on the API side). Only what this app's v1 scope actually touches is included here;
// extend as later phases need more of the API surface.

export interface Role {
  id: string;
  name: string; // e.g. "TECHNICIAN_FIELD" - see backend RoleName enum
  displayName: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
}

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  employeeId: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  role: Role;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  user: User;
}

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

// Today's Schedule (GET /technician/schedule) only needs a subset of the full
// Appointment entity - trimmed here to what the schedule list/detail screens show.
// Widen this (matching the web app's fuller AppointmentsTypes.Appointment) if a later
// phase's screen needs more fields.
export interface ScheduledAppointment {
  id: string;
  appointmentNumber: string;
  status: AppointmentStatusValue;
  customerName: string;
  customerPhone: string;
  customerAddress: string | null;
  customerCity: string | null;
  brand: string | null;
  modelNumber: string | null;
  problemDescription: string | null;
  scheduledAt: string;
  estimatedDurationMinutes: number | null;
}
