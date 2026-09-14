/**
 * Clears the "custodian inactive" noise off the Inventory & Stock tab's stale-reservations
 * view (GET /inventory/reservations/stale) - live-tested finding, 2026-09-14: with real
 * users now testing jobs, 24+ leftover reservations from earlier test technicians (all
 * since deactivated) were confusingly showing up as "Stale reservations, all jobs" with no
 * way to clear them from the UI in bulk (the "Approve reallocation" -> "confirm return" flow
 * exists but is one reservation at a time, gated to TL+ / Warehouse Clerk, from the Job
 * Card's own Workshop screen - fine for ongoing use, tedious for a one-off backlog of test
 * debris).
 *
 * What this does, per matching reservation - and ONLY this, nothing else:
 *   - Finds every InventoryReservation still HELD or PARTIALLY_RESERVED whose custodian's
 *     user account is not ACTIVE (exactly InventoryService.getStaleReservations()'s
 *     "custodian inactive" half of its filter - the idle-24h+-with-a-still-active-custodian
 *     half is deliberately left alone, since that's live, in-use reservation aging, not
 *     leftover test debris).
 *   - Walks it through the SAME two-step state machine a human would click through in the
 *     UI: review(APPROVE_REALLOCATION) -> HELD/PARTIALLY_RESERVED becomes RETURN_PENDING,
 *     then confirmReturn() -> RETURN_PENDING becomes RETURNED (terminal) and the reserved
 *     units go back onto InventoryStock.quantityOnHand, exactly mirroring
 *     InventoryService.confirmReturn()'s own transaction (advisory-locked the same way).
 *   - Writes the same two audit_logs rows the real /inventory/reservations/:id/review and
 *     /inventory/reservations/:id/confirm-return endpoints would (via @Audit()), attributed
 *     to ACTOR_EMAIL below, so this never becomes an invisible, unaudited bulk write.
 *
 * Deliberately does NOT touch any Job Card, Appointment, Delivery, or User row. This app's
 * own precedent (see cleanup-test-users.ts) is to never remove or rewrite a business record
 * that a user (deactivated or not) is referenced from - only the orphaned reservation itself
 * is a "leftover", the Job Card it's attached to is a real business record either way. Once
 * a Job Card's own status needs revisiting (e.g. it's stuck SPARE_PENDING because of a
 * reservation this script just released), that's still a normal Workshop-screen action for
 * whoever owns that job now - this script only clears the inventory-side backlog that was
 * blocking exactly nothing except the reservation itself from being reallocated.
 *
 * This is a DRY RUN by default - it only prints what it would do. Re-run with APPLY=true to
 * actually write the changes, inside one transaction (all-or-nothing).
 *
 * Usage:
 *   npm run release:stale-reservations                                        (dry run)
 *   ACTOR_EMAIL=you@jackys.com npm run release:stale-reservations             (dry run, shows who'd be attributed)
 *   APPLY=true ACTOR_EMAIL=you@jackys.com npm run release:stale-reservations  (applies it)
 *
 * ACTOR_EMAIL must be an ACTIVE user's email - the script aborts without changing anything
 * (same "abort rather than guess" behaviour as cleanup-test-users.ts's SUPER_ADMIN branch)
 * if it's unset or doesn't match an active account, since every reservation touched needs a
 * real reviewedByUserId/returnConfirmedByUserId/audit-log userId, and guessing wrong would
 * misattribute real audit history.
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

interface StaleReservationRow {
  id: string;
  sparePartId: string;
  jobCardId: string;
  jobCardNumber: string;
  quantityReserved: number;
  status: string;
  custodianEmail: string;
  custodianFirst: string;
  custodianLast: string;
  requestedAt: string;
}

async function main(): Promise<void> {
  loadEnvFile();
  const apply = process.env.APPLY === 'true';
  const actorEmail = (process.env.ACTOR_EMAIL || '').trim().toLowerCase();

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'jackys_service_portal',
  });

  await client.connect();

  try {
    console.log(apply ? '=== APPLYING (this will write changes) ===' : '=== DRY RUN (no changes will be made - re-run with APPLY=true to apply) ===');
    console.log('');

    if (!actorEmail) {
      console.log('ACTOR_EMAIL is not set - who this gets attributed to (reviewedByUserId, returnConfirmedByUserId,');
      console.log('and the audit_logs rows) can\'t be guessed. Set ACTOR_EMAIL=<an active user\'s email> and re-run.');
      console.log('Nothing was checked or changed.');
      return;
    }

    const actorRes = await client.query<{ id: string; firstName: string; lastName: string; status: string }>(
      `SELECT id, "firstName", "lastName", status FROM users WHERE LOWER(email) = $1`,
      [actorEmail],
    );
    const actor = actorRes.rows[0];
    if (!actor || actor.status !== 'ACTIVE') {
      console.log(`ACTOR_EMAIL="${actorEmail}" does not match any ACTIVE user account.`);
      console.log('Aborting without changing anything, rather than guessing who to attribute this to.');
      process.exit(1);
    }
    console.log(`Attributing every change below to: ${actor.firstName} ${actor.lastName} (${actorEmail})`);
    console.log('');

    // Exactly InventoryService.getStaleReservations()'s "custodian inactive" half - HELD or
    // PARTIALLY_RESERVED, custodian's account status != ACTIVE. The idle-24h+-but-active-
    // custodian half of that view is deliberately excluded here (see the file doc above).
    const staleRes = await client.query<StaleReservationRow>(
      `SELECT
         r.id,
         r."sparePartId",
         r."jobCardId",
         jc."jobCardNumber",
         r."quantityReserved",
         r.status,
         u.email AS "custodianEmail",
         u."firstName" AS "custodianFirst",
         u."lastName" AS "custodianLast",
         r."requestedAt"
       FROM inventory_reservations r
       JOIN users u ON u.id = r."custodianUserId"
       JOIN job_cards jc ON jc.id = r."jobCardId"
       WHERE r.status IN ('HELD', 'PARTIALLY_RESERVED')
         AND u.status != 'ACTIVE'
       ORDER BY r."requestedAt" ASC`,
    );
    const stale = staleRes.rows;

    if (stale.length === 0) {
      console.log('No stale reservations with a deactivated custodian found - nothing to do.');
      return;
    }

    console.log(`Found ${stale.length} reservation(s) held by a deactivated custodian:`);
    for (const r of stale) {
      console.log(
        `  ${r.id}  ${r.status}  ${r.quantityReserved} unit(s)  Job Card ${r.jobCardNumber}  ` +
          `custodian: ${r.custodianFirst} ${r.custodianLast} (${r.custodianEmail}, deactivated)`,
      );
    }
    console.log('');
    console.log(
      `Each will be moved ${'->'} RETURN_PENDING (review: APPROVE_REALLOCATION) ${'->'} RETURNED (confirm-return),`,
    );
    console.log('the reserved units credited back to that spare part\'s on-hand stock, and two audit_logs rows');
    console.log('written per reservation - the same trail the real UI actions would leave.');

    if (!apply) {
      console.log('');
      console.log('Nothing was changed - this was a dry run. Re-run with APPLY=true to apply it.');
      return;
    }

    await client.query('BEGIN');
    try {
      const now = new Date();
      for (const r of stale) {
        // Same advisory lock InventoryService.reserve()/confirmReturn() take on this spare
        // part, so this can never interleave with a live reservation/return against it.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [r.sparePartId]);

        await client.query(
          `UPDATE inventory_reservations
           SET status = 'RETURN_PENDING',
               "reviewedByUserId" = $1,
               "reviewDecision" = 'APPROVE_REALLOCATION',
               "lastReviewedAt" = $2,
               notes = COALESCE(notes || ' | ', '') || 'Auto-released: custodian account deactivated (test-data cleanup, 2026-09-14).'
           WHERE id = $3`,
          [actor.id, now, r.id],
        );

        await client.query(
          `UPDATE inventory_reservations
           SET status = 'RETURNED',
               "quantityReturned" = $1,
               "returnConfirmedByUserId" = $2,
               "returnConfirmedAt" = $3
           WHERE id = $4`,
          [r.quantityReserved, actor.id, now, r.id],
        );

        await client.query(
          `UPDATE inventory_stock
           SET "quantityOnHand" = "quantityOnHand" + $1,
               "quantityReserved" = GREATEST(0, "quantityReserved" - $1)
           WHERE "sparePartId" = $2 AND location = 'MAIN_STORE'`,
          [r.quantityReserved, r.sparePartId],
        );

        await client.query(
          `INSERT INTO audit_logs (id, action, "entityType", "entityId", "newValues", description, metadata, "userId", "createdAt")
           VALUES (gen_random_uuid(), 'INVENTORY_RESERVE', 'InventoryReservation', $1, $2::jsonb, $3, $4::jsonb, $5, $6)`,
          [
            r.id,
            JSON.stringify({ status: 'RETURN_PENDING', reviewDecision: 'APPROVE_REALLOCATION' }),
            'Automated cleanup: custodian account deactivated',
            JSON.stringify({ source: 'scripts/release-stale-reservations.ts' }),
            actor.id,
            now,
          ],
        );
        await client.query(
          `INSERT INTO audit_logs (id, action, "entityType", "entityId", "newValues", description, metadata, "userId", "createdAt")
           VALUES (gen_random_uuid(), 'INVENTORY_RESERVE', 'InventoryReservation', $1, $2::jsonb, $3, $4::jsonb, $5, $6)`,
          [
            r.id,
            JSON.stringify({ status: 'RETURNED', quantityReturned: r.quantityReserved }),
            'Automated cleanup: custodian account deactivated',
            JSON.stringify({ source: 'scripts/release-stale-reservations.ts' }),
            actor.id,
            now,
          ],
        );
      }
      await client.query('COMMIT');
      console.log('');
      console.log(`Applied - ${stale.length} reservation(s) released and returned.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('release-stale-reservations failed:', err);
  process.exit(1);
});
