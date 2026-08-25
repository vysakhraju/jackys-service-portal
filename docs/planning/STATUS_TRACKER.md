# Jacky's Service Portal — Status Tracker

**Last updated:** 2026-08-25
**Stack:** NestJS + PostgreSQL + JWT + React
**Repo:** `D:\Jackys\jackys service portal` (git initialized, 24 commits on `master`, latest `eb9ac90`)
**GitHub:** https://github.com/vysakhraju/jackys-service-portal — `main` and `master` both pushed and in sync

This tracks where the build actually stands, phase by phase, against the 8-week plan in `docs/planning/IMPLEMENTATION_PLAN_v1.md`. Source docs: `docs/brd/`, `docs/discovery/DISCOVERY_v1.md`.

---

## Phase list & status

| # | Phase | Status |
|---|-------|--------|
| 0 | Dev environment setup | ✅ Done — Postgres installed, DB created, app running on your machine |
| 1 | Verify & test Auth + Master Data (already coded) | ✅ Done — 9 real bugs found & fixed, confirmed working on your machine |
| 2 | Appointments + Technician Mobile API | ✅ Done — Appointments (fixed & wired in) + Technician Mobile API (new, this session) |
| 3 | Job Cards + Warranty Check | ✅ Done — S/N validation, section assignment, warranty override with TL approval + audit trail (new, this session) |
| 4 | Estimates + Notifications | ✅ Done — shareable-link + staff-assisted customer approval, RWR/revise flow, notification stubs (new, this session) |
| 5 | Workshop + Inventory (Reserve) | ✅ Done — reserve/custody/return model, technician-deactivation custody guard, live-verified (new, this session) |
| — | Test-master audit + full testing guide rewrite | ✅ Done — every endpoint (82) now documented and indexed, see below |
| 6 | QC + Inventory auto-deduct | ⬜ Not started — up next |
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
4. **`POST /job-cards/:id/approve-customer`** `{ notes? }` — **superseded by Phase 4's Estimates flow (below)**, kept as a manual fallback for the same office-side roles. Originally the FR-06 stopgap before Estimates existed; now both Estimate response paths set the same `customerApproved` flag this endpoint sets, so it still works, but the Estimates flow is the intended path going forward.
5. **`POST /job-cards/:id/warranty-override`** `{ newStatus, reason }` — corrects the warranty badge. Restricted to **Technical Team Leader / Service Head / Super Admin only** (not the general Job Card roles). Requires a `reason` (min 5 chars), writes a `WARRANTY_OVERRIDE` audit log row (who, when, old→new, reason), and tracks `overrideCount` since it can be called more than once. If an override flips an already section-assigned job to OOW, any existing customer approval is automatically reset — an approval obtained under the old (e.g. IW) terms can't silently cover the new (OOW) ones. **Updated in Phase 4**: also blocked while the Job Card is `RWR` or `CANCELLED`.

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

**Automated tests**: `src/job-cards/job-cards.service.spec.ts` — 41 tests as of Phase 4 (24 original + 17 added for the RWR/CANCELLED guard and the new `setToRwr`/`reviveFromRwr` methods), 100% statements/functions/lines on `job-cards.service.ts`.

---

## Bug fix: Master Data Swagger request bodies — done this session

**Reported by you**: the Swagger UI for `POST /master-data/service-centres` (and the rest of the master-data create/update endpoints) showed "No parameters" with nowhere to paste the JSON body described in the testing guide.

**Root cause**: all 10 master-data create/update endpoints declared their body as `@Body() data: Partial<Entity>`. TypeScript utility types like `Partial<X>` erase to a plain `Object` at runtime, so `@nestjs/swagger` had no field-level metadata to build a request-body schema from — Swagger UI had nothing to render an input box for. It also meant these endpoints had effectively **zero input validation**, since `ValidationPipe` can't validate a type it has no decorated shape for.

