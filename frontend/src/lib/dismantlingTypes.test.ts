import { describe, expect, it } from 'vitest';
import { canPriceAsUser, canVerifyAsUser, dismantlingPermissions } from './dismantlingTypes';

describe('dismantlingPermissions', () => {
  it('grants only canHarvest to TECHNICIAN_WORKSHOP (a harvester, not a supervisor or manager)', () => {
    expect(dismantlingPermissions('TECHNICIAN_WORKSHOP')).toEqual({ canView: true, canHarvest: true, canVerify: false, canPrice: false });
  });

  it('grants only canHarvest to TECHNICIAN_FIELD', () => {
    expect(dismantlingPermissions('TECHNICIAN_FIELD')).toEqual({ canView: true, canHarvest: true, canVerify: false, canPrice: false });
  });

  it('grants canHarvest + canVerify (but not canPrice) to TECHNICAL_TEAM_LEADER', () => {
    expect(dismantlingPermissions('TECHNICAL_TEAM_LEADER')).toEqual({ canView: true, canHarvest: true, canVerify: true, canPrice: false });
  });

  it('grants only view + billing-adjacent visibility to ACCOUNTANT (view-only, no action roles)', () => {
    expect(dismantlingPermissions('ACCOUNTANT')).toEqual({ canView: true, canHarvest: false, canVerify: false, canPrice: false });
  });

  it('grants only view to FINANCE_MANAGER', () => {
    expect(dismantlingPermissions('FINANCE_MANAGER')).toEqual({ canView: true, canHarvest: false, canVerify: false, canPrice: false });
  });

  it('grants everything to SERVICE_HEAD (in all four arrays)', () => {
    expect(dismantlingPermissions('SERVICE_HEAD')).toEqual({ canView: true, canHarvest: true, canVerify: true, canPrice: true });
  });

  it('grants everything to SUPER_ADMIN', () => {
    expect(dismantlingPermissions('SUPER_ADMIN')).toEqual({ canView: true, canHarvest: true, canVerify: true, canPrice: true });
  });

  it('denies every flag to a role in none of the four arrays', () => {
    expect(dismantlingPermissions('DRIVER')).toEqual({ canView: false, canHarvest: false, canVerify: false, canPrice: false });
  });

  it('denies every flag when roleName is undefined', () => {
    expect(dismantlingPermissions(undefined)).toEqual({ canView: false, canHarvest: false, canVerify: false, canPrice: false });
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
