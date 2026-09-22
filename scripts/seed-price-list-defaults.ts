/**
 * One-time bootstrap script: seeds a default REPAIR price row (priceB2B/priceB2C/
 * billingChannelRate/warrantyLaborCost all 0.00, isActive true) for every
 * ApplianceCategory - the Price List rebuild's (requested 2026-09-22, Phase 3) direct
 * fix for the gap flagged during Phase 1's live-DB check: the original
 * ServiceActivityType-based Price List had zero rows for REPAIR at all, despite REPAIR
 * being the default JobType for every appointment. Rows land at price 0 so nothing is
 * silently invented - an admin still edits real numbers in via the Price Lists screen,
 * this script just guarantees the row EXISTS to edit rather than needing to be created
 * by hand, category by category, before Finance can start filling in real rates.
 *
 * Only REPAIR is seeded (not INSTALLATION/DELIVERY_INSTALLATION/MAINTENANCE) - REPAIR is
 * the one JobType every appointment defaults to today, so it's the one gap that actually
 * blocks something; the other 3 combos are created via the admin UI as the business
 * starts using them, same as every other master in this app.
 *
 * Same self-contained raw-pg.Client pattern as seed-appointment-field-config.ts.
 *
 * Usage:
 *   npm run seed:price-list-defaults
 *
 * Safe to re-run: skips any (category, jobType) pair that already exists (the entity's
 * own unique index), so re-running after an admin has edited real prices in via the UI
 * won't reset them.
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

const APPLIANCE_CATEGORIES = [
  'REFRIGERATOR',
  'WASHING_MACHINE',
  'AC',
  'MICROWAVE',
  'OVEN',
  'COOKING_RANGE',
  'DISHWASHER',
  'WATER_HEATER',
  'DRYER',
  'OTHER',
];

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

    for (const category of APPLIANCE_CATEGORIES) {
      const existing = await client.query(
        `SELECT id FROM service_price_lists WHERE category = $1 AND "jobType" = 'REPAIR'`,
        [category],
      );
      if (existing.rows.length > 0) {
        console.log(`${category} / REPAIR already exists - skipping.`);
        skipped += 1;
        continue;
      }

      await client.query(
        `INSERT INTO service_price_lists (category, "jobType", "priceB2B", "priceB2C", "billingChannelRate", "warrantyLaborCost", "isActive")
         VALUES ($1, 'REPAIR', 0, 0, 0, 0, true)`,
        [category],
      );
      console.log(`Created ${category} / REPAIR at price 0.00 - edit real rates in via the Price Lists screen.`);
      created += 1;
    }

    console.log('');
    console.log(`Done: ${created} created, ${skipped} already existed.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
