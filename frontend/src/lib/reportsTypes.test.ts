import { describe, expect, it } from 'vitest';
import { formatAsOf } from './reportsTypes';

// canViewReports()/canViewFinanceReports() were removed 2026-09-14 - each Reports &
// Dashboards page now checks its own designation-matrix capability directly via
// useMyCapabilities(); see ReportsPage.test.tsx/QualityReportsPage.test.tsx/
// OperationalReportsPage.test.tsx/FinanceReportsPage.test.tsx for that coverage.

describe('formatAsOf', () => {
  it('returns an em-dash for an undefined timestamp', () => {
    expect(formatAsOf(undefined)).toBe('—');
  });

  it('formats a defined ISO timestamp as "as of HH:MM:SS"', () => {
    const result = formatAsOf('2026-09-01T09:00:05Z');
    expect(result).toMatch(/^as of \d{1,2}:\d{2}:\d{2}/);
  });
});
