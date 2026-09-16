/**
 * One-time bootstrap script: seeds the CancellationReason master with the 3 reasons the
 * business owner named for the mobile Cancellation action's reason dropdown ("Customer
 * not available", "Not agreed for repair", "BER") - see the Appointment/Mobile/Job Card
 * overhaul spec, req. 3f. Without this, GET /master-data/cancellation-reasons returns an
 * empty list and the mobile Cancel screen's dropdown has nothing to show.
 *
 * Same self-contained raw-pg.Client pattern as seed-admin.ts/seed-technician.ts (no Nest
 * app bootstrap needed for a handful of inserts).
 *
 * Usage:
 *   npm run seed:cancellation-reasons
 *
 * Safe to re-run: skips any label that already exists (label is a unique column), so
 * re-running after someone has added/edited reasons via the Admin UI won't duplicate or
 * clobber anything.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';

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

const DEFAULT_REASONS = ['Customer not available', 'Not agreed for repair', 'BER'];

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

    for (const label of DEFAULT_REASONS) {
      const existing = await client.query(`SELECT id FROM cancellation_reasons WHERE label = $1`, [label]);
      if (existing.rows.length > 0) {
        console.log(`"${label}" already exists - skipping.`);
        skipped += 1;
        continue;
      }

      await client.query(
        `INSERT INTO cancellation_reasons (label, "isActive") VALUES ($1, true)`,
        [label],
      );
      console.log(`Created "${label}".`);
      created += 1;
    }

    console.log('');
    console.log(`Done: ${created} created, ${skipped} already existed.`);
    console.log('More reasons can be added later via the Admin UI - this script only covers the 3 defaults.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
