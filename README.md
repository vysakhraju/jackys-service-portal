# Jacky's Service Portal

Field-Service-First Service Management System for Jacky's Distribution.

Built with **NestJS + PostgreSQL + JWT** (backend) and **React** (frontend).

## Status

Backend: MVP (8-week plan) + AMC + Dismantling + Reports/Dashboards + Warranty Claims +
Finance/Quality/Operational Dashboards + User Management + Extra Role Access + Job Card
Journey + admin Reset Password all built and live-verified — 185+ REST endpoints, 2
WebSocket gateways (live Kanban board + Need Spare pop-up notifications), 777/777
automated backend tests passing. Frontend: all 12 phases (Authentication through
Reports/Dashboards) built and live-verified, plus User Management, Extra Role Access,
Job Card Journey, and admin Reset Password — 440/440 automated frontend tests passing.

Mobile app (`mobile/`, React Native/Expo, Field Technician only): **all 5 planned
phases built and live-verified** - login, Today's Schedule, Start Visit + GPS, Serial
Number/warranty + Fault/Symptom capture, an offline queue so a technician with no
signal can keep working and sync automatically once reconnected, and Need Spare +
Complete/QC-handoff (with a Team Leader review screen and a live pop-up notification on
the web side). Push notifications are the one deliberately-deferred piece, parked for
v1.1 in favor of pull-to-refresh. See "Running the Mobile App" below and
`mobile/README.md` for the full walkthrough.

