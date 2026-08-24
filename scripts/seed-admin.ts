/**
 * One-time bootstrap script: creates the first SUPER_ADMIN user.
 *
 * Why this exists: AuthController only exposes login/refresh/logout/change-password/
 * profile/seed-roles - there is no public "register" endpoint, and seed-roles itself
 * requires an existing SUPER_ADMIN to call it. Without this script there is no way to
 * get a first account into a fresh database.
 *
 * Usage:
 *   npm run seed:admin
 *   (optionally) SEED_ADMIN_EMAIL=you@jackys.com SEED_ADMIN_PASSWORD=YourPass123! npm run seed:admin
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
    const email = process.env.SEED_ADMIN_EMAIL || 'admin@jackys.com';
    const password = process.env.SEED_ADMIN_PASSWORD || 'Admin123!';

    let roleId: string;
    const roleRes = await client.query(`SELECT id FROM roles WHERE name = 'SUPER_ADMIN'`);
    if (roleRes.rows.length === 0) {
      const inserted = await client.query(
        `INSERT INTO roles (name, "displayName", description, permissions, "isSystem")
         VALUES ('SUPER_ADMIN', 'Super Admin', 'Full system access', $1::jsonb, true)
         RETURNING id`,
        [JSON.stringify(['*'])],
      );
      roleId = inserted.rows[0].id;
      console.log('Created SUPER_ADMIN role.');
    } else {
      roleId = roleRes.rows[0].id;
    }

    const existing = await client.query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (existing.rows.length > 0) {
      console.log(`User ${email} already exists - nothing to do.`);
      console.log('If you forgot the password, delete the row from "users" and re-run this script.');
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await client.query(
      `INSERT INTO users ("firstName", "lastName", email, "passwordHash", status, "roleId")
       VALUES ('Super', 'Admin', $1, $2, 'ACTIVE', $3)`,
      [email, passwordHash, roleId],
    );

    console.log('');
    console.log('SUPER_ADMIN user created. Login with:');
    console.log(`  email:    ${email}`);
    console.log(`  password: ${password}`);
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
