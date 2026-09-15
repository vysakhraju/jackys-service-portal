import { RoleName } from '../auth/entities/role.entity';
import { WORKSHOP_OWNERSHIP_BYPASS_ROLES, bypassesWorkshopOwnership } from './workshop-ownership.util';

describe('bypassesWorkshopOwnership', () => {
  it('is true for every role in WORKSHOP_OWNERSHIP_BYPASS_ROLES, regardless of the capability flag', () => {
    for (const role of WORKSHOP_OWNERSHIP_BYPASS_ROLES) {
      expect(bypassesWorkshopOwnership(role, false)).toBe(true);
      expect(bypassesWorkshopOwnership(role, true)).toBe(true);
    }
  });

  it('is false for a non-privileged role with no WORKSHOP_ACTION_ANY_JOB capability', () => {
    expect(bypassesWorkshopOwnership(RoleName.CCE, false)).toBe(false);
    expect(bypassesWorkshopOwnership(RoleName.TECHNICIAN_WORKSHOP, false)).toBe(false);
  });

  it('is true for a non-privileged role that DOES hold the WORKSHOP_ACTION_ANY_JOB capability (Modification Request 2026-09-16: CCE end-to-end handling)', () => {
    expect(bypassesWorkshopOwnership(RoleName.CCE, true)).toBe(true);
  });

  it('is false for an undefined role with no capability, and true for an undefined role that somehow holds the capability', () => {
    expect(bypassesWorkshopOwnership(undefined, false)).toBe(false);
    expect(bypassesWorkshopOwnership(undefined, true)).toBe(true);
  });

  it('WORKSHOP_OWNERSHIP_BYPASS_ROLES is exactly SUPER_ADMIN/SERVICE_HEAD/TECHNICAL_TEAM_LEADER - mirrors WorkshopService.assertOwnership()\'s isPrivilegedRole contract', () => {
    expect(WORKSHOP_OWNERSHIP_BYPASS_ROLES).toEqual([RoleName.SUPER_ADMIN, RoleName.SERVICE_HEAD, RoleName.TECHNICAL_TEAM_LEADER]);
  });
});