What's actually left to build, roughly in priority order: a Gantt-style technician
assignment board with conflict detection (the last open item from a competitor-system
review - see `docs/planning/STATUS_TRACKER.md`'s "Redtra360 competitor-system review"
entry for the full comparison and what's already been adopted from it); notify-customer/
notify-technician checkboxes on appointment creation (parked behind the WhatsApp
Business account approval below, same as real Estimate notification delivery); the
customer portal's branding/visual design pass; and auto-collapsing job card sections as
a job accumulates more stages. None of these are blockers - the app is fully usable and
tested end-to-end without them.

Full detail, updated every session: **`docs/planning/STATUS_TRACKER.md`** (what's
built, what's not, design decisions and honest simplifications) and
**`docs/testing/TESTING_GUIDE.md`** (a complete click-through testing guide, endpoint
by endpoint, including the mobile app). Start with those two files, not this README,
for anything beyond "how do I start the app."

## Project Structure

```
jackys-service-portal/
├── src/                      # NestJS backend (not backend/src/ — see note below)
│   ├── auth/                  # Authentication & Authorization
│   ├── master-data/           # Service centres, fault/symptom, spare parts, price lists...
│   ├── appointments/          # Appointment scheduling
│   ├── technician/            # Technician Mobile API (GPS, S/N, warranty, fault codes)
│   ├── job-cards/             # Job Card creation, S/N validation, warranty override
│   ├── estimates/              # OOW estimate approval (shareable link + staff-recorded)
│   ├── workshop/              # Assign, WIP, spare requests, QC handoff
│   ├── inventory/              # Reservation model, GRN, QC-time consumption
│   ├── permissions/            # Admin-assignable QC/rework approval grants
│   ├── delivery/                # Batch/normal delivery, DLV#, POD, OOW-paid block
│   ├── invoicing/                # Minimal invoice + payments (Cash/Card/Bank/B2B Credit)
│   ├── debit-notes/               # Interdepartment recharge (B2B_SALES_CHANNEL, IW)
│   ├── gl-ledger/                  # Internal GL posting log
│   ├── customer-portal/              # Public read-only track/invoice/summary pages
│   ├── amc/                          # AMC contracts, PM schedule, billing, renewal
│   ├── dismantling/                   # Defective/DOA component recovery
│   ├── reports/                        # Dashboards: Kanban (REST + WebSocket), aging, KPIs
│   ├── notifications/                    # WhatsApp/Email/SMS adapters (stubbed, no live provider yet)
│   └── common/                            # Shared decorators, interceptors, filters, DTOs
├── frontend/                    # React app (Vite + TS + TanStack Query + React Hook Form)
│   └── src/
│       ├── lib/                # api client, auth context, shared types
│       ├── components/         # ProtectedRoute, AppLayout
│       └── pages/               # LoginPage, DashboardPage, ... (more added each phase)
├── mobile/                      # React Native/Expo app - Field Technician only (see mobile/README.md)
│   └── src/
│       ├── app/                 # expo-router screens (file-based routing)
│       ├── context/             # AuthContext, OfflineQueueContext
│       ├── lib/                 # api client, offline queue engine, types
│       └── components/          # OfflineBanner, FaultSymptomPicker, StatusPill
├── scripts/                     # Seed scripts + PowerShell E2E test scripts per phase
├── docs/
│   ├── brd/                   # Original BRD documents
│   ├── discovery/                # Discovery document
│   ├── planning/                  # Implementation plan, STATUS_TRACKER.md, status dashboard
│   └── testing/                    # TESTING_GUIDE.md
├── .env                          # Backend config (gitignored — see Environment Variables below)
├── package.json
├── tsconfig.json
└── nest-cli.json
```

> **Note on the `src/` vs `backend/src/` layout**: the original plan's file tree assumed a
> `backend/frontend/shared` monorepo layout. In practice the backend was scaffolded
> directly into `src/` and stayed there — moving already-working code just to match the
> diagram wasn't worth the churn. The `frontend/` folder is real and current; there is no
> `backend/` folder.

## Prerequisites

Already installed and confirmed working on this machine — nothing to install fresh:

| Tool | Version |
|---|---|
| Node.js | v22+ |
| npm | v10+ |
| PostgreSQL | 16.x, running as a Windows service (`postgresql-x64-16`) |

There is **no Docker involved** — an earlier draft of this README mentioned
`docker-compose`, which was never actually used; Postgres runs as a native Windows
service on port 5432.

## Running Everything

Two independent things run side by side: the **backend** (NestJS API + Swagger, port
3000) and the **frontend** (React app, port 5173). Both need to be running at the same
time for the frontend to actually work — the frontend just calls the backend over HTTP.

### 1. Make sure PostgreSQL is running

It's installed as a Windows service and normally starts automatically on boot. To check
or start it manually:

```powershell
Get-Service postgresql-x64-16
# if it's not "Running":
Start-Service postgresql-x64-16
```

### 2. Start the backend (API + Swagger)

```powershell
cd "D:\Jackys\jackys service portal"
npm run start:dev
```

Leave this window open — it's a dev server in watch mode (it auto-restarts whenever a
`.ts` file changes) and needs to keep running the whole time you're testing. Once it
says the app is listening:

- **Swagger UI** (click-through API testing, no code needed): **http://localhost:3000/api/docs**
- **Raw API base URL**: http://localhost:3000/api/v1

First time only, if you don't have a login yet:
```powershell
npm run seed:admin
```
This creates the first account: `admin@jackys.com` / `Admin123!`. You only need to run
this once, ever — it's already been run on this machine.

### 3. Start the frontend (React app)

Open a **second** PowerShell window (don't close the backend one) and run:

```powershell
cd "D:\Jackys\jackys service portal\frontend"
npm run dev
```

This is also a dev server in watch mode. Once it's ready:

- **App**: **http://localhost:5173** — sign in with `admin@jackys.com` / `Admin123!`

If this is a completely fresh machine and `frontend/node_modules` doesn't exist yet, run
`npm install` in that folder once before `npm run dev`.

### 4. Stopping everything

Each dev server runs in its own PowerShell window — the simplest way to stop it is to
click into that window and press **Ctrl+C**, then close the window if you want.

If a window got closed without stopping the server first (so the port's still in use and
`npm run start:dev`/`npm run dev` complains it can't bind), free the port instead:

```powershell
# Free port 3000 (backend)
Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess | Stop-Process -Force

# Free port 5173 (frontend)
Get-Process -Id (Get-NetTCPConnection -LocalPort 5173).OwningProcess | Stop-Process -Force
```

PostgreSQL can stay running all the time — no need to stop it between sessions
(`Stop-Service postgresql-x64-16` if you ever genuinely need to).

### Quick reference

| Thing | Command | URL |
|---|---|---|
| Start backend | `npm run start:dev` (repo root) | http://localhost:3000/api/docs (Swagger) |
| Start frontend | `npm run dev` (in `frontend/`) | http://localhost:5173 |
| Stop either | `Ctrl+C` in its window | — |
| Free a stuck port | see the two commands above | — |
| First-ever login setup | `npm run seed:admin` (repo root, once only) | — |
| Default login | — | `admin@jackys.com` / `Admin123!` |

## Letting a Colleague Test Over the Same Wi-Fi (LAN)

Both servers bind to `localhost` by default, which only your own laptop can reach. To
let a colleague on the same office Wi-Fi open the app from their own machine/phone,
point them at your laptop's LAN IP instead — no separate deployment needed.

### 1. Find your laptop's LAN IP

```powershell
ipconfig
```

Look for the `IPv4 Address` under your active adapter (Wi-Fi or Ethernet) — e.g.
`192.168.60.85`. Use that number in place of `192.168.60.85` below if yours is different.

### 2. Allow the frontend's origin in the backend's CORS config

Edit the repo-root `.env` file and set (or add) `CORS_ORIGIN` to a **comma-separated
list that still includes `localhost`**:

```
CORS_ORIGIN=http://localhost:5173,http://192.168.60.85:5173
```

> **Important — this is a real footgun, not a hypothetical**: `CORS_ORIGIN`
> **replaces** the whole allowed-origins list, it does not add to the built-in
> defaults. If you set it to only the LAN address (`CORS_ORIGIN=http://192.168.60.85:5173`),
> your *own* `http://localhost:5173` frontend will immediately start failing to log in
> with a CORS error in the browser console, even though Swagger still works fine
> (Swagger isn't a cross-origin request, so it doesn't hit this check). Always include
> both origins, comma-separated, as shown above.

Editing `.env` is the recommended way since it persists across restarts. If you'd
rather not touch `.env`, you can set it just for the current PowerShell window instead
(PowerShell doesn't support the `VAR=value` bash syntax — use `$env:`):

```powershell
$env:CORS_ORIGIN="http://localhost:5173,http://192.168.60.85:5173"
npm run start:dev
```

### 3. Start the frontend so it's reachable from other devices

By default Vite's dev server also only listens on `localhost`. Start it with `--host`
so it binds to your LAN interface too:

```powershell
cd "D:\Jackys\jackys service portal\frontend"
npm run dev -- --host
```

### 4. Point the frontend at your LAN IP (not `localhost`)

Edit `frontend/.env` (create it if it doesn't exist) so the app calls the backend at
your LAN IP instead of `localhost` — this still works fine for you too, since your own
laptop can reach itself by its LAN IP:

```
VITE_API_BASE_URL=http://192.168.60.85:3000/api/v1
VITE_WS_BASE_URL=http://192.168.60.85:3000
```

Restart `npm run dev -- --host` after saving so Vite picks up the change.

### 5. Share the URL

Your colleague opens **`http://192.168.60.85:5173`** in their own browser (same Wi-Fi
network required) and signs in normally.

> **Note — OS-level browser notifications don't work over a LAN address.** The Need
> Spare pop-up now has two layers (added 2026-09-09): an in-app toast (always works) and
> a real OS/browser notification (the "Enable notifications" banner a Team
> Leader/Service Head/Super Admin sees). The OS notification uses the browser's
> Notifications API, which only works in a *secure context* — `https://`, or
> `http://localhost` / `http://127.0.0.1`. `http://192.168.60.85:5173` is **not** a
> secure context, so anyone testing over the LAN address (including you, if you're the
> one using it) will only ever get the toast there, never the OS pop-up, even after
> clicking "Enable notifications". This isn't a bug to chase — there's no workaround
> short of serving over HTTPS or a real deployment domain. If you need to verify the OS
> notification itself, test from `http://localhost:5173` instead.

### 6. If it still can't connect: check the Windows Firewall

Windows may block inbound connections on ports 3000/5173 from other devices the first
time. If your colleague's browser just hangs/times out (as opposed to a CORS error),
allow the ports:

```powershell
New-NetFirewallRule -DisplayName "Jackys Backend 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "Jackys Frontend 5173" -Direction Inbound -LocalPort 5173 -Protocol TCP -Action Allow
```

### Switching back to solo/localhost-only testing

Set `CORS_ORIGIN` back to just `http://localhost:5173` (or remove it from `.env`
entirely — the backend's built-in default already includes it), and change
`frontend/.env` back to `http://localhost:3000/...`. Restart both servers.

## Running the Mobile App (Field Technician)

The mobile app is a separate React Native/Expo project in `mobile/` - it talks to the
same backend over HTTP, so steps 1-2 above (Postgres + `npm run start:dev`) still need
to be running. There's no separate mobile backend.

**Prerequisites** (in addition to the backend already running):
- A way to load the app - either the free **Expo Go** app on a real phone (fastest to
  set up), an **Android emulator** (Android Studio), or the **iOS Simulator** (Mac +
  Xcode only).
- Your machine's **LAN IP address** (`ipconfig`, look for `IPv4 Address`) - a phone
  can't reach `localhost`, it needs your PC's real address on the network.
- A `TECHNICIAN_FIELD` login - create one with `npm run seed:technician` (repo root)
  if you don't already have one.

**Start it:**

```powershell
cd "D:\Jackys\jackys service portal\mobile"
npm install
cp .env.example .env
```

Edit `mobile/.env` and set `EXPO_PUBLIC_API_BASE_URL` to `http://<your LAN
IP>:3000/api/v1` (not `localhost`), then:

```powershell
npm start
```

This opens the Expo dev server and prints a QR code. Scan it with Expo Go (phone must
be on the **same Wi-Fi network** as this PC), or press `a`/`i` in the terminal for an
Android emulator/iOS Simulator. Sign in with the `TECHNICIAN_FIELD` login above.

**What's built:** all 5 planned phases - login + Today's Schedule, Start Visit + GPS
capture, Serial Number/warranty + Fault/Symptom capture, an offline queue that lets a
technician keep working with no signal and syncs automatically once reconnected, and
Need Spare + Complete/QC-handoff (a technician can request a spare or hand off a
finished repair to QC fully offline; it syncs and routes to a Team Leader review screen
- with a live pop-up notification on the web side - once reconnected). All built and
live-verified. Push notifications are the one deliberately-deferred piece (v1.1,
pull-to-refresh covers it for now).

**Full walkthrough, including a real device-connectivity test for the offline queue
and troubleshooting a stuck LAN connection:** `mobile/README.md`. Endpoint-level detail
for everything the mobile app calls: `docs/testing/TESTING_GUIDE.md`.

## How to actually test the app

- **Swagger** (every backend endpoint, 158+ of them): open
  http://localhost:3000/api/docs, click **Authorize**, log in, then try any endpoint —
  `docs/testing/TESTING_GUIDE.md` walks through every module with sample request
  bodies, in the order to test them in (each module generally needs data from the one
  before it, e.g. you need an Appointment before you can create a Job Card).
- **The React app** (all 12 frontend phases, Authentication through
  Reports/Dashboards, plus User Management and Extra Role Access - Sections 18-29 and
  32-33 of the testing guide): open http://localhost:5173, sign in, look around.
- **The mobile app** (Field Technician only, Phases 1-4 - Section 34 of the testing
  guide): see "Running the Mobile App" above.
- There are also ready-made PowerShell smoke-test scripts per backend phase under
  `scripts/` (e.g. `scripts/phase7-e2e-test.ps1`) that run a whole workflow end-to-end in
  one shot instead of clicking through Swagger manually — see the testing guide for which
  script covers which module.

## Key Features Implemented

### Auth Module
- JWT authentication (HS256) with access (15m) + refresh (7d) tokens
- Role-based access control (14 roles from BRD)
- Audit logging on all mutating operations
- Password hashing with bcrypt (12 rounds)

### Master Data (9 entities)
Service Centre schedules, Fault/Symptom library, Spare Parts + Model mapping, Service
Price List, Technician KPI Rules, Notification Templates, Warranty Master, Component
Yield Matrix — plus bulk CSV import.

### Everything else
Appointments, Technician Mobile API, Job Cards + warranty override, Estimates (customer
approval flow), Workshop + Inventory (reserve/consume model), QC gate + admin-assignable
permissions, Delivery + POD + OOW payment block, Invoicing + interdepartment Debit Notes
+ GL posting log, Customer Portal (public tracking pages), AMC contracts, Dismantling
(component recovery), and Reports/Dashboards (live WebSocket Kanban board). Full detail
on every one of these is in `docs/planning/STATUS_TRACKER.md`, phase by phase.

## User Roles (from BRD)

| Role | Description | Key Permissions |
|------|-------------|-----------------|
| SUPER_ADMIN | Full system access | All |
| SERVICE_HEAD | Service department head | Manage all, AMC, dismantling |
| TECHNICAL_TEAM_LEADER | Team leader | Spare validation, warranty override, job assignment, QC |
| CCE | Customer Care Executive | Appointments, job cards, estimates, invoices, customers |
| TECHNICIAN_FIELD | Field Technician | View jobs, update status, request spares, complete repair, POD |
| TECHNICIAN_WORKSHOP | Workshop Technician | View jobs, update status, log spares, complete repair, QC |
| QC_OFFICER | QC Officer | Manage QC, view workshop jobs |
| ACCOUNTANT | Finance Accountant | Invoices, payments, GL |
| FINANCE_MANAGER | Finance Manager | All finance, interdept, vendor claims |
| LOGISTICS_DISPATCHER | Logistics Dispatcher | Delivery, batch, ready jobs |
| DRIVER | Delivery Driver | View deliveries, capture POD |
| WAREHOUSE_CLERK | Warehouse Clerk | GRN, van stock, inventory |
| WARRANTY_CLERK | Warranty Clerk | Warranty claims |
| CUSTOMER | End Customer | Track jobs, approve estimates, pay invoices |

Note: QC approval and rework approval are **not** tied to the `QC_OFFICER` role alone —
they're admin-assignable to any user via the `permissions` module, by deliberate design
decision (see `STATUS_TRACKER.md`, Phase 6).

## Business Rules (Key)

From BRD Rev 2.1:
- **Field-Service-First**: Technician visits on-site FIRST, validates S/N + warranty
- **Inventory**: Spares RESERVED during WIP; deducted ONLY at QC Passed (auto Main Store → Damage Location)
- **S/N Validation**: Mandatory - no Job Card without invoice verification
- **OOW Approval**: Customer must approve via shareable link (or a staff-recorded call) before WIP; reject = RWR
- **Delivery Block**: OOW delivery blocked unless paid (B2B Credit exception)
- **Interdepartment**: B2B-SalesChannel auto-generates Internal Debit Note at QC
- **No Payment Gateway**: Manual only (Cash, Card, Bank Transfer, B2B Credit 30-day)
- **VAT**: 5% UAE / 15% KSA by service centre location

## Scripts

Backend (repo root):
```bash
npm run start        # Production build
npm run start:dev    # Development with hot reload (this is what you normally use)
npm run start:debug  # Debug mode
npm run build        # Build for production
npm run lint         # ESLint
npm run test         # Unit tests (489 passing)
npm run test:cov     # Coverage report
npm run seed:admin       # Create the first SUPER_ADMIN login (one-time, per database)
npm run seed:technician  # Create a test login for any role (SEED_TECH_ROLE env var)
```

Frontend (`frontend/`):
```bash
npm run dev      # Development server (this is what you normally use)
npm run build    # Type-check + production build
npm run preview  # Preview a production build locally
```

## Environment Variables

`.env` (repo root, gitignored — never committed) holds backend config. Key variables:

- `PORT` — backend port (3000)
- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` — Postgres connection
- `JWT_SECRET`, `JWT_REFRESH_SECRET` (min 32 chars, change in production!)
- `CORS_ORIGIN` — comma-separated allowed origins; must include the frontend's own
  origin (`http://localhost:5173` in dev) or the browser will silently block every
  request from it. **Setting this REPLACES the built-in default list, it does not
  add to it** — if you set it (e.g. for LAN testing, see "Letting a Colleague Test
  Over the Same Wi-Fi" above), always keep `http://localhost:5173` in the
  comma-separated list too, or your own local frontend will start failing to log in
  with a CORS error even though Swagger still works
- External API keys for WhatsApp, Email, SMS, Warranty (not yet wired to a real provider)

`frontend/.env` (also gitignored) holds the frontend's own config — just the backend's
URL, so it's easy to point the app somewhere else later:
```
VITE_API_BASE_URL=http://localhost:3000/api/v1
VITE_WS_BASE_URL=http://localhost:3000
```

## Documentation

- **BRD**: `docs/brd/`
- **Discovery**: `docs/discovery/DISCOVERY_v1.md`
- **Implementation Plan**: `docs/planning/IMPLEMENTATION_PLAN_v1.md`
- **Status Tracker** (what's built, phase by phase): `docs/planning/STATUS_TRACKER.md`
- **Testing Guide** (how to test every endpoint + the app, including the mobile app):
  `docs/testing/TESTING_GUIDE.md`
- **Mobile App** (scope, running it, full testing walkthrough): `mobile/README.md`,
  scoped in `docs/planning/MOBILE_APP_SCOPE_v1.md`

## License

Private - Jacky's Distribution
