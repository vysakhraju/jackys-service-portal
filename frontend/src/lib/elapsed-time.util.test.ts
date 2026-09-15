import { describe, expect, it } from 'vitest';
import { elapsedHours, formatElapsedLabel } from './elapsed-time.util';

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