**Fix**: added a real DTO class (`@ApiProperty` + class-validator decorators) for every affected endpoint — service centres (create + update), fault/symptom, spare parts, spare part models, price lists, KPI rules, notification templates, warranty master, component yield matrix — matching the pattern already used in Appointments/Technician/Job Cards. New files under `src/master-data/dto/`. A follow-up pass found and fixed the same defect on 3 more endpoints that used inline TS object-literal types instead of DTO classes (same erasure bug): `PUT /appointments/:id/cancel`, `PUT /appointments/:id/assign-technician`, `POST /auth/change-password` — every POST/PUT endpoint in the app now has a real DTO and a working Swagger input box.

Committed as `5d4ecdf` and `2c84a99`, pushed to GitHub (`main` + `master`).

---

## Phase 4: Estimates + Notifications — done this session

Implements FR-06 (OOW customer approval via shareable link before WIP starts), FR-07 (notification on estimate send), and FR-08 (reject → RWR, blocking further work) — replacing the Job Cards `approve-customer` manual stopgap with the real flow.

**Design process**: before writing code, ran a `the-fool` pre-mortem on the draft design, which surfaced a requirement change mid-review — most customers never actually click an approval link; staff routinely get verbal approval by phone/WhatsApp/email instead, and the system needed a first-class way to record that, not just the self-service link. The finalized design (both paths below) went through a `test-master` test-plan pass before implementation, which caught one more gap (what the public link should show after it's already been responded to — decided: `410 Gone`, not a read-only replay) before any code was written.

**Estimate entity**: `jobCardId` (FK), `lineItems` (jsonb), `subtotal`/`vatAmount`/`totalAmount` (server-computed from the service centre's VAT rate), `status` (`DRAFT → SENT → APPROVED | REJECTED | EXPIRED`), `accessToken`/`tokenExpiresAt` (7-day link), `respondedVia` (`CUSTOMER_LINK | STAFF_RECORDED`), staff-path fields (`recordedByUserId`, `contactMethod`, `contactValue`), `channelsAttempted`/`channelsDelivered` (kept as two distinct fields — see Notifications below), `previousEstimateId` (the revise chain).

**Six endpoints (`estimates` module):**
1. **`POST /estimates`** `{ jobCardId, lineItems }` — staff (CCE+). Blocked (`400`) unless the Job Card is OOW and already `SN_VALIDATED`. Blocked (`409`) if an active (`DRAFT`/`SENT`/`APPROVED`) Estimate already exists for it.
2. **`POST /estimates/:id/send`** — staff. Only from `DRAFT`. Generates the shareable link's token + 7-day expiry, attempts a notification on every channel (FR-07), moves to `SENT`.
3. **`GET /estimates/public/:token`** — **public, no JWT**. Customer-safe summary. `404` on an unknown token; `410` once expired or already responded to (a decided estimate isn't a live decision surface anymore).
4. **`POST /estimates/public/:token/respond`** `{ approved, notes? }` — **public, no JWT**. The customer's own decision.
5. **`POST /estimates/:id/record-response`** `{ approved, contactMethod, contactValue, notes }` — staff, role-gated via a separate `ESTIMATE_APPROVAL_ROLES` constant (deliberately distinct from the general `ESTIMATE_ROLES`, so who's allowed to take approval calls can be extended later without touching unrelated permissions). This is the realistic path — recording a decision obtained by phone/WhatsApp/email call. **`contactValue` must exactly match the phone or email already on file for the appointment** (case-insensitive for email, no phone-format normalization) or it's rejected `400` — an anti-consent-laundering guard so a staff member can't attest to a call with a contact that isn't actually on record.
6. **`POST /estimates/:id/revise`** `{ lineItems? }` — staff, only on a `REJECTED` Estimate. Creates a new linked `DRAFT` (previous one stays `REJECTED` permanently) and moves the Job Card back to `SN_VALIDATED`. Line items are optional — omit to carry the rejected estimate's pricing forward unchanged, or supply new ones for a genuine re-quote.

Both response paths (4 and 5) converge on **one shared, guarded service method** keyed on `status === 'SENT'` — a second response attempt after either path already succeeded gets `409` naming when/how the first one happened, instead of silently overwriting the customer's decision. This closes a real race: a customer clicking reject on the link at the same moment a CCE records an approval from a call, with neither aware of the other.

**JobCard changes**: added a new `RWR` status (Ready for Return, FR-08). Not a dead end — `validate-sn`/`assign-section`/`warranty-override` are all blocked while `RWR`, but `Estimate.revise()` moves the Job Card back to `SN_VALIDATED` so the flow can continue, matching the discovery doc's own "Reject → RWR → Return" as a continuing process rather than case-closed. New service methods: `setToRwr()`, `reviveFromRwr()`.

**Notifications module (new)**: `NotificationsService.send()`/`sendAll()` look up the active `NotificationTemplate` (trigger + channel) already in Master Data, render its placeholders, and hand off to a channel adapter. **No real WhatsApp/SMS/Email provider is wired up yet** (WhatsApp Business API account approval remains a known 2-4 week external blocker, still open) — each adapter logs the rendered message and returns `delivered: false`. `channelsAttempted` and `channelsDelivered` are tracked as two **separate** fields everywhere, specifically so a stubbed send can never look identical to a real delivery in the stored data — swapping in a real provider later only means replacing the body of the three adapter methods, nothing about the interface changes.

**Verified live end-to-end** (real local Postgres, full flow via two PowerShell scripts saved to `scripts/phase4-e2e-test.ps1` and `scripts/phase4-notif-check.ps1`): create Estimate → send → customer rejects via the public link → public `GET` afterward correctly `410`s, a second `respond` correctly `409`s → Job Card moves to `RWR` → `warranty-override` correctly blocked while `RWR` → `revise` creates a new `DRAFT` and Job Card returns to `SN_VALIDATED` → sent again → staff `record-response` with a wrong `contactValue` correctly `400`s, then the real one succeeds and approves → Job Card's `customerApproved` flips true → `assign-section` finally unblocks. Separately confirmed `channelsAttempted` actually populates once a real `NotificationTemplate` exists (stays honestly distinct from `channelsDelivered`, which stays empty).

**Automated tests**: `src/estimates/estimates.service.spec.ts` (24 tests) + `src/notifications/notifications.service.spec.ts` (10 tests) + 17 new tests in `job-cards.service.spec.ts` for the RWR/guard additions — 51 new tests this phase.

```
Test Suites: 10 passed, 10 total
Tests:       215 passed, 215 total
```

Committed as `4192ceb`, pushed to GitHub (`main` + `master`).

**Follow-up doc fix**: Section 8d of `TESTING_GUIDE.md` (the old `approve-customer` stopgap) still said the real approval flow was "a later phase, not built yet" — stale now that Estimates shipped. Updated it to point testers at Section 9 instead, kept documented as a still-working manual fallback. Committed as `3c0d953`, pushed.

---

## Phase 5: Workshop + Inventory — done this session

Implements FR-09 (spare part reservation) built around a specific design mandate you gave up front, not the generic "reserve then deduct" pattern I'd have defaulted to: a central Main Store inventory with per-technician custody, where the *first* technician to request a low-stock part gets it reserved (not consumed) until their job is completed or QC'd, a 1-day idle check before anything gets reallocated, and a hard rule that a technician can't be deactivated while still holding open work or parts.

**Design process**: ran a `the-fool` pre-mortem on the draft design before writing code. You engaged with all four failure narratives and each one changed something concrete:
1. *Approval bypassed under time pressure* — your fix: a Team Leader/Supervisor must physically confirm with the technician before approving a reallocation, not just rubber-stamp a busy day. Implemented as a manual step (`review` endpoint), not automatable away — the guardrail is procedural, matching what you asked for.
2. *A deactivated technician's custody goes invisible* — your fix: a technician can't be deactivated at all while their id is still tied to any open appointment, workshop job, or spare-part reservation, and the admin should see everything they hold before trying. Implemented as a hard `409` block in `AuthService.deactivateUser()`, listing every blocker at once (not just the first one found, so clearing one doesn't reveal a second surprise).
3. *The on-demand review screen nobody opens* — your ask was how to make sure it actually gets looked at without adding scheduling infrastructure (you'd already picked the on-demand endpoint over a background job). Answer: staleness is a purely computed property (never a stored flag that can itself go stale), surfaced two places — a dedicated `GET /inventory/reservations/stale` list, and inline inside `GET /workshop/:jobCardId`, the screen a Team Leader already opens to run the job day-to-day. Plus a real forcing function, not just visibility: `requestSpare()` refuses to reserve anything more on a Job Card once one of its reservations has gone 48h+ with no review decision, until a TL actually reviews it.
4. *Reject-once-exempt-forever* — you asked for the industry-standard answer here. A `REJECT` review decision is a **snooze, not an exemption**: it resets the idle clock (`lastReviewedAt`) but leaves the reservation exactly where it was, so it resurfaces on the stale list again after another cycle instead of being permanently cleared by one rejection.

**Location model**: you specified sub-inventory count should track technician count directly, adjusting automatically as technicians are added/deactivated — rather than a fixed roster of location rows needing manual sync. Implemented as `InventoryReservation.custodianUserId`, a direct FK to whichever technician currently holds a reservation — custody is computed from live reservations, not a separate location entity that would need to be kept in sync by hand.

**Entities**: `InventoryStock` (`sparePartId` + `location` [currently only `MAIN_STORE`], `quantityOnHand`, `quantityReserved`) and `InventoryReservation` (`sparePartId`, `jobCardId`, `custodianUserId`, `quantityRequested`/`quantityReserved`, `status` [`HELD → PARTIALLY_RESERVED | RETURN_PENDING → RETURNED`], `requestedByUserId`/`requestedAt`, `lastReviewedAt`/`reviewedByUserId`/`reviewDecision`, `quantityReturned`/`returnConfirmedByUserId`/`returnConfirmedAt`).

**Inventory module (6 endpoints):**
1. **`POST /inventory/grn`** — Goods Received Note, new stock arriving. Blocked `400` (AC-17) unless the spare part is linked to at least one appliance model.
2. **`GET /inventory/stock/:sparePartId`** — current on-hand/reserved at Main Store.
3. **`GET /inventory/reservations/stale`** — reservations idle 24h+ (or whose custodian is no longer active, surfaced first regardless of age), oldest first.
4. **`POST /inventory/reservations/:id/review`** — TL+ decision: `APPROVE_REALLOCATION` (→ `RETURN_PENDING`) or `REJECT` (snooze, per failure #4 above).
5. **`POST /inventory/reservations/:id/request-return`** — the custodian technician (or a TL+ on their behalf) voluntarily returning an unused reservation, without waiting for a staleness flag.
6. **`POST /inventory/reservations/:id/confirm-return`** — the **only** action anywhere in the system that increments `quantityOnHand` for a return. Everything else (cancellation, a TL-approved reallocation, a technician's own return request) only ever gets a reservation to `RETURN_PENDING` — nothing moves actual stock until someone at Main Store has the part physically in hand and confirms it. This is the direct implementation of your instruction that inventory is only added back "when the technician physically give[s] the spare to the inventory and the role to confirm it."

**Workshop module (5 endpoints):** `assign` (Team Lead assigns a workshop technician to a `SECTION_ASSIGNED`/`WORKSHOP` Job Card) → `start-wip` → `request-spare` (reserves, doesn't deduct; `custodianUserId` is always the Job Card's assigned technician regardless of who clicked the button; partial-fill if less is available than requested, which also flips the Job Card to a new `SPARE_PENDING` status) → `complete` (blocked while `SPARE_PENDING`) → `GET :jobCardId` (full workshop state, including any stale reservations against that job).

**Job Card changes**: new statuses `WORKSHOP_ASSIGNED`/`IN_PROGRESS`/`SPARE_PENDING`/`READY_FOR_QC`; new `assignedWorkshopTechnicianId`/`workshopAssignedAt` columns; a new **`POST /job-cards/:id/cancel`** endpoint (`{ reason }`) that auto-releases every active reservation on that Job Card to `RETURN_PENDING` — directly implementing "if job is cancelled by any role the spare will be automatically added to main inventory" (added to *custody release*, not directly to on-hand stock — still gated behind a physical confirm-return, consistent with the physical-confirmation rule above).

**Deactivation guard (`AuthService.deactivateUser`)**: `PATCH /auth/users/:id/deactivate` (SUPER_ADMIN/SERVICE_HEAD only) checks three things before allowing it — any open field appointment, any open workshop job assignment, any open inventory reservation in that user's custody — and blocks with `409` listing every one found if any exist. There was no user-deactivation endpoint at all before this; `User.status` had an `INACTIVE` value that nothing ever set.

**Concurrency**: `reserve()`, `grn()`, and `confirmReturn()` (every method that reads-then-writes `InventoryStock` quantities) run inside a Postgres transaction-scoped advisory lock (`pg_advisory_xact_lock(hashtext(sparePartId))`) so two technicians requesting the last few units of the same low-stock part at the same moment can't both read the same "available" number and over-reserve — the lock serializes them, and the first one to actually commit wins the remaining stock, matching your "who request first... should be reserved" rule. This can't be proven with a mocked-repository unit test (a mock has no concept of a database lock), so it's the one piece of Phase 5 that's architecturally sound but not independently proven under real concurrent load — worth a dedicated two-simultaneous-requests test against low stock if this ever becomes a place where race conditions actually show up in practice.

**Closed a pre-existing gap while building this**: `SparePart` ↔ `SparePartModel` is a many-to-many relationship that had no REST-reachable way to create the link — only the CSV bulk-import path could ever populate it. Since the new GRN endpoint's AC-17 check ("no stock without a linked model") made this link a hard requirement to even test the feature, added **`POST /master-data/spare-parts/:id/link-model`** to close it.

**Automated tests**: `src/inventory/inventory.service.spec.ts`, `src/workshop/workshop.service.spec.ts` (new), plus additions to `job-cards.service.spec.ts` (workshop transitions + cancel), `auth.service.spec.ts` (`deactivateUser`), and `master-data.service.spec.ts` (`linkSparePartToModel`) — 62 new tests this phase.

```
Test Suites: 12 passed, 12 total
Tests:       277 passed, 277 total
```

**Verified live end-to-end** (real local Postgres, full flow via `scripts/phase5-e2e-test.ps1`): AC-17 GRN block on an unlinked spare part → link → GRN 5 units → full appointment/technician-visit/job-card/estimate chain to get a Job Card into `WORKSHOP` → workshop technician assigned → start-wip → request 2 units (`HELD`, on-hand unchanged, reserved +2) → **attempted deactivating the technician while they held that reservation → correctly `409`'d with the reservation listed as a blocker** → requested 10 more units against 3 remaining (`PARTIALLY_RESERVED`, Job Card → `SPARE_PENDING`) → `complete` correctly blocked while `SPARE_PENDING` → cancelled the Job Card → both reservations moved to `RETURN_PENDING` automatically → confirmed both physical returns → confirming the same return twice correctly `400`'d → **deactivation retried and succeeded** now that custody was clear.

**A genuine finding from the live run, not an app bug**: my own E2E script's helper function used `Write-Output` for its status lines, which in PowerShell leaks into a function's own return value and silently corrupted one `.Count` check (made a real `0` look like `1`). Fixed by switching to `Write-Host` for status lines; re-ran and confirmed the real result was `0` all along. Mentioning it because it's exactly the kind of thing that looks like an app bug at first glance and isn't — worth remembering if a future live-test result looks surprising.

**Known gap, called out on purpose, not fixed this phase**: nothing in Phase 5 ever permanently deducts `quantityOnHand` when a spare is genuinely used in a completed (non-cancelled, non-returned) job — only `confirmReturn()` ever moves that number, and only upward. In the live E2E run this meant on-hand ended at 10 units after only 5 were ever received (both test reservations were deliberately returned to prove the mechanics, which is why this showed up). Your original instruction was explicit that a spare stays reserved "till job is completed or qc completed" — the natural place for a real consumption/deduction step is QC completion, which is Phase 6 and doesn't exist yet. Flagging this now so it isn't lost: Phase 6 needs a step where a reservation that's never returned gets marked consumed and permanently subtracted from on-hand stock, otherwise on-hand will drift upward-only forever and stop meaning anything.

Committed as `225b88e`, pushed to GitHub (`main` + `master`).

---

## Test-master audit + full testing guide rewrite — done this session

Before handing you a "don't miss anything" testing guide, ran a real coverage audit rather
than trusting the existing guide was still complete — it had grown section-by-section across
five phases and had never been checked against the app as a whole in one pass.

**Method**: grepped every route decorator out of all 8 controllers directly (not from memory
or docs) to build a canonical list of every endpoint that actually exists, then cross-checked
that list line-by-line against what `TESTING_GUIDE.md` documented.

**Finding**: the guide was covering roughly 60% of the app. The worst gap was master-data —
only 3 of its 29 endpoints had a walkthrough (service centre create, fault/symptom create,
warranty range create); spare parts, spare part models, price lists, KPI rules, notification
templates, component yield matrix, and bulk import had no documentation at all despite being
fully built and working. Appointments was missing 8 of its 14 endpoints (list-with-filters,
dashboard stats, both schedule views, lookup-by-number, update, confirm/on-site/complete).
Auth was missing refresh and logout. Job Cards had no walkthrough at all for cancelling a
job card, even though Section 10 already referenced it in passing. The automated test suite
itself had no gaps worth flagging — 277/277 passing, re-confirmed with a fresh run this
session, same as the end of Phase 5.

**Fix**: rewrote `docs/testing/TESTING_GUIDE.md` from scratch, cold-start to finish. It now
starts from "is Node installed" and "is Postgres running" (previously assumed already done),
walks through first-time database creation, `npm install`, and seeding the first admin login,
then covers all 82 endpoints across every module — including a brand new **Section 11**, a
full endpoint-to-section index table, specifically so a future gap like this one is
immediately visible rather than discovered by another audit. Every code example was written
directly from the real DTOs and controller signatures, not copied from memory of earlier
sections.

Committed as `eb9ac90`, pushed to GitHub (`main` + `master`).

---

## Known issues to fix later (not blocking)

- `User.refreshTokenHash` (a bcrypt hash) is returned in nested user objects on some responses (e.g. `appointment.createdBy.refreshTokenHash`) because it lacks `select: false` and there's no active response-serialization filter. Not immediately exploitable, but worth tightening — add `select: false` similarly to `passwordHash`, with an explicit re-select where actually needed (`RefreshStrategy`).
- `AppointmentsController` double-logs audit rows for its mutation endpoints (see Phase 3 above) — remove the redundant `@Audit`/`@UseInterceptors(AuditInterceptor)` decorators there since `AppointmentsService` already logs directly.
- Once a Job Card exists for an appointment, the field visit's captured S/N/fault/symptom can technically still be re-captured on the `TechnicianVisit` record without the Job Card's snapshot updating to match (by design, to keep the Job Card's record immutable) — but there's no guard actively *preventing* the recapture, so it's a documentation-only safeguard right now, not an enforced one. Low risk in practice (recapture isn't a normal flow) but worth a proper lock if it comes up.
- **No real WhatsApp/SMS/Email provider wired up (Phase 4)** — `channelsDelivered` will stay empty for every Estimate until this is done. WhatsApp Business API approval is the known external blocker (2-4 weeks); email/SMS just need a provider chosen and credentials added. The `record-response` staff-assisted path is the practically-usable way to move an Estimate forward until then.
- **`ESTIMATE_APPROVAL_ROLES` (who can record a customer approval on their behalf) is a plain TS constant, not admin-editable** — extending it to a new role means a code change + redeploy. Deliberately kept as a separate, narrowly-named constant from the general Estimates role list so this is a small, contained change when it's needed, but there's no UI for it yet.
- **The staff-recorded-approval audit trail relies on the `notes` field and the `contactValue` match check, not independent verification** — this was the strongest risk flagged in the Phase 4 pre-mortem (a rubber-stamped "customer approved" with no real call). The `contactValue`-must-match guard prevents attesting to an unknown contact, but nothing stops a genuinely fabricated approval by someone with valid access. Worth a periodic audit-log review of `record-response` entries per staff member if this becomes a real usage pattern; a second-approval requirement above some order value is a reasonable future addition if disputes ever occur.
- **No "mark as consumed" step exists yet for spares genuinely used in a completed job (Phase 5)** — `InventoryStock.quantityOnHand` only ever increases (GRN, confirmed returns), never decreases for a legitimate use. This needs to land in Phase 6 alongside QC completion (see the Phase 5 section above for the full explanation) — until then, on-hand numbers will drift upward-only and stop being trustworthy for anything beyond "has this specific reservation been returned."
- **`InventoryLocation` currently has only one value (`MAIN_STORE`)** — there's no separate "technician van stock" location distinct from custody tracking via `InventoryReservation.custodianUserId`. Fine for the current design (custody *is* the location signal), but worth knowing if a future requirement needs a real second physical location (e.g. a regional warehouse) rather than just "who's holding it."

---

## Full self-test walkthrough

There's now a dedicated step-by-step guide for testing everything yourself through Swagger (no UI exists yet, but Swagger gives you a clickable page for every endpoint): **`docs/testing/TESTING_GUIDE.md`**. As of this session it covers the complete cold start (checking Node/npm, checking and starting Postgres, first-time database creation, `npm install`, seeding the first admin login, starting the server) through all 82 endpoints in the app — auth, the full master-data reference (Section 3, all 29 endpoints), appointments, the Technician Mobile API, Job Cards, Estimates, and Workshop + Inventory — plus a troubleshooting table and a new **Section 11** full endpoint index you can use to confirm nothing's missing. Every step in it was verified against a live server or the real DTOs before being written down, so it should just work if you follow it in order.

Also new this session: `npm run seed:technician` now accepts `SEED_TECH_ROLE` (e.g. `TECHNICIAN_WORKSHOP`, `WAREHOUSE_CLERK`) so you can seed a test login for any role, not just `TECHNICIAN_FIELD` — same pattern as `npm run seed:admin`.

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

To try Job Cards, you need a Technician Mobile API flow completed (S/N + fault/symptom captured) on an appointment that also has an `invoiceNumber` set, then back as **admin/CCE**:
```
POST /job-cards                          { "appointmentId": "..." }
POST /job-cards/:id/validate-sn          { "matches": true }
POST /job-cards/:id/assign-section       { "section": "ON_SITE_REPAIR" }
POST /job-cards/:id/warranty-override    { "newStatus": "OOW", "reason": "..." }   (Technical Team Leader+ only)
GET  /job-cards/:id
GET  /job-cards/by-appointment/:appointmentId
```

To try Estimates (needs an OOW Job Card that's `SN_VALIDATED`):
```
POST /estimates                          { "jobCardId": "...", "lineItems": [...] }
POST /estimates/:id/send
GET  /estimates/public/:token                                    (no login needed)
POST /estimates/public/:token/respond    { "approved": true }    (no login needed)
POST /estimates/:id/record-response      { "approved": true, "contactMethod": "PHONE_CALL", "contactValue": "...", "notes": "..." }
POST /estimates/:id/revise               { "lineItems": [...] }  (only after a reject)
GET  /estimates/:id
GET  /estimates/by-job-card/:jobCardId
```
There's also two ready-made PowerShell smoke-test scripts if you'd rather run the whole flow at once instead of clicking through Swagger: `scripts/phase4-e2e-test.ps1` (full create → reject → revise → approve → assign-section chain) and `scripts/phase4-notif-check.ps1` (confirms notification attempts actually fire once a template exists). Run either with `powershell -ExecutionPolicy Bypass -File scripts\phase4-e2e-test.ps1` while the dev server is up.

To try Workshop + Inventory (needs a Job Card already `assign-section`'d to `WORKSHOP`):
```
POST /master-data/spare-parts/:id/link-model    { "modelId": "..." }        (required before GRN will accept stock - AC-17)
POST /inventory/grn                             { "sparePartId": "...", "quantity": 5, "notes": "..." }
POST /workshop/:jobCardId/assign                { "technicianId": "..." }
POST /workshop/:jobCardId/start-wip
POST /workshop/:jobCardId/request-spare         { "sparePartId": "...", "quantity": 2 }
POST /inventory/reservations/:id/review         { "decision": "APPROVE_REALLOCATION", "notes": "..." }
POST /inventory/reservations/:id/request-return
POST /inventory/reservations/:id/confirm-return { "quantityReturned": 2 }
POST /job-cards/:id/cancel                      { "reason": "..." }
PATCH /auth/users/:id/deactivate
GET  /inventory/stock/:sparePartId
GET  /inventory/reservations/stale
GET  /workshop/:jobCardId
```
There's also a ready-made PowerShell smoke-test script covering the whole flow at once: `scripts/phase5-e2e-test.ps1` — AC-17 negative case, GRN, full + partial reservation, the deactivation custody guard (blocked then unblocked), job-card cancel auto-releasing reservations, and confirm-return. Run it with `powershell -ExecutionPolicy Bypass -File scripts\phase5-e2e-test.ps1` while the dev server is up.

All endpoints show up in Swagger under their respective tags (`job-cards`, `estimates`, `estimates-public`, `inventory`, `workshop`).

---

## Next: Phase 6 — QC + Inventory auto-deduct

What it covers, from the implementation plan: a Quality Control step after workshop repair
work finishes, plus the "mark spare as consumed" step that Phase 5 deliberately left out
(flagged repeatedly above — on-hand stock currently only ever goes up, via GRN or a
confirmed return, and nothing ever permanently subtracts a spare that was genuinely used).

Concretely, that likely means:
- A QC gate on a `WORKSHOP`-section Job Card once it reaches `READY_FOR_QC` — a QC Officer
  role checking the completed repair before it's allowed to move on, matching the discovery
  doc's `QC_OFFICER` role that already exists but has nothing to do yet.
- The actual consumption step: when a Job Card passes QC (or completes, if QC turns out not
  to gate every job type), every spare-part reservation still attached to it that was
  genuinely used — not returned — needs to be marked `CONSUMED` and have its quantity
  permanently subtracted from `InventoryStock.quantityOnHand`. Right now nothing does this;
  it's the single biggest correctness gap in the inventory model as it stands.
- Likely also where the Component Yield Matrix (Section 3i — already built as master data
  but unused so far) starts to matter: when an appliance is dismantled/scrapped, this table
  says whether a component gets recovered as a spare, treated as a consumable, or scrapped.

Same process as every phase so far: a `the-fool` pre-mortem on the design before writing
code (Phase 5's caught four real gaps this way), then implementation, then a live end-to-end
verification script, then this document and the testing guide both get updated. Ready to
start whenever you are — just say the word.

---

## Open items / blockers (from planning docs, still unresolved)

- Mobile framework decision: Flutter vs React Native
- WhatsApp Business API account approval (2–4 weeks lead time) — now also blocking real Estimate notification delivery (Phase 4)
- External Warranty API access/documentation
- Acceptance criteria not yet validated with stakeholders
- `backend/`/`frontend/` folder layout vs. actual `src/` layout — decide whether to reconcile before the React frontend is scaffolded
- Phase 6 (QC) needs to add the "mark spare as consumed" step that permanently deducts `quantityOnHand` for a completed job's used spares (see Phase 5 section above) — otherwise on-hand stock only ever goes up
