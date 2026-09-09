/**
 * Trims the repeated-testing debris out of the users table: months of running
 * `npm run seed:technician` (and creating accounts by hand) with the same default
 * first/last name has left many roles with a wall of identically-named "Test
 * Technician" / "Test Supervisor" rows that are impossible to tell apart in any
 * picker (e.g. the Service Centre "Field technicians" checklist).
 *
 * What this does, per role:
 *   - SUPER_ADMIN: keeps exactly 1 account - the one whose email matches
 *     KEEP_SUPER_ADMIN_EMAIL. If that env var isn't set, or doesn't match any
 *     SUPER_ADMIN in the database, this script deliberately does NOT touch
 *     SUPER_ADMIN at all (every other role is still cleaned up) - there is no
 *     safe way to guess which admin account you actually log in with, and
 *     guessing wrong would lock you out.
 *   - Every other role (except CUSTOMER, which isn't a staff role managed here):
 *     keeps the 2 oldest ACTIVE accounts, renamed to "<Role display name> 1" and
 *     "<Role display name> 2" so they're finally distinguishable in a picker.
 *   - Every other ACTIVE account beyond that keep-set is DEACTIVATED (status set
 *     to INACTIVE), never deleted. This app has no delete-user feature anywhere,
 *     specifically because a user referenced by an old appointment, job card, or
 *     audit log entry can't be safely deleted without touching real business
 *     records - deactivating is the same trim with none of that risk, and every
 *     already-active list/picker in this app already filters status = ACTIVE,
 *     so deactivated rows simply stop showing up. Nothing about appointments,
 *     job cards, or audit history changes, and any deactivated account can be
 *     reactivated again from the Users page if you decide you need it back.
 *
 * This is a DRY RUN by default - it only prints what it would do. Re-run with
 * APPLY=true to actually write the changes, inside one transaction (all-or-
 * nothing - if anything goes wrong partway through, nothing is committed).
 *
 * Usage:
 *   npm run cleanup:users                                    (dry run, all roles)
 *   KEEP_SUPER_ADMIN_EMAIL=you@jackys.com npm run cleanup:users     (dry run, admin included)
 *   APPLY=true KEEP_SUPER_ADMIN_EMAIL=you@jackys.com npm run cleanup:users   (applies it)
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';

const KEEP_COUNT_DEFAULT = 2;
const EXCLUDED_ROLES = new Set(['CUSTOMER']);

function loadEnvFile(): void {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

interface UserRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
  createdAt: string;
}

async function main(): Promise<void> {
  loadEnvFile();
  const apply = process.env.APPLY === 'true';
  const keepAdminEmail = (process.env.KEEP_SUPER_ADMIN_EMAIL || '').trim().toLowerCase();

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'jackys_service_portal',
  });

  await client.connect();

  try {
    const rolesRes = await client.query<{ id: string; name: string; displayName: string }>(
      `SELECT id, name, "displayName" FROM roles ORDER BY name`,
    );

    console.log(apply ? '=== APPLYING (this will write changes) ===' : '=== DRY RUN (no changes will be made - re-run with APPLY=true to apply) ===');
    console.log('');

    const toDeactivate: string[] = [];
    const toRename: { id: string; firstName: string; lastName: string }[] = [];
    let adminSkipped = false;

    for (const role of rolesRes.rows) {
      if (EXCLUDED_ROLES.has(role.name)) continue;

      const usersRes = await client.query<UserRow>(
        `SELECT id, "firstName", "lastName", email, status, "createdAt"
         FROM users WHERE "roleId" = $1 ORDER BY "createdAt" ASC`,
        [role.id],
      );
      const users = usersRes.rows;
      if (users.length === 0) continue;

      const isSuperAdmin = role.name === 'SUPER_ADMIN';
      const keepCount = isSuperAdmin ? 1 : KEEP_COUNT_DEFAULT;
      const active = users.filter((u) => u.status === 'ACTIVE');

      console.log(`--- ${role.displayName || role.name} (${users.length} total, ${active.length} active) ---`);

      if (isSuperAdmin) {
        if (!keepAdminEmail) {
          console.log('  Skipping SUPER_ADMIN entirely - KEEP_SUPER_ADMIN_EMAIL not set. Accounts:');
          for (const u of active) console.log(`    ${u.email}  (${u.firstName} ${u.lastName})`);
          console.log('  Re-run with KEEP_SUPER_ADMIN_EMAIL=<the email you log in with> to clean this role up too.');
          adminSkipped = true;
          console.log('');
          continue;
        }
        const match = active.find((u) => u.email.toLowerCase() === keepAdminEmail);
        if (!match) {
          console.log(`  KEEP_SUPER_ADMIN_EMAIL="${keepAdminEmail}" does not match any active SUPER_ADMIN account. Accounts:`);
          for (const u of active) console.log(`    ${u.email}  (${u.firstName} ${u.lastName})`);
          console.log('  Aborting the whole script without changing anything, rather than guessing which admin to keep.');
          process.exit(1);
        }
        console.log(`  Keeping: ${match.email} (${match.firstName} ${match.lastName}) - untouched, not renamed.`);
        for (const u of active) {
          if (u.id !== match.id) {
            console.log(`  Deactivating: ${u.email} (${u.firstName} ${u.lastName})`);
            toDeactivate.push(u.id);
          }
        }
        console.log('');
        continue;
      }

      const keep = active.slice(0, keepCount);
      const rest = active.slice(keepCount);
      const label = role.displayName || role.name;
      let renameCounter = 0;
      keep.forEach((u) => {
        // Only overwrite the placeholder names this cleanup exists to fix. An account that
        // already has a real, distinct name (someone typed it in by hand instead of using the
        // seed script's default) is left completely alone - renaming it to "<Role> N" would
        // erase a real name for no reason.
        if (u.firstName.trim().toLowerCase() !== 'test') {
          console.log(`  Keeping (already named, left as-is): ${u.firstName} ${u.lastName}  (${u.email})`);
          return;
        }
        renameCounter += 1;
        const newFirst = label;
        const newLast = String(renameCounter);
        console.log(`  Keeping + renaming: ${u.firstName} ${u.lastName} -> "${newFirst} ${newLast}"  (${u.email})`);
        toRename.push({ id: u.id, firstName: newFirst, lastName: newLast });
      });
      for (const u of rest) {
        console.log(`  Deactivating: ${u.firstName} ${u.lastName}  (${u.email})`);
        toDeactivate.push(u.id);
      }
      console.log('');
    }

    // Informational only - deactivating never touches these, but it's worth showing you
    // that the old test data these accounts created stays completely intact.
    if (toDeactivate.length > 0) {
      const apptCount = await client.query(
        `SELECT COUNT(*)::int AS c FROM appointments WHERE "technicianId" = ANY($1::uuid[])`,
        [toDeactivate],
      );
      const jobCardCount = await client.query(
        `SELECT COUNT(*)::int AS c FROM job_cards WHERE "assignedWorkshopTechnicianId" = ANY($1::uuid[])`,
        [toDeactivate],
      );
      console.log(
        `FYI: the accounts being deactivated are referenced by ${apptCount.rows[0].c} appointment(s) and ` +
          `${jobCardCount.rows[0].c} job card(s) - none of that history is touched. Deactivating only hides ` +
          `them from active pickers going forward.`,
      );
      console.log('');
    }

    console.log(`Summary: ${toRename.length} account(s) to rename, ${toDeactivate.length} account(s) to deactivate.`);
    if (adminSkipped) console.log('SUPER_ADMIN was left untouched (see above).');

    if (!apply) {
      console.log('');
      console.log('Nothing was changed - this was a dry run. Re-run with APPLY=true to apply it.');
      return;
    }

    await client.query('BEGIN');
    try {
      for (const u of toRename) {
        await client.query(`UPDATE users SET "firstName" = $1, "lastName" = $2 WHERE id = $3`, [u.firstName, u.lastName, u.id]);
      }
      if (toDeactivate.length > 0) {
        await client.query(`UPDATE users SET status = 'INACTIVE' WHERE id = ANY($1::uuid[])`, [toDeactivate]);
      }
      await client.query('COMMIT');
      console.log('');
      console.log('Applied.');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('cleanup-test-users failed:', err);
  process.exit(1);
});
