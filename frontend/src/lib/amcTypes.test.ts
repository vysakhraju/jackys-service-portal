import { describe, expect, it } from 'vitest';
import { amcPermissions, estimateVisitCount, MAX_GENERATED_VISITS } from './amcTypes';

describe('amcPermissions', () => {
  it('grants every flag to SUPER_ADMIN', () => {
    expect(amcPermissions('SUPER_ADMIN')).toEqual({ canView: true, canManage: true, canCompleteVisits: true, canBill: true });
  });

  it('grants only management + view to CCE (not a technician, not finance)', () => {
    expect(amcPermissions('CCE')).toEqual({ canView: true, canManage: true, canCompleteVisits: false, canBill: false });
  });

  it('grants only view + complete-visits to TECHNICIAN_FIELD', () => {
    expect(amcPermissions('TECHNICIAN_FIELD')).toEqual({ canView: true, canManage: false, canCompleteVisits: true, canBill: false });
  });

  it('grants only view + complete-visits to TECHNICIAN_WORKSHOP', () => {
    expect(amcPermissions('TECHNICIAN_WORKSHOP')).toEqual({ canView: true, canManage: false, canCompleteVisits: true, canBill: false });
  });

  it('grants only view + billing to ACCOUNTANT', () => {
    expect(amcPermissions('ACCOUNTANT')).toEqual({ canView: true, canManage: false, canCompleteVisits: false, canBill: true });
  });

  it('grants only view + billing to FINANCE_MANAGER', () => {
    expect(amcPermissions('FINANCE_MANAGER')).toEqual({ canView: true, canManage: false, canCompleteVisits: false, canBill: true });
  });

  it('grants everything to SERVICE_HEAD (in all four arrays)', () => {
    expect(amcPermissions('SERVICE_HEAD')).toEqual({ canView: true, canManage: true, canCompleteVisits: true, canBill: true });
  });

  it('denies every flag to a role in none of the four arrays', () => {
    expect(amcPermissions('DRIVER')).toEqual({ canView: false, canManage: false, canCompleteVisits: false, canBill: false });
  });

  it('denies every flag when roleName is undefined', () => {
    expect(amcPermissions(undefined)).toEqual({ canView: false, canManage: false, canCompleteVisits: false, canBill: false });
  });
});

describe('estimateVisitCount', () => {
  it('counts a 12-month QUARTERLY contract as 5 visits (start, +3, +6, +9, +12)', () => {
    expect(estimateVisitCount('2026-09-01', '2027-09-01', 'QUARTERLY')).toBe(5);
  });

  it('counts a 12-month MONTHLY contract as 13 visits', () => {
    expect(estimateVisitCount('2026-09-01', '2027-09-01', 'MONTHLY')).toBe(13);
  });

  it('counts a 12-month HALF_YEARLY contract as 3 visits', () => {
    expect(estimateVisitCount('2026-09-01', '2027-09-01', 'HALF_YEARLY')).toBe(3);
  });

  it('returns null for a missing date', () => {
    expect(estimateVisitCount('', '2027-09-01', 'QUARTERLY')).toBeNull();
    expect(estimateVisitCount('2026-09-01', '', 'QUARTERLY')).toBeNull();
  });

  it('returns null when endDate is not after startDate', () => {
    expect(estimateVisitCount('2027-09-01', '2026-09-01', 'QUARTERLY')).toBeNull();
    expect(estimateVisitCount('2026-09-01', '2026-09-01', 'QUARTERLY')).toBeNull();
  });

  it('exceeds MAX_GENERATED_VISITS for a long MONTHLY contract, matching the backend cap', () => {
    const count = estimateVisitCount('2020-01-01', '2027-01-01', 'MONTHLY');
    expect(count).not.toBeNull();
    expect(count as number).toBeGreaterThan(MAX_GENERATED_VISITS);
  });
});
