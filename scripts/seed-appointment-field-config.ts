/**
 * One-time bootstrap script: seeds the AppointmentFieldConfig master with one row per
 * CreateAppointmentDto field that is ALREADY optional today - see that entity's own doc
 * comment for why `type`/`customerType` are deliberately excluded (they stay permanently
 * hard-required in code, not admin-toggleable).
 *
 * Default `isMandatory` values match today's REAL behaviour exactly, so running this
 * script changes nothing about how the form behaves until a Super Admin actually flips a
 * toggle in the Admin UI:
 *   - jobType: true - the business already treats this as required in practice (per the
 *     original request: "the user has to type and job type as mandatory"), even though
 *     CreateAppointmentDto's own decorator is technically @IsOptional today. Phase 2 is
 *     what makes this toggle actually enforce anything server-side.
 *   - everything else: false - matches CreateAppointmentDto's current @IsOptional fields.
 *
 * Job Type split (requested 2026-09-22), Phase 6: also seeds 10 Job-Type-scoped rows -
 * applianceModelId/serialNumber/invoiceNumber/purchaseDate/problemDescription, each with
 * jobType: 'INSTALLATION' and again with jobType: 'DELIVERY_INSTALLATION', isVisible: false
 * - so those 5 fields are hidden (not just optional) on the New Appointment popup for
 * those 2 Job Types, per the locked decision on the Job Type split request. Every row
 * seeded before this phase keeps jobType: null (applies globally) and isVisible: true
 * (unchanged, visible) - nothing about Repair's behaviour changes.
 *
 * Same self-contained raw-pg.Client pattern as seed-cancellation-reasons.ts (no Nest app
 * bootstrap needed for a handful of inserts).
 *
 * Usage:
 *   npm run seed:appointment-field-config
 *
 * Safe to re-run: skips any (fieldKey, jobType) pair that already exists, so re-running
 * after a Super Admin has toggled some fields via the Admin UI won't reset their choices.
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

interface FieldConfigSeed {
  fieldKey: string;
  fieldLabel: string;
  isMandatory: boolean;
  jobType?: string | null;
  isVisible?: boolean;
}

// fieldKey must match a CreateAppointmentDto property name exactly - Phase 2's dynamic
// validation and the New Appointment form both look a field up by this key.
const DEFAULT_FIELD_CONFIGS: FieldConfigSeed[] = [
  { fieldKey: 'jobType', fieldLabel: 'Job Type', isMandatory: true },
  { fieldKey: 'channel', fieldLabel: 'Channel (intake)', isMandatory: false },
  { fieldKey: 'customerEmail', fieldLabel: 'Customer Email', isMandatory: false },
  { fieldKey: 'customerAddress', fieldLabel: 'Customer Address', isMandatory: false },
  { fieldKey: 'customerCity', fieldLabel: 'Customer City (free text)', isMandatory: false },
  { fieldKey: 'customerCountry', fieldLabel: 'Customer Country (free text)', isMandatory: false },
  { fieldKey: 'customerVatNumber', fieldLabel: 'Customer VAT Number', isMandatory: false },
  { fieldKey: 'cityId', fieldLabel: 'City', isMandatory: false },
  { fieldKey: 'country', fieldLabel: 'Country', isMandatory: false },
  { fieldKey: 'brand', fieldLabel: 'Brand (free text)', isMandatory: false },
  { fieldKey: 'modelNumber', fieldLabel: 'Model Number (free text)', isMandatory: false },
  { fieldKey: 'applianceModelId', fieldLabel: 'Appliance Model', isMandatory: false },
  // Phase 5 (2026-09-22) - the New Appointment popup's "Billing Channel" dropdown, added
  // by the same Phase 5 that fixed the point #4 gap (see billing-channel-resolution.util.ts).
  { fieldKey: 'billingChannelId', fieldLabel: 'Billing Channel', isMandatory: false },
  { fieldKey: 'serialNumber', fieldLabel: 'Serial Number', isMandatory: false },
  { fieldKey: 'purchaseDate', fieldLabel: 'Purchase Date', isMandatory: false },
  { fieldKey: 'invoiceNumber', fieldLabel: 'Invoice Number', isMandatory: false },
  { fieldKey: 'problemDescription', fieldLabel: 'Problem Description', isMandatory: false },
  { fieldKey: 'preferredDate', fieldLabel: 'Preferred Date', isMandatory: false },
  { fieldKey: 'preferredTimeSlot', fieldLabel: 'Preferred Time Slot', isMandatory: false },
  { fieldKey: 'estimatedDurationMinutes', fieldLabel: 'Estimated Duration (minutes)', isMandatory: false },
  { fieldKey: 'technicianId', fieldLabel: 'Technician', isMandatory: false },
  { fieldKey: 'notes', fieldLabel: 'Notes', isMandatory: false },
];

// Job Type split (requested 2026-09-22), Phase 6 - these 5 fields match the New
// Appointment popup's own visible fields exactly (Brand/Model = applianceModelId, Serial
// Number, Invoice Number, Purchase Date, Problem Description - per the request's point 4),
// hidden for Installation/Delivery Installation since CCE creates those appointments from
// a separate ERP process with none of this information on hand yet.
const HIDDEN_FOR_INSTALLATION_JOB_TYPES = ['applianceModelId', 'serialNumber', 'invoiceNumber', 'purchaseDate', 'problemDescription'];
const INSTALLATION_JOB_TYPES = ['INSTALLATION', 'DELIVERY_INSTALLATION'];

const FIELD_LABEL_BY_KEY = new Map(DEFAULT_FIELD_CONFIGS.map((f) => [f.fieldKey, f.fieldLabel]));

for (const jobType of INSTALLATION_JOB_TYPES) {
  for (const fieldKey of HIDDEN_FOR_INSTALLATION_JOB_TYPES) {
    DEFAULT_FIELD_CONFIGS.push({
      fieldKey,
      fieldLabel: FIELD_LABEL_BY_KEY.get(fieldKey) ?? fieldKey,
      isMandatory: false,
      jobType,
      isVisible: false,
    });
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

    for (const field of DEFAULT_FIELD_CONFIGS) {
      const jobType = field.jobType ?? null;
      const isVisible = field.isVisible ?? true;
      const existing = jobType === null
        ? await client.query(
            `SELECT id FROM appointment_field_configs WHERE "fieldKey" = $1 AND "jobType" IS NULL`,
            [field.fieldKey],
          )
        : await client.query(
            `SELECT id FROM appointment_field_configs WHERE "fieldKey" = $1 AND "jobType" = $2`,
            [field.fieldKey, jobType],
          );
      if (existing.rows.length > 0) {
        console.log(`"${field.fieldKey}"${jobType ? ` / ${jobType}` : ''} already exists - skipping.`);
        skipped += 1;
        continue;
      }

      await client.query(
        `INSERT INTO appointment_field_configs ("fieldKey", "fieldLabel", "isMandatory", "jobType", "isVisible") VALUES ($1, $2, $3, $4, $5)`,
        [field.fieldKey, field.fieldLabel, field.isMandatory, jobType, isVisible],
      );
      console.log(`Created "${field.fieldKey}"${jobType ? ` / ${jobType}` : ''} (isMandatory: ${field.isMandatory}, isVisible: ${isVisible}).`);
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
