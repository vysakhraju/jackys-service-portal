# Jacky's Service Portal — Status Tracker

**Last updated:** 2026-08-24
**Stack:** NestJS + PostgreSQL + JWT + React
**Repo:** `D:\Jackys\jackys service portal` (git initialized, 11 commits on `master`, latest `7daffed`)

This tracks where the build actually stands, phase by phase, against the 8-week plan in `docs/planning/IMPLEMENTATION_PLAN_v1.md`. Source docs: `docs/brd/`, `docs/discovery/DISCOVERY_v1.md`.

---

## Phase list & status

| # | Phase | Status |
|---|-------|--------|
| 0 | Dev environment setup | ✅ Done — Postgres installed, DB created, app running on your machine |
| 1 | Verify & test Auth + Master Data (already coded) | ✅ Done — 9 real bugs found & fixed, confirmed working on your machine |
| 2 | Appointments + Technician Mobile API | ✅ Done — Appointments (fixed & wired in) + Technician Mobile API (new, this session) |
| 3 | Job Cards + Warranty Check | ✅ Done — S/N validation, section assignment, warranty override with TL approval + audit trail (new, this session) |
| 4 | Estimates + Notifications | ⬜ Not started |
| 5 | Workshop + Inventory (Reserve) | ⬜ Not started |
| 6 | QC + Inventory auto-deduct | ⬜ Not started |
| 7 | Delivery + POD + OOW block | ⬜ Not started |
| 8 | Finance + Customer Portal | ⬜ Not started |

`backend/` and `frontend/` top-level folders exist but are empty — actual backend code lives directly under `src/`, not `backend/src/` as the plan doc's tree diagram shows. Not a blocker, just worth knowing before the React frontend gets scaffolded (it should probably live in `frontend/`).

---

## Phase 0: Dev environment setup

Checked directly on your machine (asustuf15):

| Tool | Status |
|------|--------|
| Node.js | ✅ v24.19.0 |
| npm | ✅ 11.17.0 |
| git | ✅ 2.54.0 (repo initialized, 3 commits) |
| PostgreSQL | ✅ 16.15 installed as a Windows service (`postgresql-x64-16`, running), listening on port 5432, `postgres`/`postgres` credentials match `.env` |
| Database | ✅ `jackys_service_portal` created |
| npm dependencies | ✅ installed (833 packages) |
| App boot | ✅ `npm run start:dev` — schema synced (all 14 tables + join table created), all routes mapped, running at http://localhost:3000 |
| First login | ✅ Seeded a SUPER_ADMIN via `npm run seed:admin`, logged in via `POST /auth/login`, got back a real JWT with role `SUPER_ADMIN` |

The dev server is running in watch mode — leave it running and open **http://localhost:3000/api/docs** for the interactive Swagger UI to try endpoints yourself.

---

## Phase 1: Verify & test Auth + Master Data — done this session

Did a real build + runtime test (not just a read-through) in an isolated sandbox: `npm install`, `nest build`, booted the app against a real local Postgres, ran schema sync, then hit the actual HTTP endpoints (login, refresh, protected routes, RBAC, appointment creation). Found and fixed **9 real bugs** — the code looked complete but none of this had actually been run before:

