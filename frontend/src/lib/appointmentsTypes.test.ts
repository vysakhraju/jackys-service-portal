import { describe, expect, it } from 'vitest';
import { canViewDashboardStats } from './appointmentsTypes';

// 2026-09-14 (Group B): canViewDashboardStats() takes a has()-style capability checker
// rather than a role name - see appointmentsTypes.ts's own comment.
describe('canViewDashboardStats', () => {
  it('returns true when the caller holds SCHEDULE_VIEW_UPDATE', () => {
    expect(canViewDashboardStats((key) => key === 'SCHEDULE_VIEW_UPDATE')).toBe(true);
  });

  it('returns true for a full-access caller (SUPER_ADMIN/SERVICE_HEAD bypass)', () => {
    expect(canViewDashboardStats(() => true)).toBe(true);
  });

  it('returns false for a caller without SCHEDULE_VIEW_UPDATE', () => {
    expect(canViewDashboardStats(() => false)).toBe(false);
  });

  it('returns true for a role granted SCHEDULE_VIEW_UPDATE via Designation access, independent of any other capability held', () => {
    expect(canViewDashboardStats((key) => ['SCHEDULE_VIEW_UPDATE', 'AMC_VIEW'].includes(key))).toBe(true);
  });
});
