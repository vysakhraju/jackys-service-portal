// Modification Request 2026-09-16: Workshop Queue job rows need a live "hours pending"
// TAT (turnaround time) readout, ticking without a page refresh. Pure, directly-testable
// helpers (this codebase's established *.util.ts convention - no controller/page-level
// test coverage exists, so decision logic like this lives here instead) - the ticking
// itself (setInterval) stays in the page as a small hook, since that part isn't pure.

/** Hours elapsed from `fromIso` to `nowMs` (defaults to Date.now()). Never negative - a
 *  clock skew or same-instant read clamps to 0 rather than showing a negative TAT. */
export function elapsedHours(fromIso: string, nowMs: number = Date.now()): number {
  const fromMs = new Date(fromIso).getTime();
  return Math.max(0, nowMs - fromMs) / 3_600_000;
}

/** Compact "Xh Ym" / "Xh" / "Xm" label for how long a job has been pending. */
export function formatElapsedLabel(fromIso: string, nowMs: number = Date.now()): string {
  const fromMs = new Date(fromIso).getTime();
  const totalMinutes = Math.floor(Math.max(0, nowMs - fromMs) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes}m`;
  }
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}