1. **Login was completely broken (P0).** `User.passwordHash` has `select: false`, but `validateUser()`/`changePassword()` used a plain `findOne()`, which silently omits `select:false` columns. Every login attempt crashed inside bcrypt with `Illegal arguments: string, undefined`. Fixed to explicitly re-select `passwordHash` via query builder.
2. **AppointmentsModule was commented out** in `app.module.ts` — a fully-built module (appointments, capacity check, technician assignment, dashboard stats) was never reachable through the running app.
3. **JWT signing was broken.** Config specified `algorithm: 'RS256'` (needs an RSA key pair) but the secrets in `.env` are plain strings — `jsonwebtoken` throws on this combination. Switched to `HS256` to match the existing `.env` secrets. (Upgrading to RS256 with real key pairs is a reasonable production hardening step later, not needed for the MVP.)
4. **Refresh tokens were signed with the wrong secret** — access and refresh tokens were both signed with `JWT_SECRET` instead of `JWT_REFRESH_SECRET`.
5. **The refresh-token endpoint was fundamentally broken.** It looked up a user by `WHERE refreshTokenHash = <raw token>`, but `refreshTokenHash` is a salted bcrypt hash — that lookup could never match. `RefreshStrategy` (which does the comparison correctly) existed but was never wired to the `/auth/refresh` route. Added `RefreshAuthGuard` and wired it in.
6. **Missing file:** `src/auth/decorators/current-user.decorator.ts` — imported by the Appointments controller but never created; would have failed to compile.
7. **TypeORM `relations` used old array syntax** (`relations: ['x','y']`) in several places — the installed `typeorm@1.1.0` requires object syntax (`relations: { x: true }`); this was a hard compile error.
8. **Schema-breaking table name collision:** the `SparePart` ↔ `SparePartModel` many-to-many `@JoinTable` was named `spare_part_models` — identical to `SparePartModel`'s own `@Entity('spare_part_models')` table. On sync, TypeORM tried to reshape the entity table into a join table and corrupted it. Renamed the join table to `spare_part_model_links`.
9. **Several smaller ones:** `ComponentYieldMatrix` had an `@Index` on a column name (`bomItemCode`) that didn't exist (actual column: `originalBomItemCode`); `MasterDataModule` didn't import `AuthModule` so `AuditInterceptor` (which needs `AuthService`) failed dependency injection; `AuditAction` enum was missing `CANCEL`, used by the appointment-cancel flow; appointment capacity check read a nonexistent `ServiceCentre.dailyCapacity` field instead of the real per-weekday `schedule[day].maxJobsPerDay`; audit-log metadata (ip/user-agent) was being read from `@Query()` instead of `@Request()`.

**Also added:** `scripts/seed-admin.ts` (`npm run seed:admin`) — there's no public registration endpoint (`seed-roles` itself requires an existing `SUPER_ADMIN`), so a fresh database has no way to create a first account. This script creates one directly.

**Verified working end-to-end** (in the sandbox, against a real Postgres):
- `POST /auth/login` → real access + refresh tokens
- `GET /auth/profile` with bearer token → 200
- `POST /auth/refresh` → new token pair
- `POST /auth/seed-roles` → 401 without token, 201 with a SUPER_ADMIN token
- `POST /master-data/service-centres` → creates a service centre with a weekday schedule
- `POST /appointments` → creates an appointment, capacity check correctly reads `schedule.monday.maxJobsPerDay`

All fixes are committed to git (`c4feeb7`, `880092d`) and written into `src/` on your machine already — nothing more to do here except run it yourself once Postgres is up (see "Your turn to test" below).

---

## Automated tests (Phase 1) — added this session

Backfilled unit tests for the three Phase 1 modules using mocked repositories (no live DB needed to run these). Verified passing both in an isolated sandbox and for real on your machine (`npm test -- --coverage`).

```
Test Suites: 7 passed, 7 total
Tests:       137 passed, 137 total
```

| File tested | Stmt % | Branch % |
|---|---|---|
| `auth/auth.service.ts` | 100% | 100% |
| `auth/strategies/jwt.strategy.ts` | 100% | 75% |
| `auth/strategies/refresh.strategy.ts` | 100% | 85.7% |
| `auth/guards/refresh-auth.guard.ts` | 100% | 100% |
| `appointments/appointments.service.ts` | 98.95% | 89.6% |
| `master-data/master-data.service.ts` | 89.5% | 75% |
| `technician/technician.service.ts` | 100% | 93.75% |

New spec files: `src/auth/auth.service.spec.ts`, `src/auth/strategies/jwt.strategy.spec.ts`, `src/auth/strategies/refresh.strategy.spec.ts`, `src/auth/guards/refresh-auth.guard.spec.ts`, `src/master-data/master-data.service.spec.ts`, `src/appointments/appointments.service.spec.ts` (committed as `8c1bdc9`), `src/technician/technician.service.spec.ts` (committed as `705e914`, alongside the Technician Mobile API itself).

