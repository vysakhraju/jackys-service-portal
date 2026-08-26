# Jacky's Service Portal

Field-Service-First Service Management System for Jacky's Distribution.

Built with **NestJS + PostgreSQL + JWT** (backend) and **React** (frontend).

## Status

Backend: MVP (8-week plan) + AMC + Dismantling + Reports/Dashboards all built and
live-verified — 140 REST endpoints, 1 WebSocket gateway, 489 automated tests passing.
Frontend: phase 1 of 12 (Authentication) built and live-verified; the rest are being
built one module at a time in the same order the backend was.

Full detail, updated every session: **`docs/planning/STATUS_TRACKER.md.new`** (what's
built, what's not, design decisions and honest simplifications) and
**`docs/testing/TESTING_GUIDE.md.new`** (a complete click-through testing guide, endpoint
by endpoint). Start with those two files, not this README, for anything beyond "how do I
start the app."

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
├── scripts/                     # Seed scripts + PowerShell E2E test scripts per phase
├── docs/
│   ├── brd/                   # Original BRD documents
│   ├── discovery/                # Discovery document
│   ├── planning/                  # Implementation plan, STATUS_TRACKER.md.new, status dashboard
│   └── testing/                    # TESTING_GUIDE.md.new
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

## How to actually test the app

- **Swagger** (backend only, works today for all 140 endpoints): open
  http://localhost:3000/api/docs, click **Authorize**, log in, then try any endpoint —
  `docs/testing/TESTING_GUIDE.md.new` walks through every module with sample request
  bodies, in the order to test them in (each module generally needs data from the one
  before it, e.g. you need an Appointment before you can create a Job Card).
- **The React app** (only Authentication is built so far — Section 18 of the testing
  guide): open http://localhost:5173, sign in, look around, and tell me what looks wrong
  or confusing so the next frontend phase can fix it before it compounds.
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
on every one of these is in `docs/planning/STATUS_TRACKER.md.new`, phase by phase.

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
decision (see `STATUS_TRACKER.md.new`, Phase 6).

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
  request from it
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
- **Status Tracker** (what's built, phase by phase): `docs/planning/STATUS_TRACKER.md.new`
- **Testing Guide** (how to test every endpoint + the app): `docs/testing/TESTING_GUIDE.md.new`

## License

Private - Jacky's Distribution
