import { elapsedHours, formatElapsedLabel, urgencyLevel, URGENCY_COLORS } from './appointmentUrgency';

describe('elapsedHours', () => {
  it('computes hours elapsed between an ISO timestamp and now', () => {
    const from = '2026-09-16T08:00:00Z';
    const now = new Date('2026-09-16T11:30:00Z').getTime();
    expect(elapsedHours(from, now)).toBeCloseTo(3.5, 5);
  });

  it('clamps to 0 rather than going negative when now is before fromIso (clock skew)', () => {
    const from = '2026-09-16T12:00:00Z';
    const now = new Date('2026-09-16T11:00:00Z').getTime();
    expect(elapsedHours(from, now)).toBe(0);
  });
});

describe('formatElapsedLabel', () => {
  it('shows minutes only when under an hour', () => {
    const from = '2026-09-16T08:00:00Z';
    const now = new Date('2026-09-16T08:42:00Z').getTime();
    expect(formatElapsedLabel(from, now)).toBe('42m');
  });

  it('shows hours only when the minute remainder is exactly 0', () => {
    const from = '2026-09-16T08:00:00Z';
    const now = new Date('2026-09-16T11:00:00Z').getTime();
    expect(formatElapsedLabel(from, now)).toBe('3h');
  });

  it('shows both hours and minutes otherwise', () => {
    const from = '2026-09-16T08:00:00Z';
    const now = new Date('2026-09-16T11:17:00Z').getTime();
    expect(formatElapsedLabel(from, now)).toBe('3h 17m');
  });

  it('shows 0m rather than a negative label when now is before fromIso', () => {
    const from = '2026-09-16T12:00:00Z';
    const now = new Date('2026-09-16T11:00:00Z').getTime();
    expect(formatElapsedLabel(from, now)).toBe('0m');
  });
});

describe('urgencyLevel', () => {
  it('is green under 24 hours', () => {
    const from = '2026-09-16T08:00:00Z';
    const now = new Date('2026-09-17T07:59:00Z').getTime();
    expect(urgencyLevel(from, now)).toBe('green');
  });

  it('is amber at exactly 24 hours', () => {
    const from = '2026-09-16T08:00:00Z';
    const now = new Date('2026-09-17T08:00:00Z').getTime();
    expect(urgencyLevel(from, now)).toBe('amber');
  });

  it('is amber just under 72 hours', () => {
    const from = '2026-09-16T08:00:00Z';
    const now = new Date('2026-09-19T07:59:00Z').getTime();
    expect(urgencyLevel(from, now)).toBe('amber');
  });

  it('is red at exactly 72 hours', () => {
    const from = '2026-09-16T08:00:00Z';
    const now = new Date('2026-09-19T08:00:00Z').getTime();
    expect(urgencyLevel(from, now)).toBe('red');
  });

  it('is red well past 72 hours', () => {
    const from = '2026-09-16T08:00:00Z';
    const now = new Date('2026-09-25T08:00:00Z').getTime();
    expect(urgencyLevel(from, now)).toBe('red');
  });

  it('is green (never negative-elapsed) when now is before fromIso', () => {
    const from = '2026-09-16T12:00:00Z';
    const now = new Date('2026-09-16T11:00:00Z').getTime();
    expect(urgencyLevel(from, now)).toBe('green');
  });
});

describe('URGENCY_COLORS', () => {
  it('has a bg/fg pair for every UrgencyLevel', () => {
    expect(URGENCY_COLORS.green).toEqual({ bg: '#dcfce7', fg: '#166534' });
    expect(URGENCY_COLORS.amber).toEqual({ bg: '#fef9c3', fg: '#854d0e' });
    expect(URGENCY_COLORS.red).toEqual({ bg: '#fee2e2', fg: '#991b1b' });
  });
});