Not yet covered: controllers, modules, DTOs, `AuditInterceptor`, `RolesGuard`/`JwtAuthGuard` — these are thin wiring/decorator layers, lower priority than the service-layer business logic. Worth adding light coverage (mainly guard/interceptor unit tests) before Phase 2 sign-off if you want the 90% target applied repo-wide rather than just to the tested services.

Run them yourself anytime with:
```powershell
cd "D:\Jackys\jackys service portal"
npm test                    # just run the suite
npm run test:cov            # with a coverage report
```

---

## Phase 2: Appointments + Technician Mobile API — done this session

- **Appointments**: fully implemented — create (with capacity + technician-availability checks), list/filter, dashboard stats, service-centre & technician schedules, assign technician, confirm, mark on-site, complete, cancel. Correctly wired into the app (see Phase 1 bug #2).

- **Technician Mobile API** (new): a `technician` module implementing the three technician-facing requirements from the plan (FR-02/03/04). One `TechnicianVisit` row per appointment, created/updated as the technician progresses:
  - `POST /technician/visits/:appointmentId/start` — captures GPS lat/lng + timestamp (FR-02). Transitions the appointment `CONFIRMED`/`TECHNICIAN_ASSIGNED` → `ON_SITE` via the existing `AppointmentsService.markOnSite`, so that status rule lives in one place. Calling it again while already `ON_SITE` (e.g. the technician reopened the app) just refreshes the GPS capture without re-transitioning.
  - `POST /technician/visits/:appointmentId/serial-number` — captures the Serial Number and checks it against Warranty Master, returning an `IW`/`OOW` badge (FR-03).
  - `POST /technician/visits/:appointmentId/fault-symptom` — records Fault Code + Symptom Code, but only once a Serial Number has been captured and validated (FR-04); both codes are checked against master data.
  - `GET /technician/visits/:appointmentId` — fetch the visit record.
  - `GET /technician/schedule` — the calling technician's own day schedule (defaults to today).
  - **Ownership rule**: a `TECHNICIAN_FIELD` caller can only act on appointments assigned to them (403 otherwise); `SUPER_ADMIN`/`SERVICE_HEAD`/`TECHNICAL_TEAM_LEADER` can act on any appointment, matching the role set already used on the Appointments on-site/complete endpoints.
  - Job Cards (Phase 3) will read this table to decide IW/OOW routing and to enforce FR-05 (block Job Card creation when no S/N was ever captured).

- **Bug found and fixed while testing this feature**: `MasterDataService.findWarrantyBySerial()`'s range check compared `:serial BETWEEN warranty.serialNumberRange AND warranty.serialNumberRange` — a range of one value against itself, which only ever matched a serial equal to the literal stored range string (e.g. `"SN100000-SN199999"`), so a warranty lookup for a *real* serial number like `SN150000` always came back empty/Unknown. Fixed to split the stored `"START-END"` string and compare the serial lexicographically against both bounds. Found and confirmed via a live end-to-end test against a real Postgres instance (an appliance seeded with a warranty range, then checked with a serial inside vs. outside it) — this directly blocked the Technician Mobile API's core promise (FR-03), so it wasn't safe to leave for later.

- **Verified end-to-end** (real local Postgres, not just unit tests): assigned a technician to an appointment → started a visit (GPS captured, status → `ON_SITE`) → captured a serial number inside a seeded warranty range (`IW` badge returned correctly) → recorded a valid fault/symptom pair. Also verified the negative paths: a technician acting on someone else's appointment → 403; fault/symptom before a serial number → 400; an unknown fault code → 404; fetching a visit that was never started → 404.

- Committed as `705e914`.

---

## Phase 3: Job Cards + Warranty Check — done this session

A `job-cards` module implementing FR-05 (block Job Card creation without S/N verification), FR-06 (OOW customer approval before work starts — stopgap, see below), and FR-17/AC-18 (Warranty Override with TL approval + audit trail).

**Design (four gates, in order):**
1. **`POST /job-cards`** `{ appointmentId }` — creation is blocked (`400`) unless the appointment already has an `invoiceNumber` on file **and** the technician's field visit (Phase 2) has a captured serial number, warranty check, and fault/symptom codes. This is the "no Job Card without invoice verification" rule (FR-05, AC-05). Blocked with `409` if a Job Card already exists for the appointment. On success, the visit's data (S/N, brand, fault/symptom, warranty status) is **snapshotted** onto the Job Card — deliberately not re-read live afterwards, so a later change to the visit can't silently drift what the Job Card recorded.
2. **`POST /job-cards/:id/validate-sn`** `{ matches, notes? }` — a human (CCE) step confirming the captured S/N actually matches the physical invoice. Only allowed while the Job Card is still `OPEN`, so it can't be quietly redone after work has started to paper over a mismatch. A match advances status to `SN_VALIDATED`; a non-match records the flag/notes but leaves the Job Card blocked from proceeding.
3. **`POST /job-cards/:id/assign-section`** `{ section: ON_SITE_REPAIR | WORKSHOP }` — the point work actually starts, so it's the real enforcement point: requires `SN_VALIDATED` status, and for an out-of-warranty (OOW) job, also requires customer approval (gate 4) to already be in place.
4. **`POST /job-cards/:id/approve-customer`** `{ notes? }` — a **temporary manual stand-in** for FR-06 (the real "customer approves via a shareable link" flow is the Estimates phase, not built yet). Restricted to the same office-side roles as the rest of the module; a real auditor would want this replaced with the actual link-based approval before go-live — tracked as a known gap, not hidden.
5. **`POST /job-cards/:id/warranty-override`** `{ newStatus, reason }` — corrects the warranty badge. Restricted to **Technical Team Leader / Service Head / Super Admin only** (not the general Job Card roles). Requires a `reason` (min 5 chars), writes a `WARRANTY_OVERRIDE` audit log row (who, when, old→new, reason), and tracks `overrideCount` since it can be called more than once. If an override flips an already section-assigned job to OOW, any existing customer approval is automatically reset — an approval obtained under the old (e.g. IW) terms can't silently cover the new (OOW) ones.

Other endpoints: `GET /job-cards/:id`, `GET /job-cards/by-appointment/:appointmentId`.

**Bug found and fixed while building this (TypeORM footgun, not specific to Job Cards):** when an entity is loaded with an eager `@ManyToOne` relation populated (e.g. `warrantyOverrideByUser`) and you then set the raw FK column directly (`warrantyOverrideBy = userId`) without also updating the relation object, `repository.save()` writes the correct value to the database — but the in-memory object it *returns* gets that FK column reset back to match the stale relation, so the API response looked wrong (`warrantyOverrideBy: null`) even though the database was correct. Fixed by adding a lean `findEntityById()` (no relations) for the service's internal mutation methods, keeping the relation-loaded `findById()` only for the read-only `GET` endpoints. Worth remembering if a similar "DB is right, but the response looks wrong" symptom shows up in a later phase.

**Bigger bug found and fixed while verifying this (pre-existing, affects Phase 1 & 2 too, not something new in Job Cards):** `AuditInterceptor` used `context.getArgs()` to get the controller method's arguments for `getEntityId`/`getOldValues` — but for an HTTP request, `ExecutionContext.getArgs()` actually returns the raw `[request, response, next]` platform handler args, **not** the `@Param`/`@Body`-resolved values the method was written against. Every `@Audit({ getEntityId: (args) => args[0] })` across the whole codebase (`master-data.controller.ts`, `technician.controller.ts`, `appointments.controller.ts`, and now `job-cards.controller.ts`) was silently reading the wrong thing:
- Where the lambda did `args[0]?.someProp`, it always evaluated to `undefined` (Request has no such property) — harmless-looking but meant `entityId`/`oldValues` were **always blank** on every audit row ever written via this pattern (confirmed: `ServiceCentre`/`FaultSymptom`/`SparePart` audit rows in the database all have blank `entityId`).
- Where the lambda did `args[0]` directly (assigning the *entire* Request object as the value), saving it threw `TypeError: Converting circular structure to JSON` inside `AuthService.logAudit`'s own try/catch — which silently swallowed the error, so **the audit row was never written at all**. This affected every `TechnicianVisit` audit call (Phase 2 — confirmed zero rows in `audit_logs` for `TechnicianVisit`, ever) and would have affected every `JobCard` mutation endpoint (`validate-sn`, `assign-section`, `approve-customer`, `warranty-override`) had it not been caught here. This one mattered enough to fix now rather than defer: FR-17 explicitly requires a Warranty Override audit trail, and it was silently not being written.

  Fixed at the root: `AuditInterceptor` now builds `{ params, body, query, user }` from the real Express request instead of `context.getArgs()`, and every `@Audit` call site across all four controllers was updated to use named access (`args.params.id`, `args.body.code`, etc.) instead of the broken positional indexing. Verified live: Job Card creation, S/N validation, section assignment, and warranty override (twice, including the OOW-reset case) all now produce correct `audit_logs` rows with real `entityId`/`newValues`/`userId`. Re-ran the full existing test suite afterwards (161/161 passing) to confirm nothing else broke.

  **Minor follow-up, not blocking:** `AppointmentsController` has the `@Audit` decorator on its endpoints *in addition to* `AppointmentsService` already calling `logAudit()` directly for the same actions — now that the interceptor actually works, Appointment mutations will produce two audit rows instead of one (redundant, not incorrect). Worth removing the redundant `@Audit`/`@UseInterceptors` from `AppointmentsController` in a later cleanup pass.

**Verified end-to-end** (real local Postgres, live HTTP, not just unit tests): built two full scenarios —
- An in-warranty (IW) job card: created → S/N validated → section assigned (no approval needed) → warranty overridden to OOW after the fact (audit trail confirmed, `overrideCount` incremented, `warrantyOverrideBy` correctly resolved).
- An out-of-warranty (OOW) job card: created → S/N mismatch flagged then corrected (still `OPEN`, re-validatable) → section assignment blocked without approval → customer approved → section assignment succeeded → overridden back to IW, then to OOW again (no-op guard on a same-status override confirmed with `400`).

Also verified the negative paths: no invoice number → `400`; incomplete field visit → `400`; duplicate Job Card → `409`; wrong role on every office-side and TL-only endpoint → `403`; re-validating S/N once past `OPEN` → `400`; override reason too short → `400`; override to the same status → `400`.

**Automated tests**: `src/job-cards/job-cards.service.spec.ts`, 24 tests, 100% statements/functions/lines, 95.65% branches on `job-cards.service.ts`.

```
Test Suites: 8 passed, 8 total
Tests:       161 passed, 161 total
```

---

## Known issue to fix later (not blocking)

- `User.refreshTokenHash` (a bcrypt hash) is returned in nested user objects on some responses (e.g. `appointment.createdBy.refreshTokenHash`) because it lacks `select: false` and there's no active response-serialization filter. Not immediately exploitable, but worth tightening — add `select: false` similarly to `passwordHash`, with an explicit re-select where actually needed (`RefreshStrategy`).
- `AppointmentsController` double-logs audit rows for its mutation endpoints (see Phase 3 above) — remove the redundant `@Audit`/`@UseInterceptors(AuditInterceptor)` decorators there since `AppointmentsService` already logs directly.
- FR-06's customer approval is a manual `approve-customer` flag for now, not the real shareable-link/Estimate approval flow — replace when the Estimates phase (Phase 4) is built.
- Once a Job Card exists for an appointment, the field visit's captured S/N/fault/symptom can technically still be re-captured on the `TechnicianVisit` record without the Job Card's snapshot updating to match (by design, to keep the Job Card's record immutable) — but there's no guard actively *preventing* the recapture, so it's a documentation-only safeguard right now, not an enforced one. Low risk in practice (recapture isn't a normal flow) but worth a proper lock if it comes up.

---

## Full self-test walkthrough

There's now a dedicated step-by-step guide for testing everything yourself through Swagger (no UI exists yet, but Swagger gives you a clickable page for every endpoint): **`docs/testing/TESTING_GUIDE.md`**. It covers starting the server, logging in, setting up master data, creating and assigning appointments, running the full Technician Mobile API flow (start visit → capture serial number → capture fault/symptom), and now the full Job Cards flow (create → validate S/N → assign section → warranty override, including the OOW customer-approval stopgap), plus a troubleshooting table. Every step in it was verified against a live server before being written down, so it should just work if you follow it in order.

Also new this session: `npm run seed:technician` creates a test `TECHNICIAN_FIELD` login (same pattern as `npm run seed:admin`) so you can try the Technician Mobile API as "the technician" without touching SQL.

---

## Quick reference (see the full guide above for step-by-step)

The dev server is already running on your machine (`npm run start:dev`, watch mode — it auto-restarts when you edit a file). Open **http://localhost:3000/api/docs** in a browser: that's the Swagger UI, where you can click "Authorize", log in with the credentials below, and try every endpoint interactively without writing any code.

```
email:    admin@jackys.com
password: Admin123!
```

If you ever need to stop/restart it yourself:
```powershell
cd "D:\Jackys\jackys service portal"
npm run start:dev
```

Useful next PowerShell commands if you want to poke at it without Swagger:
```powershell
$resp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/auth/login" -Method Post -ContentType "application/json" -Body '{"email":"admin@jackys.com","password":"Admin123!"}'
$resp.accessToken   # your JWT
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/auth/profile" -Headers @{ Authorization = "Bearer $($resp.accessToken)" }
```

To try the new Technician Mobile API, you'll need: a `TECHNICIAN_FIELD` user (there's no public registration endpoint yet — easiest is a direct SQL insert like `seed-admin.ts` does, or reuse a technician you already created for testing Appointments), an appointment with that technician assigned (`PUT /appointments/:id/assign-technician`), a fault/symptom pair and a warranty-master range in Master Data, then as that technician:
```
POST /technician/visits/:appointmentId/start            { "gpsLat": 25.2048, "gpsLng": 55.2708 }
POST /technician/visits/:appointmentId/serial-number     { "serialNumber": "...", "brand": "..." }
POST /technician/visits/:appointmentId/fault-symptom     { "faultCode": "...", "symptomCode": "..." }
GET  /technician/visits/:appointmentId
GET  /technician/schedule
```
All five show up in Swagger under the `technician` tag too.

To try Job Cards, you need a Technician Mobile API flow completed above (S/N + fault/symptom captured) on an appointment that also has an `invoiceNumber` set, then back as **admin/CCE**:
```
POST /job-cards                          { "appointmentId": "..." }
POST /job-cards/:id/validate-sn          { "matches": true }
POST /job-cards/:id/assign-section       { "section": "ON_SITE_REPAIR" }
POST /job-cards/:id/approve-customer     { "notes": "..." }               (OOW jobs only, before assign-section)
POST /job-cards/:id/warranty-override    { "newStatus": "OOW", "reason": "..." }   (Technical Team Leader+ only)
GET  /job-cards/:id
GET  /job-cards/by-appointment/:appointmentId
```
All seven show up in Swagger under the `job-cards` tag.

---

## Open items / blockers (from planning docs, still unresolved)

- Mobile framework decision: Flutter vs React Native
- WhatsApp Business API account approval (2–4 weeks lead time)
- External Warranty API access/documentation
- Acceptance criteria not yet validated with stakeholders
- `backend/`/`frontend/` folder layout vs. actual `src/` layout — decide whether to reconcile before the React frontend is scaffolded
