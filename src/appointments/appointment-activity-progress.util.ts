import { AppointmentActivity } from './entities/appointment-activity.entity';
import { AppointmentActivityPause } from './entities/appointment-activity-pause.entity';

// Job Type split (2026-09-22) Phase 8 - the "computed, never stored" status for an
// Installation/Delivery Installation appointment's activity, mirroring
// job-card-progress.util.ts's own philosophy for Job Cards. NOT_STARTED covers both "no
// AppointmentActivity row exists yet" and, deliberately, is the only state a REPAIR
// appointment (which never gets one of these rows) would ever resolve to if this were
// called for it - callers gate on the appointment's own jobType before showing this at
// all, so that case is never actually surfaced in the UI.
export type AppointmentActivityStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'PAUSED' | 'FINISHED';

export function computeActivityStatus(
  activity: AppointmentActivity | null,
  openPause: AppointmentActivityPause | null,
): AppointmentActivityStatus {
  if (!activity) return 'NOT_STARTED';
  if (activity.finishedAt) return 'FINISHED';
  if (openPause) return 'PAUSED';
  return 'IN_PROGRESS';
}
