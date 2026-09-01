import { describe, expect, it } from 'vitest';
import { canViewReports, formatAsOf } from './reportsTypes';

describe('canViewReports', () => {
  it.each([
    ['SERVICE_HEAD', true],
    ['SUPER_ADMIN', true],
    ['TECHNICAL_TEAM_LEADER', true],
    ['TECHNICIAN_FIELD', false],
    ['TECHNICIAN_WORKSHOP', false],
    ['ACCOUNTANT', false],
    ['FINANCE_MANAGER', false],
    ['CCE', false],
  ])('%s -> %s', (role, expected) => {
    expect(canViewReports(role)).toBe(expected);
  });

  it('returns false for an undefined role', () => {
    expect(canViewReports(undefined)).toBe(false);
  });
});

describe('formatAsOf', () => {
  it('returns an em-dash for an undefined timestamp', () => {
    expect(formatAsOf(undefined)).toBe('—');
  });

  it('formats a defined ISO timestamp as "as of HH:MM:SS"', () => {
    const result = formatAsOf('2026-09-01T09:00:05Z');
    expect(result).toMatch(/^as of \d{1,2}:\d{2}:\d{2}/);
  });
});
