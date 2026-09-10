/**
 * Seeds the designation permission matrix (RolePermission) so that migrating a module onto
 * @RequiresCapability() is a zero-behaviour-change event: every role that could already do
 * something via the old hardcoded @Roles() array gets the equivalent RolePermission row,
 * and nothing else does.
 *
 * Self-contained on purpose, like every other script in this folder (seed-admin.ts,
 * seed-technician.ts, cleanup-test-users.ts) - raw `pg.Client`, no NestJS/TypeORM bootstrap.
 * The capability list below is a deliberate, manually-kept-in-sync COPY of
 * src/auth/capability-catalog.ts's `migrated: true` entries, not an import of it - importing
 * would pull in the full entity graph (role.entity.ts -> user.entity.ts -> ...) just for a
 * few literal arrays, adding real crash risk to a script whose whole job is to be the one
 * thing that still works when the app itself is broken. If you add or change a migrated
 * capability in capability-catalog.ts, mirror the change here too - a coverage test in
 * capability-catalog.spec.ts (see role-permissions tests) fails if the two ever drift.
 *
 * INSERT-IF-MISSING ONLY - never touches a row that already exists, so a previously-applied
 * admin edit (including an admin UNCHECKING a default) is never silently reverted by
 * re-running this. Safe to run repeatedly, including after adding a new migrated capability.
 *
 * Usage:
 *   npm run seed:role-permissions
 *
 * MIGRATED_CAPABILITIES's sync with capability-catalog.ts is enforced by
 * src/auth/capability-catalog.spec.ts, not just this comment - that test imports both and
 * fails the build if they ever drift.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';

// MUST mirror capability-catalog.ts's `migrated: true` entries exactly (key + defaultRoles).
// defaultRoles is each entry's original @Roles() membership MINUS SUPER_ADMIN/SERVICE_HEAD -
// those two always pass via RolesGuard's hardcoded MATRIX_LOCKED_ROLES bypass, so a row for
// either here would be inert, confusing data (and this script skips them defensively too,
// in case this list is ever hand-edited to include one by mistake).
export const MIGRATED_CAPABILITIES: { key: string; defaultRoles: string[] }[] = [
  { key: 'SCHEDULE_CCE_MANAGE', defaultRoles: ['CCE'] },
  { key: 'SCHEDULE_VIEW_UPDATE', defaultRoles: ['CCE', 'TECHNICAL_TEAM_LEADER'] },
  { key: 'SCHEDULE_ASSIGN_TECHNICIAN', defaultRoles: ['TECHNICAL_TEAM_LEADER'] },
  { key: 'SCHEDULE_FIELD_VISIT', defaultRoles: ['TECHNICAL_TEAM_LEADER', 'TECHNICIAN_FIELD'] },
  { key: 'QC_GATE_ACCESS', defaultRoles: ['TECHNICAL_TEAM_LEADER', 'CCE', 'QC_OFFICER'] },
  { key: 'JOB_CARD_MANAGE', defaultRoles: ['TECHNICAL_TEAM_LEADER', 'CCE'] },
  { key: 'JOB_CARD_WARRANTY_OVERRIDE', defaultRoles: ['TECHNICAL_TEAM_LEADER'] },
  { key: 'JOB_CARD_TASK_PAUSE', defaultRoles: ['TECHNICAL_TEAM_LEADER', 'CCE', 'TECHNICIAN_FIELD', 'TECHNICIAN_WORKSHOP'] },
  { key: 'WORKSHOP_ASSIGN', defaultRoles: ['TECHNICAL_TEAM_LEADER'] },
  { key: 'WORKSHOP_ACTION', defaultRoles: ['TECHNICAL_TEAM_LEADER', 'TECHNICIAN_WORKSHOP'] },
  { key: 'WORKSHOP_VIEW', defaultRoles: ['TECHNICAL_TEAM_LEADER', 'TECHNICIAN_WORKSHOP', 'CCE'] },
  { key: 'AMC_MANAGE', defaultRoles: ['CCE'] },
  { key: 'AMC_VIEW', defaultRoles: ['CCE', 'TECHNICIAN_FIELD', 'TECHNICIAN_WORKSHOP', 'ACCOUNTANT', 'FINANCE_MANAGER'] },
  { key: 'AMC_TECHNICIAN_VISIT', defaultRoles: ['TECHNICIAN_FIELD', 'TECHNICIAN_WORKSHOP'] },
  { key: 'AMC_BILLING', defaultRoles: ['ACCOUNTANT', 'FINANCE_MANAGER'] },
  { key: 'INVENTORY_STAFF', defaultRoles: ['WAREHOUSE_CLERK'] },
  { key: 'INVENTORY_REVIEW', defaultRoles: ['TECHNICAL_TEAM_LEADER'] },
  { key: 'INVENTORY_VIEW', defaultRoles: ['WAREHOUSE_CLERK', 'TECHNICAL_TEAM_LEADER', 'CCE'] },
  { key: 'INVENTORY_RETURN_REQUEST', defaultRoles: ['TECHNICAL_TEAM_LEADER', 'TECHNICIAN_WORKSHOP', 'TECHNICIAN_FIELD'] },
  { key: 'DELIVERY_MANAGE', defaultRoles: ['LOGISTICS_DISPATCHER', 'DRIVER'] },
  { key: 'INVOICING_MANAGE', defaultRoles: ['ACCOUNTANT', 'FINANCE_MANAGER'] },
  { key: 'INVOICING_JOB_CARD_VIEW', defaultRoles: ['ACCOUNTANT', 'FINANCE_MANAGER', 'LOGISTICS_DISPATCHER', 'DRIVER'] },
  { key: 'DISMANTLING_HARVEST', defaultRoles: ['TECHNICIAN_WORKSHOP', 'TECHNICIAN_FIELD', 'TECHNICAL_TEAM_LEADER'] },
  { key: 'DISMANTLING_VERIFY', defaultRoles: ['TECHNICAL_TEAM_LEADER'] },
  { key: 'DISMANTLING_MANAGE', defaultRoles: [] },
  { key: 'DISMANTLING_VIEW', defaultRoles: ['TECHNICAL_TEAM_LEADER', 'TECHNICIAN_FIELD', 'TECHNICIAN_WORKSHOP', 'ACCOUNTANT', 'FINANCE_MANAGER'] },
  { key: 'WARRANTY_CLAIMS_CLERK', defaultRoles: ['WARRANTY_CLERK'] },
  { key: 'WARRANTY_CLAIMS_VIEW', defaultRoles: ['WARRANTY_CLERK', 'ACCOUNTANT', 'FINANCE_MANAGER'] },
  { key: 'REPORTS_DASHBOARD_VIEW', defaultRoles: ['TECHNICAL_TEAM_LEADER'] },
  { key: 'REPORTS_OPERATIONAL_VIEW', defaultRoles: ['TECHNICAL_TEAM_LEADER'] },
  { key: 'REPORTS_QUALITY_VIEW', defaultRoles: ['TECHNICAL_TEAM_LEADER'] },
  { key: 'REPORTS_FINANCE_VIEW', defaultRoles: ['ACCOUNTANT', 'FINANCE_MANAGER'] },
  { key: 'TECHNICIAN_VISIT', defaultRoles: ['TECHNICAL_TEAM_LEADER', 'TECHNICIAN_FIELD'] },
  { key: 'TECHNICIAN_SCHEDULE_GANTT', defaultRoles: ['TECHNICAL_TEAM_LEADER'] },
];

const MATRIX_LOCKED_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'CUSTOMER'];

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

async function main(): Promise<void> {
  loadEnvFile();

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'jackys_service_portal',
  });

  await client.connect();

  try {
    let created = 0;
    let skipped = 0;
    let missingRole = 0;

    for (const capability of MIGRATED_CAPABILITIES) {
      for (const roleName of capability.defaultRoles) {
        if (MATRIX_LOCKED_ROLES.includes(roleName)) {
          continue; // would be inert - see MATRIX_LOCKED_ROLES comment above
        }

        const roleRes = await client.query(`SELECT id FROM roles WHERE name = $1`, [roleName]);
        if (roleRes.rows.length === 0) {
          console.log(`  skip: role ${roleName} not found in this database - nothing to attach ${capability.key} to.`);
          missingRole++;
          continue;
        }
        const roleId = roleRes.rows[0].id;

        const existing = await client.query(
          `SELECT id FROM role_permissions WHERE "roleId" = $1 AND "capabilityKey" = $2`,
          [roleId, capability.key],
        );
        if (existing.rows.length > 0) {
          skipped++;
          continue;
        }

        await client.query(
          `INSERT INTO role_permissions ("roleId", "capabilityKey", "grantedByUserId") VALUES ($1, $2, NULL)`,
          [roleId, capability.key],
        );
        console.log(`  created: ${roleName} -> ${capability.key}`);
        created++;
      }
    }

    console.log('');
    console.log(`Done. Created ${created}, already present ${skipped}, role not found ${missingRole}.`);
  } finally {
    await client.end();
  }
}

// Guarded so this module can be imported (e.g. by capability-catalog.spec.ts, to check
// MIGRATED_CAPABILITIES stays in sync) without actually connecting to a database.
if (require.main === module) {
  main().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
