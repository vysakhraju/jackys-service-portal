# Jacky's Service Portal — Status Tracker

**Last updated:** 2026-08-24
**Stack:** NestJS + PostgreSQL + JWT + React
**Repo:** `D:\Jackys\jackys service portal` (git initialized, 5 commits on `master`)

This tracks where the build actually stands, phase by phase, against the 8-week plan in `docs/planning/IMPLEMENTATION_PLAN_v1.md`. Source docs: `docs/brd/`, `docs/discovery/DISCOVERY_v1.md`.

---

## Phase list & status

| # | Phase | Status |
|---|-------|--------|
| 0 | Dev environment setup | ✅ Done — Postgres installed, DB created, app running on your machine |
| 1 | Verify & test Auth + Master Data (already coded) | ✅ Done — 9 real bugs found & fixed, confirmed working on your machine |
| 2 | Appointments + Technician Mobile API | 🟡 Appointments done (was coded but not wired in — fixed); Technician Mobile API not started |
| 3 | Job Cards + Warranty Check | ⬜ Not started |
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
Test Suites: 6 passed, 6 total
Tests:       115 passed, 115 total
```

| File tested | Stmt % | Branch % |
|---|---|---|
| `auth/auth.service.ts` | 100% | 100% |
| `auth/strategies/jwt.strategy.ts` | 100% | 75% |
| `auth/strategies/refresh.strategy.ts` | 100% | 85.7% |
| `auth/guards/refresh-auth.guard.ts` | 100% | 100% |
| `appointments/appointments.service.ts` | 98.95% | 89.6% |
| `master-data/master-data.service.ts` | 89.5% | 75% |

New spec files: `src/auth/auth.service.spec.ts`, `src/auth/strategies/jwt.strategy.spec.ts`, `src/auth/strategies/refresh.strategy.spec.ts`, `src/auth/guards/refresh-auth.guard.spec.ts`, `src/master-data/master-data.service.spec.ts`, `src/appointments/appointments.service.spec.ts`. Committed as `8c1bdc9`.

Not yet covered: controllers, modules, DTOs, `AuditInterceptor`, `RolesGuard`/`JwtAuthGuard` — these are thin wiring/decorator layers, lower priority than the service-layer business logic. Worth adding light coverage (mainly guard/interceptor unit tests) before Phase 2 sign-off if you want the 90% target applied repo-wide rather than just to the tested services.

Run them yourself anytime with:
```powershell
cd "D:\Jackys\jackys service portal"
npm test                    # just run the suite
npm run test:cov            # with a coverage report
```

---

## Phase 2: Appointments + Technician Mobile API

- **Appointments**: fully implemented — create (with capacity + technician-availability checks), list/filter, dashboard stats, service-centre & technician schedules, assign technician, confirm, mark on-site, complete, cancel. Now correctly wired into the app (see bug #2 above).
- **Technician Mobile API** (GPS capture on visit start, S/N capture, warranty check, fault/symptom codes): **not started**. This is the next real coding work.

---

## Known issue to fix later (not blocking)

`User.refreshTokenHash` (a bcrypt hash) is returned in nested user objects on some responses (e.g. `appointment.createdBy.refreshTokenHash`) because it lacks `select: false` and there's no active response-serialization filter. Not immediately exploitable, but worth tightening — add `select: false` similarly to `passwordHash`, with an explicit re-select where actually needed (`RefreshStrategy`).

---

## Try it yourself right now

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

---

## Open items / blockers (from planning docs, still unresolved)

- Mobile framework decision: Flutter vs React Native
- WhatsApp Business API account approval (2–4 weeks lead time)
- External Warranty API access/documentation
- Acceptance criteria not yet validated with stakeholders
- `backend/`/`frontend/` folder layout vs. actual `src/` layout — decide whether to reconcile before the React frontend is scaffolded
