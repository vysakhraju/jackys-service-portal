/**
 * One-time bootstrap script: seeds a default price row (price/warrantyLaborCost both
 * 0.00, isActive true, no Billing Channel) for every
 * (ApplianceCategory, JobType, CustomerType) combination that's actually in active use.
 * Originally the Price List rebuild's (2026-09-22, Phase 3) direct fix for the gap
 * flagged during Phase 1's live-DB check: the original ServiceActivityType-based Price
 * List had zero rows for REPAIR at all, despite REPAIR being the default JobType for
 * every appointment. Rows land at price 0 so nothing is silently invented - an admin
 * still edits real numbers in via the Price Lists screen, this script just guarantees
 * the row EXISTS to edit rather than needing to be created by hand, combination by
 * combination, before Finance can start filling in real rates.
 *
 * Extended Phase 11 (2026-09-24): also seeds INSTALLATION and DELIVERY_INSTALLATION rows
 * per category, alongside the original REPAIR rows - Phase 10 shipped a real
 * COMPLETED-Job-Card billing path for these 2 job types
 * (InvoicingService.resolveActivityLineItemsPricing), so leaving them out here would
 * mean every single install/delivery invoice 400s on "no active Price List row exists"
 * until someone clicks through and hand-creates rows first. MAINTENANCE is still
 * deliberately excluded - it's been soft-hidden from every NEW-pick Job Type dropdown
 * since Phase 6 and has zero live Price List rows already, so seeding rows for a job
 * type nobody can newly select would just be clutter.
 *
 * Extended again for the super-admin pricing matrix rebuild (2026-09-25): CustomerType
 * (B2C/B2B/B2B_SALES_CHANNEL) is now a 3rd dimension of the row's own identity, so this
 * seeds one row per (category, jobType, customerType) with no Billing Channel - a
 * channel-specific rate is always something an admin adds deliberately via the Price
 * Lists screen, never seeded blind.
 *
 * Same self-contained raw-pg.Client pattern as seed-appointment-field-config.ts.
 *
 * Usage:
 *   npm run seed:price-list-defaults
 *
 * Safe to re-run: skips any (category, jobType, customerType) combination that already
 * exists with no Billing Channel (the entity's own unique index, null-safe on
 * billingChannelId), so re-running after an admin has edited real prices in via the UI
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

// Phase 11 (2026-09-24) - MAINTENANCE deliberately excluded, see the file doc comment.
const JOB_TYPES = ['REPAIR', 'INSTALLATION', 'DELIVERY_INSTALLATION'];

// Super-admin pricing matrix rebuild (2026-09-25) - the 3rd dimension of the row's own
// identity, see the file doc comment.
const CUSTOMER_TYPES = ['B2C', 'B2B', 'B2B_SALES_CHANNEL'];

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
      for (const jobType of JOB_TYPES) {
        for (const customerType of CUSTOMER_TYPES) {
          const existing = await client.query(
            `SELECT id FROM service_price_lists WHERE category = $1 AND "jobType" = $2 AND "customerType" = $3 AND "billingChannelId" IS NULL`,
            [category, jobType, customerType],
          );
          if (existing.rows.length > 0) {
            console.log(`${category} / ${jobType} / ${customerType} already exists - skipping.`);
            skipped += 1;
            continue;
          }

          await client.query(
            `INSERT INTO service_price_lists (category, "jobType", "customerType", "price", "warrantyLaborCost", "isActive")
             VALUES ($1, $2, $3, 0, 0, true)`,
            [category, jobType, customerType],
          );
          console.log(`Created ${category} / ${jobType} / ${customerType} at price 0.00 - edit real rates in via the Price Lists screen.`);
          created += 1;
        }
      }
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
