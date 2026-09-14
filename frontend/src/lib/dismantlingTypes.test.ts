import { describe, expect, it } from 'vitest';
import { canPriceAsUser, canVerifyAsUser, dismantlingPermissions } from './dismantlingTypes';

// 2026-09-14: dismantlingPermissions() takes a has()-style capability checker rather than a
// role name - see dismantlingTypes.ts's own comment. capSet mirrors amcTypes.test.ts's helper.
function capSet(keys: string[]) {
  return (key: string) => keys.includes(key);
}

describe('dismantlingPermissions', () => {
  it('grants only canHarvest (default TECHNICIAN_WORKSHOP membership: DISMANTLING_VIEW + DISMANTLING_HARVEST)', () => {
    expect(dismantlingPermissions(capSet(['DISMANTLING_VIEW', 'DISMANTLING_HARVEST']))).toEqual({ canView: true, canHarvest: true, canVerify: false, canPrice: false });
  });

  it('grants only canHarvest (default TECHNICIAN_FIELD membership)', () => {
    expect(dismantlingPermissions(capSet(['DISMANTLING_VIEW', 'DISMANTLING_HARVEST']))).toEqual({ canView: true, canHarvest: true, canVerify: false, canPrice: false });
  });

  it('grants canHarvest + canVerify but not canPrice (default TECHNICAL_TEAM_LEADER membership)', () => {
    expect(dismantlingPermissions(capSet(['DISMANTLING_VIEW', 'DISMANTLING_HARVEST', 'DISMANTLING_VERIFY']))).toEqual({ canView: true, canHarvest: true, canVerify: true, canPrice: false });
  });

  it('grants only view (default ACCOUNTANT membership: view-only, no action capabilities)', () => {
    expect(dismantlingPermissions(capSet(['DISMANTLING_VIEW']))).toEqual({ canView: true, canHarvest: false, canVerify: false, canPrice: false });
  });

  it('grants only view (default FINANCE_MANAGER membership)', () => {
    expect(dismantlingPermissions(capSet(['DISMANTLING_VIEW']))).toEqual({ canView: true, canHarvest: false, canVerify: false, canPrice: false });
  });

  it('grants everything to a full-access caller (SUPER_ADMIN/SERVICE_HEAD bypass)', () => {
    expect(dismantlingPermissions(() => true)).toEqual({ canView: true, canHarvest: true, canVerify: true, canPrice: true });
  });

  it('denies every flag to a caller with none of the dismantling capabilities', () => {
    expect(dismantlingPermissions(capSet([]))).toEqual({ canView: false, canHarvest: false, canVerify: false, canPrice: false });
  });

  it('grants canPrice to a role holding DISMANTLING_MANAGE via Designation access, even though its catalog defaultRoles is empty', () => {
    // The whole point of this round's fix: DISMANTLING_MANAGE has no default role membership
    // at all (SUPER_ADMIN/SERVICE_HEAD bypass only) - a direct capability grant is the only
    // way any other role ever sees canPrice, proven here independent of role name.
    expect(dismantlingPermissions(capSet(['DISMANTLING_VIEW', 'DISMANTLING_MANAGE']))).toEqual({ canView: true, canHarvest: false, canVerify: false, canPrice: true });
  });
});

describe('canVerifyAsUser (AC-31: verifier must differ from harvester)', () => {
  it('returns false when the current user is the harvester', () => {
    expect(canVerifyAsUser({ harvestedByUserId: 'tech-1' }, 'tech-1')).toBe(false);
  });

  it('returns true when the current user is a different person', () => {
    expect(canVerifyAsUser({ harvestedByUserId: 'tech-1' }, 'lead-1')).toBe(true);
  });

  it('returns true when nothing has been harvested yet (harvestedByUserId is null)', () => {
    expect(canVerifyAsUser({ harvestedByUserId: null }, 'lead-1')).toBe(true);
  });

  it('returns false when the current user id is undefined', () => {
    expect(canVerifyAsUser({ harvestedByUserId: 'tech-1' }, undefined)).toBe(false);
  });
});

describe('canPriceAsUser (AC-31: pricer must differ from BOTH harvester and verifier)', () => {
  it('returns false when the current user is the harvester', () => {
    expect(canPriceAsUser({ harvestedByUserId: 'tech-1', verifiedByUserId: 'lead-1' }, 'tech-1')).toBe(false);
  });

  it('returns false when the current user is the verifier', () => {
    expect(canPriceAsUser({ harvestedByUserId: 'tech-1', verifiedByUserId: 'lead-1' }, 'lead-1')).toBe(false);
  });

  it('returns true when the current user is a third, distinct person', () => {
    expect(canPriceAsUser({ harvestedByUserId: 'tech-1', verifiedByUserId: 'lead-1' }, 'mgr-1')).toBe(true);
  });

  it('returns false when the current user id is undefined', () => {
    expect(canPriceAsUser({ harvestedByUserId: 'tech-1', verifiedByUserId: 'lead-1' }, undefined)).toBe(false);
  });
});
