import { buildSchedulingGrid, formatOpenDaysRange, DAILY_TECHNICIAN_APPOINTMENT_CAP, type ServiceCentreDaySchedule } from './appointment-scheduling-grid.util';

const OPEN_MON_SAT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STANDARD_DAY: ServiceCentreDaySchedule = {
  isOpen: true,
  startTime: '08:00',
  endTime: '10:00',
  breakStart: '09:00',
  breakEnd: '09:15',
};

describe('formatOpenDaysRange', () => {
  it('collapses a fully contiguous run into "First-Last"', () => {
    expect(formatOpenDaysRange(OPEN_MON_SAT)).toBe('Mon-Sat');
  });

  it('lists non-contiguous days individually', () => {
    expect(formatOpenDaysRange(['Mon', 'Wed', 'Fri'])).toBe('Mon, Wed, Fri');
  });

  it('collapses multiple separate runs independently', () => {
    expect(formatOpenDaysRange(['Mon', 'Tue', 'Thu', 'Fri', 'Sat'])).toBe('Mon-Tue, Thu-Sat');
  });

  it('renders a single open day with no dash', () => {
    expect(formatOpenDaysRange(['Wed'])).toBe('Wed');
  });

  it('renders a clear message when nothing is open', () => {
    expect(formatOpenDaysRange([])).toBe('Closed every day');
  });
});

