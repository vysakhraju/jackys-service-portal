// Color-coded status pill shared across the Appointments and Job Cards screens - status
// names come straight from the backend's AppointmentStatus/WarrantyStatus/JobCardStatus
// enums, not re-worded.
const COLOR_BY_STATUS: Record<string, string> = {
  SCHEDULED: 'bg-slate-100 text-slate-600',
  CONFIRMED: 'bg-sky-50 text-sky-700',
  TECHNICIAN_ASSIGNED: 'bg-indigo-50 text-indigo-700',
  ON_SITE: 'bg-amber-50 text-amber-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  CANCELLED: 'bg-red-50 text-red-600',
  NO_SHOW: 'bg-red-50 text-red-600',
  RESCHEDULED: 'bg-amber-50 text-amber-700',
  IW: 'bg-emerald-50 text-emerald-700',
  OOW: 'bg-amber-50 text-amber-700',
  // Job Cards (src/job-cards/entities/job-card.entity.ts's JobCardStatus)
  OPEN: 'bg-slate-100 text-slate-600',
  SN_VALIDATED: 'bg-sky-50 text-sky-700',
  SECTION_ASSIGNED: 'bg-indigo-50 text-indigo-700',
  RWR: 'bg-red-50 text-red-600',
  WORKSHOP_ASSIGNED: 'bg-indigo-50 text-indigo-700',
  IN_PROGRESS: 'bg-amber-50 text-amber-700',
  SPARE_PENDING: 'bg-amber-50 text-amber-700',
  READY_FOR_QC: 'bg-violet-50 text-violet-700',
  QC_PASSED: 'bg-emerald-50 text-emerald-700',
  DELIVERED: 'bg-emerald-50 text-emerald-700',
  // Estimates (src/estimates/entities/estimate.entity.ts's EstimateStatus)
  DRAFT: 'bg-slate-100 text-slate-600',
  SENT: 'bg-sky-50 text-sky-700',
  APPROVED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-red-50 text-red-600',
  EXPIRED: 'bg-slate-100 text-slate-400',
  // Inventory reservations (src/inventory/entities/inventory-reservation.entity.ts's
  // ReservationStatus) - APPROVED/REJECTED above are Estimate-only, reservations never
  // reuse them so there's no collision.
  HELD: 'bg-indigo-50 text-indigo-700',
  PARTIALLY_RESERVED: 'bg-amber-50 text-amber-700',
  RETURN_PENDING: 'bg-sky-50 text-sky-700',
  RETURNED: 'bg-emerald-50 text-emerald-700',
  CONSUMED: 'bg-slate-100 text-slate-500',
};

export function StatusBadge({ status }: { status: string }) {
  const className = COLOR_BY_STATUS[status] ?? 'bg-slate-100 text-slate-600';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {status.replaceAll('_', ' ')}
    </span>
  );
}
