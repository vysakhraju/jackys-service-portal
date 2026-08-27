// Color-coded status pill shared by the Appointments screens - status names come straight
// from the backend's AppointmentStatus/WarrantyStatus enums, not re-worded.
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
};

export function StatusBadge({ status }: { status: string }) {
  const className = COLOR_BY_STATUS[status] ?? 'bg-slate-100 text-slate-600';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {status.replaceAll('_', ' ')}
    </span>
  );
}
