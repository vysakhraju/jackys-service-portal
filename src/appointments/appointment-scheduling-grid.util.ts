// Pure, side-effect-free helper for the "New Appointment" scheduling grid (2026-09-09) -
// the Redtra360-style per-technician grid of tappable 15-minute chips shown when creating
// an appointment: a technician's slot renders green (free) or grey ("Busy"), and tapping a
// consecutive run of green chips picks both the technician and the visit's start time +
// duration in one motion.
//
// There is no per-technician shift/roster table anywhere in this codebase (checked before
// building this) - only what ServiceCentre.schedule already stores per weekday
// (isOpen/startTime/endTime/breakStart/breakEnd/maxJobsPerDay, used today for the
// service-centre-wide capacity check in AppointmentsService.checkCapacity()). Per your
// call this session: the grid's hours come from the SELECTED service centre's own schedule
// for that weekday (not a hardcoded "Mon-Sat 08:00-16:00"), and a slot is "Busy" for a
// reason beyond just an overlapping appointment - a technician who already has
// DAILY_TECHNICIAN_APPOINTMENT_CAP appointments that day greys out entirely, even where
// their timeline still shows a gap (your choice: 6/day).
export const DAILY_TECHNICIAN_APPOINTMENT_CAP = 6;

const SLOT_MINUTES = 15;
const DEFAULT_APPOINTMENT_DURATION_MINUTES = 60; // Same fallback AppointmentsService.checkCapacity()/checkTechnicianAvailability() already use.

// Monday-first, matching how Redtra's own "Mon-Sat" roster badge reads - this is only the
// order slots are considered in when collapsing the open-days badge below, not a claim
// about which day the week "starts" on for any other purpose in this app.
const WEEKDAY_BADGE_ORDER: { key: string; abbr: string }[] = [
  { key: 'monday', abbr: 'Mon' },
  { key: 'tuesday', abbr: 'Tue' },
  { key: 'wednesday', abbr: 'Wed' },
  { key: 'thursday', abbr: 'Thu' },
  { key: 'friday', abbr: 'Fri' },
  { key: 'saturday', abbr: 'Sat' },
  { key: 'sunday', abbr: 'Sun' },
];

export interface ServiceCentreDaySchedule {
  isOpen: boolean;
  startTime: string; // 'HH:MM', 24h
  endTime: string;
  breakStart?: string | null;
  breakEnd?: string | null;
  maxJobsPerDay?: number;
}

export interface SchedulingGridAppointmentInput {
  scheduledAt: Date;
  estimatedDurationMinutes: number | null;
}

export interface SchedulingGridTechnicianInput {
  id: string;
  name: string;
  /** This technician's own active appointments already on the selected date - used both to
   * grey out overlapping slots and to check the daily cap. */
  appointments: SchedulingGridAppointmentInput[];
}

export interface SchedulingGridInput {
  /** 'YYYY-MM-DD', the calendar date the grid is being built for. */
  date: string;
  /** The selected service centre's schedule entry for that date's weekday, or null if the
   * service centre's schedule jsonb has no entry for that weekday at all (treated the same
   * as closed - there's nothing to build a grid from). */
  daySchedule: ServiceCentreDaySchedule | null;
  /** Every weekday abbreviation (Monday-first) the service centre has isOpen: true for,
   * regardless of the selected date - purely for the roster badge, e.g. "Mon-Sat". */
  openDayAbbreviations: string[];
  technicians: SchedulingGridTechnicianInput[];
}

export interface SchedulingGridSlot {
  time: string; // 'HH:MM'
  iso: string;
  available: boolean;
}

export interface SchedulingGridTechnicianResult {
  id: string;
  name: string;
  appointmentCount: number;
  atDailyCap: boolean;
  slots: SchedulingGridSlot[];
}

export interface SchedulingGridResult {
  date: string;
  isOpen: boolean;
  startTime: string | null;
  endTime: string | null;
  breakStart: string | null;
  breakEnd: string | null;
  /** e.g. "Mon-Sat 08:00-16:00" when the centre is open today, or the same range with a
   * "Closed today" suffix when it isn't - always reflects the centre's real schedule, never
   * a fixed constant. */
  rosterLabel: string;
  technicians: SchedulingGridTechnicianResult[];
}

function timeStringToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTimeString(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function slotIso(date: string, totalMinutes: number): string {
  return `${date}T${minutesToTimeString(totalMinutes)}:00.000Z`;
}

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// Collapses an ordered list of open-day abbreviations into "First-Last" runs, e.g.
// ['Mon','Tue','Wed','Thu','Fri','Sat'] -> "Mon-Sat", or ['Mon','Wed','Fri'] ->
// "Mon, Wed, Fri" when the open days aren't one contiguous block. Matches Redtra's own
// "Mon-Sat" badge for the common contiguous case, without hardcoding which days those are.
export function formatOpenDaysRange(orderedOpenAbbreviations: string[]): string {
  if (orderedOpenAbbreviations.length === 0) return 'Closed every day';
  const runs: string[][] = [];
  for (const abbr of orderedOpenAbbreviations) {
    const currentRun = runs[runs.length - 1];
    const isConsecutive =
      currentRun &&
      WEEKDAY_BADGE_ORDER.findIndex((d) => d.abbr === abbr) ===
        WEEKDAY_BADGE_ORDER.findIndex((d) => d.abbr === currentRun[currentRun.length - 1]) + 1;
    if (isConsecutive) {
      currentRun.push(abbr);
    } else {
      runs.push([abbr]);
    }
  }
  return runs.map((run) => (run.length > 1 ? `${run[0]}-${run[run.length - 1]}` : run[0])).join(', ');
}

export function buildSchedulingGrid(input: SchedulingGridInput): SchedulingGridResult {
  const { date, daySchedule, openDayAbbreviations, technicians } = input;
  const rosterDays = formatOpenDaysRange(openDayAbbreviations);
  const isOpen = !!daySchedule?.isOpen;

  if (!daySchedule || !isOpen) {
    return {
      date,
      isOpen: false,
      startTime: daySchedule?.startTime ?? null,
      endTime: daySchedule?.endTime ?? null,
      breakStart: daySchedule?.breakStart ?? null,
      breakEnd: daySchedule?.breakEnd ?? null,
      rosterLabel: `${rosterDays} · Closed today`,
      technicians: technicians.map((t) => ({
        id: t.id,
        name: t.name,
        appointmentCount: t.appointments.length,
        atDailyCap: t.appointments.length >= DAILY_TECHNICIAN_APPOINTMENT_CAP,
        slots: [],
      })),
    };
  }

  const startMinutes = timeStringToMinutes(daySchedule.startTime);
  const endMinutes = timeStringToMinutes(daySchedule.endTime);
  const breakStartMinutes = daySchedule.breakStart ? timeStringToMinutes(daySchedule.breakStart) : null;
  const breakEndMinutes = daySchedule.breakEnd ? timeStringToMinutes(daySchedule.breakEnd) : null;

  const slotStarts: number[] = [];
  for (let m = startMinutes; m + SLOT_MINUTES <= endMinutes; m += SLOT_MINUTES) {
    slotStarts.push(m);
  }

  const technicianResults: SchedulingGridTechnicianResult[] = technicians.map((tech) => {
    const atDailyCap = tech.appointments.length >= DAILY_TECHNICIAN_APPOINTMENT_CAP;
    const busyWindows = tech.appointments.map((a) => {
      const start = a.scheduledAt.getUTCHours() * 60 + a.scheduledAt.getUTCMinutes();
      const duration = a.estimatedDurationMinutes ?? DEFAULT_APPOINTMENT_DURATION_MINUTES;
      return { start, end: start + duration };
    });

    const slots: SchedulingGridSlot[] = slotStarts.map((slotStart) => {
      const slotEnd = slotStart + SLOT_MINUTES;
      const onBreak = breakStartMinutes !== null && breakEndMinutes !== null && intervalsOverlap(slotStart, slotEnd, breakStartMinutes, breakEndMinutes);
      const busy = !atDailyCap && !onBreak && busyWindows.some((w) => intervalsOverlap(slotStart, slotEnd, w.start, w.end));
      const available = !atDailyCap && !onBreak && !busy;
      return { time: minutesToTimeString(slotStart), iso: slotIso(date, slotStart), available };
    });

    return { id: tech.id, name: tech.name, appointmentCount: tech.appointments.length, atDailyCap, slots };
  });

  return {
    date,
    isOpen: true,
    startTime: daySchedule.startTime,
    endTime: daySchedule.endTime,
    breakStart: daySchedule.breakStart ?? null,
    breakEnd: daySchedule.breakEnd ?? null,
    rosterLabel: `${rosterDays} ${daySchedule.startTime}-${daySchedule.endTime}`,
    technicians: technicianResults,
  };
}
