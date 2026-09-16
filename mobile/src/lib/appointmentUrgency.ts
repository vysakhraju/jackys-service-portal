// Mobile Phase 3 (dashboard color coding), req. 3's own flagged open decision -
// "confirm exact anchor timestamp during build." Resolved to `scheduledAt` alone:
// ScheduledAppointment (types.ts) has no separate "assigned" timestamp to anchor on
// instead, and the web app's own elapsed-time.util.ts (mirrored below) already treats
// a single ISO timestamp as its one input, so this keeps both apps' notion of "how long
// has this been pending" identical in shape even though the bucket thresholds here are
// mobile-dashboard-specific.
//
// Buckets, per the spec: green under 24h, amber 24-72h, red 72h and over.

export type UrgencyLevel = 'green' | 'amber' | 'red';

export function elapsedHours(fromIso: string, nowMs: number = Date.now()): number {
  const fromMs = new Date(fromIso).getTime();
  return Math.max(0, nowMs - fromMs) / 3_600_000;
}

export function formatElapsedLabel(fromIso: string, nowMs: number = Date.now()): string {
  const fromMs = new Date(fromIso).getTime();
  const totalMinutes = Math.floor(Math.max(0, nowMs - fromMs) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function urgencyLevel(fromIso: string, nowMs: number = Date.now()): UrgencyLevel {
  const hours = elapsedHours(fromIso, nowMs);
  if (hours >= 72) return 'red';
  if (hours >= 24) return 'amber';
  return 'green';
}

// Same bg/fg convention StatusPill.tsx already uses (deliberately reusing its exact
// green/amber/red hex pairs - ON_SITE's amber and CANCELLED's red - so the dashboard's
// color language stays consistent with every other status color in the app rather than
// inventing a fourth palette).
export const URGENCY_COLORS: Record<UrgencyLevel, { bg: string; fg: string }> = {
  green: { bg: '#dcfce7', fg: '#166534' },
  amber: { bg: '#fef9c3', fg: '#854d0e' },
  red: { bg: '#fee2e2', fg: '#991b1b' },
};
