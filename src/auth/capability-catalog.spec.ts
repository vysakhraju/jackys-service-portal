import { CAPABILITY_CATALOG, getMigratedCapability } from './capability-catalog';
import { MIGRATED_CAPABILITIES } from '../../scripts/seed-role-permissions';
import { MATRIX_LOCKED_ROLES } from './entities/role-permission.entity';

describe('capability-catalog', () => {
  const migratedEntries = CAPABILITY_CATALOG.filter((c) => c.migrated);

  it('has at least one migrated capability', () => {
    expect(migratedEntries.length).toBeGreaterThan(0);
  });

  it('never lists a MATRIX_LOCKED_ROLES role in defaultRoles (would be inert)', () => {
    for (const capability of CAPABILITY_CATALOG) {
      for (const role of capability.defaultRoles) {
        expect(MATRIX_LOCKED_ROLES).not.toContain(role);
      }
    }
  });

  it('has unique capability keys', () => {
    const keys = CAPABILITY_CATALOG.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('getMigratedCapability only returns migrated: true entries', () => {
    for (const capability of migratedEntries) {
      expect(getMigratedCapability(capability.key)).toEqual(capability);
    }
    const unmigrated = CAPABILITY_CATALOG.find((c) => !c.migrated);
    if (unmigrated) {
      expect(getMigratedCapability(unmigrated.key)).toBeUndefined();
    }
  });

  // The regression test the seed script's own comment promises: scripts/seed-role-
  // permissions.ts keeps a manually-written copy of this catalog's migrated entries (see
  // that file's own comment for why it doesn't just import this module). If a developer
  // adds or edits a migrated capability here without mirroring it there, npm run
  // seed:role-permissions would silently seed the WRONG default access for real users -
  // this test is what turns that into a loud, immediate test failure instead.
  it('stays in sync with scripts/seed-role-permissions.ts MIGRATED_CAPABILITIES', () => {
    const catalogByKey = new Map(migratedEntries.map((c) => [c.key, new Set(c.defaultRoles)]));
    const seedByKey = new Map(MIGRATED_CAPABILITIES.map((c) => [c.key, new Set(c.defaultRoles)]));

    expect([...seedByKey.keys()].sort()).toEqual([...catalogByKey.keys()].sort());

    for (const [key, catalogRoles] of catalogByKey) {
      const seedRoles = seedByKey.get(key)!;
      expect([...seedRoles].sort()).toEqual([...catalogRoles].sort());
    }
  });
});
