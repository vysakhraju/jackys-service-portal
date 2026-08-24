/**
 * One-time bootstrap script: creates a TECHNICIAN_FIELD test user so you can log in as
 * "the technician" and try the Technician Mobile API endpoints yourself.
 *
 * Why this exists: there's no public "register" endpoint (same reason seed-admin.ts
 * exists for the first SUPER_ADMIN), and a technician account additionally needs the
 * TECHNICIAN_FIELD role to already be seeded.
 *
 * Prerequisite: roles must already be seeded. If you haven't done this yet, log in as
 * admin and call POST /auth/seed-roles once (from Swagger, or `npm run seed:admin` first
 * if you don't have an admin account either). This script will tell you clearly if the
 * role is missing.
 *
 * Usage:
 *   npm run seed:technician
 *   (optionally) SEED_TECH_EMAIL=you@jackys.com SEED_TECH_PASSWORD=YourPass123! npm run seed:technician
 *
 * Safe to re-run: skips creation if the user already exists.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';

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
    const email = process.env.SEED_TECH_EMAIL || 'tech@jackys.com';
    const password = process.env.SEED_TECH_PASSWORD || 'Tech123!';
    const firstName = process.env.SEED_TECH_FIRSTNAME || 'Test';
    const lastName = process.env.SEED_TECH_LASTNAME || 'Technician';

    const roleRes = await client.query(`SELECT id FROM roles WHERE name = 'TECHNICIAN_FIELD'`);
    if (roleRes.rows.length === 0) {
      console.error('');
      console.error('TECHNICIAN_FIELD role not found. Roles have not been seeded yet.');
      console.error('Log in as your admin user and call POST /auth/seed-roles once (via Swagger at');
      console.error('http://localhost:3000/api/docs), then re-run this script.');
      console.error('');
      process.exit(1);
    }
    const roleId = roleRes.rows[0].id;

    const existing = await client.query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (existing.rows.length > 0) {
      console.log(`User ${email} already exists - nothing to do.`);
      console.log('If you forgot the password, delete the row from "users" and re-run this script.');
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const inserted = await client.query(
      `INSERT INTO users ("firstName", "lastName", email, "passwordHash", status, "roleId")
       VALUES ($1, $2, $3, $4, 'ACTIVE', $5)
       RETURNING id`,
      [firstName, lastName, email, passwordHash, roleId],
    );

    console.log('');
    console.log('TECHNICIAN_FIELD user created. Login with:');
    console.log(`  email:    ${email}`);
    console.log(`  password: ${password}`);
    console.log(`  user id:  ${inserted.rows[0].id}   <- you'll need this to assign appointments to them`);
    console.log('');
    console.log('POST http://localhost:3000/api/v1/auth/login');
    console.log(JSON.stringify({ email, password }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