describe('buildSchedulingGrid', () => {
  it('returns no slots and a "Closed today" label when the day schedule is closed', () => {
    const result = buildSchedulingGrid({
      date: '2026-09-14', // a Monday, but schedule says closed
      daySchedule: { isOpen: false, startTime: '08:00', endTime: '16:00' },
      openDayAbbreviations: OPEN_MON_SAT,
      technicians: [{ id: 'tech-1', name: 'Ravi', appointments: [] }],
    });

    expect(result.isOpen).toBe(false);
    expect(result.rosterLabel).toBe('Mon-Sat · Closed today');
    expect(result.technicians[0].slots).toEqual([]);
  });

  it('treats a missing schedule entry for the weekday the same as closed', () => {
    const result = buildSchedulingGrid({
      date: '2026-09-13', // a Sunday, no entry in the service centre's schedule at all
      daySchedule: null,
      openDayAbbreviations: OPEN_MON_SAT,
      technicians: [{ id: 'tech-1', name: 'Ravi', appointments: [] }],
    });

    expect(result.isOpen).toBe(false);
    expect(result.startTime).toBeNull();
    expect(result.technicians[0].slots).toEqual([]);
  });

  it('generates 15-minute slots across the roster window, none spilling past endTime', () => {
    const result = buildSchedulingGrid({
      date: '2026-09-14',
      daySchedule: { isOpen: true, startTime: '08:00', endTime: '09:00' },
      openDayAbbreviations: OPEN_MON_SAT,
      technicians: [{ id: 'tech-1', name: 'Ravi', appointments: [] }],
    });

    expect(result.technicians[0].slots.map((s) => s.time)).toEqual(['08:00', '08:15', '08:30', '08:45']);
    expect(result.technicians[0].slots.every((s) => s.available)).toBe(true);
    expect(result.rosterLabel).toBe('Mon-Sat 08:00-09:00');
  });

  it('marks slots overlapping an existing appointment as unavailable, leaving the rest free', () => {
    const result = buildSchedulingGrid({
      date: '2026-09-14',
      daySchedule: { isOpen: true, startTime: '08:00', endTime: '10:00' },
      openDayAbbreviations: OPEN_MON_SAT,
      technicians: [
        {
          id: 'tech-1',
          name: 'Ravi',
          appointments: [{ scheduledAt: new Date('2026-09-14T08:30:00.000Z'), estimatedDurationMinutes: 30 }],
        },
      ],
    });

    const byTime = Object.fromEntries(result.technicians[0].slots.map((s) => [s.time, s.available]));
    expect(byTime['08:00']).toBe(true);
    expect(byTime['08:15']).toBe(true);
    // 08:30-09:00 is occupied by the 30-minute appointment starting at 08:30.
    expect(byTime['08:30']).toBe(false);
    expect(byTime['08:45']).toBe(false);
    expect(byTime['09:00']).toBe(true);
  });

  it('falls back to a 60-minute duration when estimatedDurationMinutes is null', () => {
    const result = buildSchedulingGrid({
      date: '2026-09-14',
      daySchedule: { isOpen: true, startTime: '08:00', endTime: '10:00' },
      openDayAbbreviations: OPEN_MON_SAT,
      technicians: [
        {
          id: 'tech-1',
          name: 'Ravi',
          appointments: [{ scheduledAt: new Date('2026-09-14T08:00:00.000Z'), estimatedDurationMinutes: null }],
        },
      ],
    });

    const byTime = Object.fromEntries(result.technicians[0].slots.map((s) => [s.time, s.available]));
    expect(byTime['08:00']).toBe(false);
    expect(byTime['08:45']).toBe(false); // still inside the assumed 60-minute block
    expect(byTime['09:00']).toBe(true); // exactly the end of the 60-minute block, free
  });

  it('greys out every slot in the break window', () => {
    const result = buildSchedulingGrid({
      date: '2026-09-14',
      daySchedule: STANDARD_DAY,
      openDayAbbreviations: OPEN_MON_SAT,
      technicians: [{ id: 'tech-1', name: 'Ravi', appointments: [] }],
    });

    const byTime = Object.fromEntries(result.technicians[0].slots.map((s) => [s.time, s.available]));
    expect(byTime['08:45']).toBe(true);
    expect(byTime['09:00']).toBe(false); // break 09:00-09:15
    expect(byTime['09:15']).toBe(true);
  });

  it(`greys out a technician's entire row once they hit the ${DAILY_TECHNICIAN_APPOINTMENT_CAP}-appointment daily cap, even where their timeline still has gaps`, () => {
    const appointments = Array.from({ length: DAILY_TECHNICIAN_APPOINTMENT_CAP }, (_, i) => ({
      // Six short, widely-spaced 15-minute appointments - plenty of genuine gaps in the
      // timeline - the cap must still grey out the whole row regardless.
      scheduledAt: new Date(`2026-09-14T${String(8 + i).padStart(2, '0')}:00:00.000Z`),
      estimatedDurationMinutes: 15,
    }));
    const result = buildSchedulingGrid({
      date: '2026-09-14',
      daySchedule: { isOpen: true, startTime: '08:00', endTime: '10:00' },
      openDayAbbreviations: OPEN_MON_SAT,
      technicians: [{ id: 'tech-1', name: 'Ravi', appointments }],
    });

    expect(result.technicians[0].atDailyCap).toBe(true);
    expect(result.technicians[0].slots.every((s) => !s.available)).toBe(true);
    // 09:45 falls in a genuine gap - the closest appointment (09:00-09:15) has long ended
    // and the next one (10:00) is outside the displayed window - yet it's still unavailable
    // purely because of the cap, not because anything actually occupies it.
    const byTime = Object.fromEntries(result.technicians[0].slots.map((s) => [s.time, s.available]));
    expect(byTime['09:45']).toBe(false);
  });

  it('keeps technicians independent of each other', () => {
    const result = buildSchedulingGrid({
      date: '2026-09-14',
      daySchedule: { isOpen: true, startTime: '08:00', endTime: '09:00' },
      openDayAbbreviations: OPEN_MON_SAT,
      technicians: [
        { id: 'tech-1', name: 'Ravi', appointments: [{ scheduledAt: new Date('2026-09-14T08:00:00.000Z'), estimatedDurationMinutes: 60 }] },
        { id: 'tech-2', name: 'Fahad', appointments: [] },
      ],
    });

    expect(result.technicians[0].slots.every((s) => !s.available)).toBe(true);
    expect(result.technicians[1].slots.every((s) => s.available)).toBe(true);
  });

  it('produces a full ISO instant per slot on the requested date', () => {
    const result = buildSchedulingGrid({
      date: '2026-09-14',
      daySchedule: { isOpen: true, startTime: '08:00', endTime: '08:15' },
      openDayAbbreviations: OPEN_MON_SAT,
      technicians: [{ id: 'tech-1', name: 'Ravi', appointments: [] }],
    });

    expect(result.technicians[0].slots).toEqual([{ time: '08:00', iso: '2026-09-14T08:00:00.000Z', available: true }]);
  });
});
