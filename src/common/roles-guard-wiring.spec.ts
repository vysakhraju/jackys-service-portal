import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Static regression guard for the 2026-09-03 production outage: GlLedgerModule used
 * `@UseGuards(JwtAuthGuard, RolesGuard)` without importing AuthModule. RolesGuard only
 * depended on Reflector (a global provider) before Extra Role Access shipped, so this
 * "just worked" without any module wiring - Nest can construct a guard ad-hoc as long as
 * every constructor param is globally resolvable. Once RolesGuard also started injecting
 * RoleAccessService (an AuthModule-scoped provider), every module using RolesGuard without
 * importing AuthModule became a hard boot-time crash (UnknownDependenciesException), and
 * the whole app - not just that module's routes - refused to start.
 *
 * The existing `*.module.wiring.spec.ts` tests (e.g. permissions.module.wiring.spec.ts)
 * boot one specific module through Nest's real TestingModule and would only have caught
 * this if GlLedgerModule had one too - they don't generalize. This test is cheap and
 * exhaustive instead: for every controller that actually applies `RolesGuard` via
 * `@UseGuards(...)` (not just mentions it in a comment), its sibling `*.module.ts` file
 * must import AuthModule directly - imports are not transitive in Nest, so importing a
 * module that itself imports AuthModule is not enough.
 */
describe('Every module using RolesGuard imports AuthModule', () => {
  const srcDir = join(__dirname, '..');

  function listControllerFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...listControllerFiles(full));
      } else if (entry.isFile() && entry.name.endsWith('.controller.ts')) {
        out.push(full);
      }
    }
    return out;
  }

  function usesRolesGuard(controllerSource: string): boolean {
    // Only look inside actual @UseGuards(...) call parens, not comments/prose mentioning
    // "RolesGuard" (e.g. customer-portal.controller.ts explains in a comment why it
    // deliberately does NOT use RolesGuard - that must not count as usage).
    const useGuardsCalls = controllerSource.match(/@UseGuards\(([\s\S]*?)\)/g) ?? [];
    return useGuardsCalls.some((call) => /\bRolesGuard\b/.test(call));
  }

  function moduleImportsAuthModule(moduleSource: string): boolean {
    return /\bAuthModule\b/.test(moduleSource);
  }

  const controllerFiles = listControllerFiles(srcDir);
  expect(controllerFiles.length).toBeGreaterThan(15); // sanity: the scan actually found the app

  for (const controllerFile of controllerFiles) {
    const dir = controllerFile.slice(0, controllerFile.lastIndexOf('/'));
    const relLabel = controllerFile.replace(srcDir + '/', 'src/');

    it(`${relLabel}`, () => {
      const controllerSource = readFileSync(controllerFile, 'utf-8');
      if (!usesRolesGuard(controllerSource)) {
        return; // this controller doesn't gate on RolesGuard at all - nothing to check
      }

      // AuthModule's own controller uses RolesGuard too and obviously doesn't need to
      // import itself.
      if (dir.endsWith('/auth')) {
        return;
      }

      const moduleFiles = readdirSync(dir).filter((f) => f.endsWith('.module.ts'));
      expect(moduleFiles.length).toBeGreaterThan(0);

      for (const moduleFile of moduleFiles) {
        const moduleSource = readFileSync(join(dir, moduleFile), 'utf-8');
        expect(moduleImportsAuthModule(moduleSource)).toBe(true);
      }
    });
  }
});
