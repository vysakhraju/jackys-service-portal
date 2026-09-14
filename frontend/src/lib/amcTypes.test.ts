import { describe, expect, it } from 'vitest';
import { amcPermissions, estimateVisitCount, MAX_GENERATED_VISITS } from './amcTypes';

// 2026-09-14: amcPermissions() was converted from a role-name lookup against four
// hardcoded role arrays to a `has` capability-checker parameter (see amcTypes.ts's own
// comment) - capSet() below builds a `has` matching a default role's real capabilities
// (per capability-catalog.ts's defaultRoles) purely to keep these tests reading the same
// way as before; the function itself no longer knows about role names at all.
function capSet(keys: string[]) {
  return (key: string) => keys.includes(key);
}

describe('amcPermissions', () => {
  it('grants every flag to a full-access caller (SUPER_ADMIN/SERVICE_HEAD bypass)', () => {
    expect(amcPermissions(() => true)).toEqual({ canView: true, canManage: true, canCompleteVisits: true, canBill: true });
  });

  it('grants only management + view to a caller holding CCE-default capabilities (not a technician, not finance)', () => {
    expect(amcPermissions(capSet(['AMC_VIEW', 'AMC_MANAGE']))).toEqual({ canView: true, canManage: true, canCompleteVisits: false, canBill: false });
  });

  it('grants only view + complete-visits to a caller holding TECHNICIAN_FIELD-default capabilities', () => {
    expect(amcPermissions(capSet(['AMC_VIEW', 'AMC_TECHNICIAN_VISIT']))).toEqual({ canView: true, canManage: false, canCompleteVisits: true, canBill: false });
  });

  it('grants only view + complete-visits to a caller holding TECHNICIAN_WORKSHOP-default capabilities', () => {
    expect(amcPermissions(capSet(['AMC_VIEW', 'AMC_TECHNICIAN_VISIT']))).toEqual({ canView: true, canManage: false, canCompleteVisits: true, canBill: false });
  });

  it('grants only view + billing to a caller holding ACCOUNTANT-default capabilities', () => {
    expect(amcPermissions(capSet(['AMC_VIEW', 'AMC_BILLING']))).toEqual({ canView: true, canManage: false, canCompleteVisits: false, canBill: true });
  });

  it('grants only view + billing to a caller holding FINANCE_MANAGER-default capabilities', () => {
    expect(amcPermissions(capSet(['AMC_VIEW', 'AMC_BILLING']))).toEqual({ canView: true, canManage: false, canCompleteVisits: false, canBill: true });
  });

  it('denies every flag to a caller with none of the four capabilities', () => {
    expect(amcPermissions(capSet([]))).toEqual({ canView: false, canManage: false, canCompleteVisits: false, canBill: false });
  });

  it('grants a flag to a role granted its capability via Designation access, not just a default role', () => {
    // The whole point of this round's fix: any capability combination is now possible
    // independent of role name, since the function reads capabilities directly.
    expect(amcPermissions(capSet(['AMC_VIEW', 'AMC_MANAGE', 'AMC_BILLING']))).toEqual({
      canView: true,
      canManage: true,
      canCompleteVisits: false,
      canBill: true,
    });
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
