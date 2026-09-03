import { describe, expect, it } from 'vitest';
import { canViewDashboardStats } from './appointmentsTypes';

describe('canViewDashboardStats', () => {
  it.each([
    ['SUPER_ADMIN', true],
    ['SERVICE_HEAD', true],
    ['TECHNICAL_TEAM_LEADER', true],
    ['CCE', true],
    ['TECHNICIAN_FIELD', false],
    ['TECHNICIAN_WORKSHOP', false],
    ['ACCOUNTANT', false],
    ['FINANCE_MANAGER', false],
    ['LOGISTICS_DISPATCHER', false],
    ['DRIVER', false],
  ])('%s -> %s', (role, expected) => {
    expect(canViewDashboardStats(role)).toBe(expected);
  });

  it('returns false for an undefined role', () => {
    expect(canViewDashboardStats(undefined)).toBe(false);
  });
});
