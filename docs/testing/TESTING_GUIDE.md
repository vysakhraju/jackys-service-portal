# Testing Guide — Try It Yourself

**For:** someone new to NestJS/PostgreSQL/JWT who wants to click through the API and see it actually work, with no UI yet.
**What you're using:** Swagger — an auto-generated web page that lists every API endpoint and lets you send real requests to your own running server by clicking buttons and filling in forms. It's built into the app; you don't install anything extra.

Everything below runs on **your own machine** against **your own database**. Nothing here talks to the internet. If something doesn't match what you see, that's useful information — tell me exactly what you see and I'll fix it.

**This guide covers every single endpoint in the app** — Section 11 at the end is a full checklist you can use to confirm nothing was skipped.

---

## 0. Before you start

Do these in order. If you've already got the server running from a previous session, skip to **0f**.

### 0a. Check Node.js and npm are installed
```powershell
node -v
npm -v
```
Should print version numbers (Node 18+ is fine). If either command isn't recognized, Node.js isn't installed or isn't on your PATH — install it from nodejs.org (LTS version) and reopen PowerShell.

### 0b. Check PostgreSQL is running
It's installed as a Windows service, so it should already be running:
```powershell
Get-Service postgresql-x64-16
```
Status should say `Running`. If it says `Stopped`:
```powershell
Start-Service postgresql-x64-16
```
If the service doesn't exist at all, PostgreSQL isn't installed yet — that's a bigger step (install PostgreSQL 16, set a `postgres` user password, make sure it matches `.env`) and not something this guide walks through; tell me and I'll help.

### 0c. First time only: create the database
If you've tested before, the database already exists — skip this. On a fresh machine, or if you ever need to start over completely:
```powershell
psql -U postgres -c "CREATE DATABASE jackys_service_portal;"
```
It'll ask for the `postgres` user's password (check `.env` in the project root for `DB_PASSWORD` if you don't remember it — default is `postgres`). The app creates all the tables itself the first time it starts (see 0f) — you don't need to run any SQL beyond creating the empty database.

### 0d. First time only: install dependencies
If `node_modules` already exists in the project folder, skip this — it only needs to happen once (or after pulling new code that changed `package.json`):
```powershell
cd "D:\Jackys\jackys service portal"
npm install
```

### 0e. First time only: create your first login
A fresh database has no users at all — there's no public sign-up page (on purpose). Run this once:
```powershell
cd "D:\Jackys\jackys service portal"
npm run seed:admin
```
This prints the admin email/password (defaults to `admin@jackys.com` / `Admin123!`, matching every example in this guide — override with `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` environment variables first if you want different credentials). Safe to skip if you already have this login working.

### 0f. Start the app
```powershell
cd "D:\Jackys\jackys service portal"
npm run start:dev
```
Wait until you see:
```
🚀 Application running on: http://localhost:3000
📚 Swagger docs: http://localhost:3000/api/docs
```
**Leave this window open** — this is your server. Closing it (or pressing Ctrl+C) stops the app. It also auto-restarts itself whenever a file changes, so if I make a code fix while you're testing, just wait a few seconds and try again. The very first time it starts, it also creates every database table automatically — you'll see a burst of `query: CREATE TABLE ...` lines scroll by, that's normal.

### 0g. Open Swagger
Open **http://localhost:3000/api/docs** in your browser. You'll see a list of sections (auth, master-data, appointments, technician, job-cards, estimates, estimates-public, inventory, workshop) — each one is a group of related endpoints. Click a section name to expand it and see its endpoints.

For every endpoint below, the pattern is always the same:
1. Click the endpoint to expand it.
2. Click the **"Try it out"** button (top right of the expanded box).
3. Edit the example JSON in the body box if needed.
4. Click **"Execute"**.
5. Scroll down slightly — the **Response body** and **Code** (e.g. `200`, `201`, `404`) appear right below.

A **2xx** code (200, 201) means success. A **4xx** code (400, 401, 403, 404, 409) means the request was rejected on purpose, for a specific reason shown in the response — these are just as useful to see as successes, because they prove the safety checks work.

---

## 1. Log in and authorize (do this first, every time)

### 1a. Login
1. Expand **`POST /auth/login`** under the **auth** section → Try it out.
2. Replace the example body with:
   ```json
   {
     "email": "admin@jackys.com",
     "password": "Admin123!"
   }
   ```
3. Execute. You'll get back a response with `accessToken`, `refreshToken`, and `user`.
4. Copy the whole `accessToken` value (the long string — don't include the quotes).
5. Scroll to the **top of the page** and click the green **"Authorize"** button (padlock icon).
6. Paste the token into the box (just the raw token, Swagger adds "Bearer" for you) → click **Authorize** → **Close**.

You're now logged in for every request you make in this browser tab. A padlock icon next to each endpoint shows it now requires — and has — that login.

Tokens expire after **15 minutes**. If you start getting `401 Unauthorized` after a break, either repeat this section, or use 1b below to refresh without a full re-login.

Try one more thing to prove it worked:
- **`GET /auth/profile`** → Try it out → Execute (no body needed). You should get your own admin user details back, `200`.

### 1b. Refresh your token (without logging in again)
**`POST /auth/refresh`** — hold onto the `refreshToken` from your login response (it lasts much longer than the access token, 7 days by default).
```json
{ "refreshToken": "PASTE_YOUR_REFRESH_TOKEN_HERE" }
```
Returns a brand-new `accessToken`/`refreshToken` pair. Re-click **Authorize** with the new access token if you want to keep using it in Swagger. Try it with a made-up string instead → expect **`401`**.

### 1c. Logout
**`POST /auth/logout`** (no body). Invalidates your stored refresh token server-side (your current access token still works until it naturally expires in 15 minutes, but `POST /auth/refresh` will no longer succeed with the old refresh token afterward).

### 1d. Change password (optional — careful)

**`POST /auth/change-password`**
```json
{
  "oldPassword": "Admin123!",
  "newPassword": "NewPassword456!"
}
```
**Don't run this on your admin account unless you actually want to change it** — every
other section in this guide logs in with `admin@jackys.com` / `Admin123!`, so changing it
here means updating that everywhere else too. If you just want to see it work, log in as
the technician test account from Section 4 first and change *that* password instead —
lower stakes, and you can always re-run `npm run seed:technician` to reset it.

If you do change the admin password for real, remember the new one — there's no "forgot
password" flow yet.

---

## 2. Roles (one-time setup)

- **`POST /auth/seed-roles`** → Try it out → Execute (no body). This creates all 14 roles (Field Technician, CCE, Warehouse Clerk, etc.) if they don't already exist. Safe to run more than once — it skips roles that are already there.

You need this done once before creating a technician test user in Section 4.

---

## 3. Master Data — set up the building blocks

Everything downstream (appointments, technician visits, workshop, inventory) needs these
records to point at. This section is the full reference for every master-data endpoint —
create the ones you need for the flow you're testing (3a, 3b, 3d, 3e are the minimum for
Sections 5–8; the rest are here so nothing's missing from this guide).

### 3a. Service Centre
**`POST /master-data/service-centres`**
```json
{
  "code": "DXB-TEST",
  "name": "Dubai Test Centre",
  "country": "UAE",
  "vatRate": 5,
  "schedule": {
    "monday":    { "isOpen": true, "startTime": "09:00", "endTime": "18:00", "breakStart": "13:00", "breakEnd": "14:00", "maxJobsPerDay": 20 },
    "tuesday":   { "isOpen": true, "startTime": "09:00", "endTime": "18:00", "breakStart": "13:00", "breakEnd": "14:00", "maxJobsPerDay": 20 },
    "wednesday": { "isOpen": true, "startTime": "09:00", "endTime": "18:00", "breakStart": "13:00", "breakEnd": "14:00", "maxJobsPerDay": 20 },
    "thursday":  { "isOpen": true, "startTime": "09:00", "endTime": "18:00", "breakStart": "13:00", "breakEnd": "14:00", "maxJobsPerDay": 20 },
    "friday":    { "isOpen": true, "startTime": "09:00", "endTime": "18:00", "breakStart": "13:00", "breakEnd": "14:00", "maxJobsPerDay": 20 },
    "saturday":  { "isOpen": true, "startTime": "09:00", "endTime": "18:00", "breakStart": "13:00", "breakEnd": "14:00", "maxJobsPerDay": 20 },
    "sunday":    { "isOpen": false, "startTime": "09:00", "endTime": "18:00", "breakStart": "13:00", "breakEnd": "14:00", "maxJobsPerDay": 0 }
  }
}
```
Copy the `id` from the response — you'll need it as `serviceCentreId` below. (`maxJobsPerDay: 20` for every open day means you won't hit the capacity limit while testing. `vatRate` is a percentage, used later when Estimates compute totals — Section 9.)

Look around and manage it:
- **`GET /master-data/service-centres?country=UAE`** — `country` filter is optional.
- **`GET /master-data/service-centres/{id}`** — one record.
- **`PUT /master-data/service-centres/{id}`** — same shape as create, every field optional (only send what you're changing), e.g. `{ "vatRate": 8 }`.
- **`DELETE /master-data/service-centres/{id}`** — soft delete (sets `isActive: false`, doesn't remove the row). **Super Admin only** — try it logged in as anyone else for a `403`.

### 3b. Fault + Symptom
**`POST /master-data/fault-symptoms`**
```json
{
  "faultCode": "F001",
  "faultDescription": "Not draining",
  "symptomCode": "S001",
  "symptomDescription": "Water remains in drum",
  "category": "WASHING_MACHINE"
}
```
- **`GET /master-data/fault-symptoms?category=WASHING_MACHINE`** — `category` filter is optional (list all if omitted).
- **`GET /master-data/fault-symptoms/code/{faultCode}`** — look one up by its fault code, e.g. `F001`.
- **`GET /master-data/fault-symptoms/symptom/{symptomCode}`** — look one up by its symptom code, e.g. `S001`.

### 3c. Warranty range
**`POST /master-data/warranty-master`**
```json
{
  "serialNumberRange": "SN100000-SN199999",
  "brand": "Samsung",
  "model": "WA80J5710",
  "warrantyPeriodMonths": 24,
  "supplier": "Samsung Gulf",
  "effectiveFrom": "2026-01-01",
  "effectiveTo": "2028-01-01"
}
```
`effectiveFrom`/`effectiveTo` are optional. This means any serial number that sorts between `SN100000` and `SN199999` counts as **in warranty (IW)**. Anything outside that range is **out of warranty (OOW)**.

You can check this directly right now, before even touching an appointment:
- **`GET /master-data/warranty-master/check/{serialNumber}?brand=Samsung`** → try `SN150000` (should say `isUnderWarranty: true`) and then `SN999999999` (should say `false`). `brand` query param is optional.

### 3d. Spare Part Models
**`POST /master-data/spare-part-models`**
```json
{
  "modelId": "WA80J5710",
  "brand": "Samsung",
  "modelName": "Front Load Washer 8kg"
}
```
This is a separate thing from `WarrantyMaster`'s `model` string above — it's the record spare parts actually link against (3f) and appointments/estimates reference by id. Copy the `id` from the response — that's the `modelId` you'll use in 3f and 10b, not the human-readable `WA80J5710` string.
- **`GET /master-data/spare-part-models`** — list all.

### 3e. Price Lists
**`POST /master-data/price-lists`**
```json
{
  "activityType": "REPAIR",
  "modelId": "PASTE_A_SPARE_PART_MODEL_ID_OR_LEAVE_OUT_FOR_A_GENERAL_RATE",
  "priceB2B": 150,
  "priceB2C": 220,
  "warrantyLaborCost": 0,
  "interdepartmentLaborCost": 100,
  "currency": "AED"
}
```
`activityType` is one of `INSTALL`, `REPAIR`, `DEMO`, `ON_SITE`, `PM`, `DISMANTLE`. `modelId` is optional — omit it for a rate that applies to every model.
- **`GET /master-data/price-lists?activityType=REPAIR&modelId=...`** — `activityType` is required, `modelId` optional (narrows to that model's specific rate if one exists).

### 3f. Spare Parts
**`POST /master-data/spare-parts`**
```json
{
  "code": "SP-1001",
  "name": "Drain Pump",
  "category": "MOTOR",
  "brand": "Samsung",
  "unitCost": 45,
  "unitPriceB2B": 65,
  "unitPriceB2C": 90,
  "minStockLevel": 5,
  "vanStockLevel": 2
}
```
- **`GET /master-data/spare-parts?category=MOTOR&brand=Samsung&active=true`** — all filters optional.
- **`GET /master-data/spare-parts/{id}`** — one record, including which models it's linked to.
- **`GET /master-data/spare-parts/model/{modelId}`** — every spare part linked to a given appliance model.
- **`POST /master-data/spare-parts/{id}/link-model`** — `{ "modelId": "..." }`. Links this spare part to an appliance model — **required before GRN (Section 10b) will accept stock for it**. Safe to call again with the same model (won't duplicate the link).

### 3g. Technician KPI Rules
**`POST /master-data/kpi-rules`**
```json
{
  "kpiName": "First-Time-Fix Rate",
  "weightage": 30,
  "target": 85,
  "incentivePoints": 10,
  "description": "Percentage of jobs resolved without a repeat visit"
}
```
- **`GET /master-data/kpi-rules`** — list all.

### 3h. Notification Templates
**`POST /master-data/notification-templates`**
```json
{
  "trigger": "ESTIMATE_SENT",
  "channel": "WHATSAPP",
  "subject": "Your repair estimate is ready",
  "body": "Hi {{customerName}}, your estimate for {{applianceModel}} is AED {{totalAmount}}. Approve here: {{link}}",
  "placeholders": ["customerName", "applianceModel", "totalAmount", "link"]
}
```
`trigger` is one of `APPOINTMENT_CONFIRMED`, `TECHNICIAN_DISPATCHED`, `TECHNICIAN_ARRIVED`, `ESTIMATE_SENT`, `ESTIMATE_APPROVED`, `ESTIMATE_REJECTED`, `JOB_COMPLETED`, `INVOICE_READY`, `PAYMENT_RECEIVED`, `DELIVERY_SCHEDULED`, `DELIVERED`, `AMC_RENEWAL_REMINDER`, `WARRANTY_EXPIRY`. `channel` is `WHATSAPP`, `EMAIL`, or `SMS`. Creating one of these for `ESTIMATE_SENT`/`WHATSAPP` (or `EMAIL`) is what makes Section 9b's send attempt find a template to use.
- **`GET /master-data/notification-templates`** — list all.
- **`GET /master-data/notification-templates/{trigger}/{channel}`** — look up the exact template a given trigger+channel combination would use, e.g. `/ESTIMATE_SENT/WHATSAPP`.

### 3i. Component Yield Matrix
**`POST /master-data/component-yield`**
```json
{
  "modelId": "PASTE_A_SPARE_PART_MODEL_ID_HERE",
  "originalBomItemCode": "BOM-4471",
  "itemName": "PCB Control Board",
  "category": "RECOVERABLE_SPARE",
  "convertedSparePartCode": "SP-1001"
}
```
This is planning data for a later phase — when a component is scrapped out of a dismantled appliance, this table says whether it's worth recovering as a spare, treating as a consumable, or scrapping outright. `category` is `RECOVERABLE_SPARE`, `CONSUMABLE`, or `SCRAP`.
- **`GET /master-data/component-yield/model/{modelId}`** — every yield entry for a model.
- **`GET /master-data/component-yield/category/{category}`** — every entry of one category, e.g. `RECOVERABLE_SPARE`.

### 3j. Bulk Import
**`POST /master-data/bulk-import/{entityType}`** — `{entityType}` matches the entity you're bulk-loading (e.g. `spare-parts`, `fault-symptoms`). Body is a JSON array of objects, each shaped like that entity's create DTO above:
```json
[
  { "code": "SP-2001", "name": "Door Seal", "category": "SEAL", "unitCost": 20 },
  { "code": "SP-2002", "name": "Belt", "category": "MECHANICAL", "unitCost": 15 }
]
```
This exists for loading a spreadsheet's worth of data in one call rather than clicking through 3a–3i one row at a time — useful once you have real catalogue data, not something you need for the walkthroughs in this guide.

---

## 4. Create a technician test account

There's no sign-up page (on purpose — real technician accounts get created by an admin), so use the helper script instead. **Open a second PowerShell window** (don't close the one running the server) and run:
```powershell
cd "D:\Jackys\jackys service portal"
npm run seed:technician
```
This prints a login email/password and a **user id** — copy the user id, you'll need it in the next step to assign appointments to this technician. By default this creates a **`TECHNICIAN_FIELD`** (on-site) technician.

Want a different email/password, or a different role (e.g. a workshop technician — see Section 10a)?
```powershell
$env:SEED_TECH_EMAIL="you@x.com"; $env:SEED_TECH_PASSWORD="Pass123!"; $env:SEED_TECH_ROLE="TECHNICIAN_WORKSHOP"; npm run seed:technician
```
Set any subset of those three environment variables before running the script in the same PowerShell window — omit any you don't want to override.

---

## 5. Appointments — as the admin/CCE

Still logged in as admin from Section 1.

### 5a. Create an appointment
**`POST /appointments`**
```json
{
  "type": "WARRANTY",
  "customerType": "B2C",
  "customerName": "Test Customer",
  "customerPhone": "+971501112222",
  "scheduledAt": "2026-08-27T10:00:00Z",
  "serviceCentreId": "PASTE_YOUR_SERVICE_CENTRE_ID_HERE",
  "brand": "Samsung",
  "modelNumber": "WA80J5710",
  "invoiceNumber": "INV-1001"
}
```
Use a `scheduledAt` date that's today or in the near future (any day except the one you set `isOpen: false` for — Sunday, above). Copy the appointment's `id` from the response.

`invoiceNumber` is optional on most appointments, but Section 8 (Job Cards) below won't let you create a Job Card without one — the invoice number on file is how the system knows there's something to verify the serial number against (FR-05). Include it now if you plan to try Section 8.

### 5b. Assign the technician
**`PUT /appointments/{id}/assign-technician`** — `id` = the appointment id, body:
```json
{ "technicianId": "PASTE_THE_TECHNICIAN_USER_ID_FROM_SECTION_4" }
```
Status moves from `SCHEDULED` to `TECHNICIAN_ASSIGNED`.

### 5c. Look around
- **`GET /appointments/{id}`** — the full record.
- **`GET /appointments?serviceCentreId=&technicianId=&status=&type=&dateFrom=&dateTo=&page=1&limit=20`** — the full list, every filter optional; leave them all off to see everything.
- **`GET /appointments/dashboard/stats`** — today's/this-week's counts by status.
- **`GET /appointments/service-centre/{serviceCentreId}/schedule?date=2026-08-27`** — one centre's day. `date` is required.
- **`GET /appointments/technician/{technicianId}/schedule?date=2026-08-27`** — one technician's day. `date` is required here too.
- **`GET /appointments/number/{appointmentNumber}`** — look one up by its human-readable number (e.g. `APT-0001`) instead of its id.

### 5d. Update an appointment
**`PUT /appointments/{id}`** — full update, every field from 5a optional plus `status`, `cancellationReason`, `technicianId`:
```json
{ "customerPhone": "+971501113333", "customerAddress": "456 New St, Dubai" }
```
Send only the fields you're changing.

### 5e. Confirm, on-site, complete (admin-side status moves)
These are the office/admin equivalents of steps a technician normally triggers themselves via Section 6 — useful for correcting a status by hand, or testing without a technician login. All take **no body**:
- **`PUT /appointments/{id}/confirm`** — `SCHEDULED`/`TECHNICIAN_ASSIGNED` → `CONFIRMED`.
- **`PUT /appointments/{id}/on-site`** — marks the technician as arrived (same effect as Section 6a's own start-visit call).
- **`PUT /appointments/{id}/complete`** — marks the appointment finished.

### 5f. Cancel an appointment (optional — this ends it)

**`PUT /appointments/{id}/cancel`**
```json
{ "reason": "Customer requested reschedule to next week" }
```
Only useful on an appointment you don't need anymore — cancelling is final for that
appointment (status → `CANCELLED`), so create a throwaway one via 5a first if you just want
to see this work rather than cancelling the one you'll use for Sections 6–8 below.
Try it again on the same appointment afterward → expect **`400`** ("Cannot cancel
completed/cancelled appointment").

### 5g. Delete an appointment (optional — Super Admin only, hard delete)

**`DELETE /appointments/{id}`** — removes the row entirely, unlike 5f's soft cancel. Restricted to **Super Admin** — try it as anyone else for a **`403`**. Use a throwaway appointment; there's no undo.

---

## 6. Technician Mobile API — as the technician

This is the part built this session: what a field technician does on their phone once they're on-site. Switch identities now:

1. **`POST /auth/login`** again, this time with the technician's email/password from Section 4.
2. Copy the new `accessToken`, click **Authorize** at the top again, paste it in (this replaces your admin session — you're now "logged in as the technician").

### 6a. Start the visit (captures GPS + time)
**`POST /technician/visits/{appointmentId}/start`**
```json
{ "gpsLat": 25.2048, "gpsLng": 55.2708 }
```
The appointment status moves to `ON_SITE`. (Any real lat/lng works — these are Dubai's coordinates as an example.)

### 6b. Capture the serial number (checks warranty)
**`POST /technician/visits/{appointmentId}/serial-number`**
```json
{ "serialNumber": "SN150000", "brand": "Samsung" }
```
This should come back with `"warrantyStatus": "IW"` — it's inside the range you created in Section 3c. Try it again with `"serialNumber": "SN999999999"` and you'll get `"OOW"` instead.

### 6c. Record the fault + symptom
**`POST /technician/visits/{appointmentId}/fault-symptom`**
```json
{ "faultCode": "F001", "symptomCode": "S001" }
```

### 6d. See the full visit record
**`GET /technician/visits/{appointmentId}`** — everything captured so far in one place.

### 6e. The technician's own schedule
**`GET /technician/schedule`** — no need to pass a technician id; it uses whoever you're logged in as.

---

## 7. Prove the guardrails work (optional, but satisfying)

These are meant to fail — that's the correct behavior:

- Try **6c (fault-symptom)** on a *fresh* appointment where you haven't done 6b (serial-number) yet → expect **`400 Bad Request`**: "Capture and validate the serial number before recording fault/symptom codes."
- Try **6a (start visit)** on an appointment that's assigned to a *different* technician while logged in as this one → expect **`403 Forbidden`**.
- Try **6c** with a fault code that doesn't exist, e.g. `"faultCode": "F999"` → expect **`404 Not Found`**.
- Try **`GET /technician/visits/{appointmentId}`** for an appointment you never started a visit for → expect **`404 Not Found`**.
- Try any endpoint in Section 6 **without** re-authorizing as admin (i.e., stay logged in as the technician) but on an appointment that isn't theirs → **`403`**, same as above.

---

## 8. Job Cards — S/N validation, section assignment, warranty override

Built this session (Phase 3). A Job Card is the office-side record that turns a completed
field visit into actual work: it exists to enforce two things before anyone touches the
appliance — the serial number really was checked against the invoice, and if the job is
out-of-warranty, the customer has agreed to pay before work starts. Switch back to being
logged in as **admin** (Section 1) — a Job Card is created and managed office-side, not by
the technician.

You'll need an appointment where you've already completed Section 5 (with `invoiceNumber`
set — see the note at the end of 5a) and all of Section 6 (visit started, S/N captured,
fault/symptom captured). If any of those is missing, creation is blocked on purpose — that's
the next step proving it.

### 8a. Create the Job Card
**`POST /job-cards`**
```json
{ "appointmentId": "PASTE_YOUR_APPOINTMENT_ID_HERE" }
```
Blocked (`400`) unless the appointment has an invoice number **and** the technician's visit
has a captured serial number, warranty check, and fault/symptom codes (FR-05). Blocked
(`409`) if a Job Card already exists for this appointment. On success you get back a
`jobCardNumber` (e.g. `JC-0001`) and the visit's data snapshotted onto it — copy the
response's `id`, you'll need it for every step below.

### 8b. Validate the serial number against the invoice
**`POST /job-cards/{id}/validate-sn`**
```json
{ "matches": true }
```
This is a human step — someone (a CCE) is confirming the S/N the technician captured
actually matches the physical invoice. `"matches": false` is also valid (with an optional
`"notes"` field) if it doesn't — the Job Card stays blocked from moving forward until you
call this again with `true`. Only works while the Job Card's `status` is still `OPEN`
(check the response of 8a).

### 8c. Assign a section — the point work actually starts
**`POST /job-cards/{id}/assign-section`**
```json
{ "section": "ON_SITE_REPAIR" }
```
(Or `"WORKSHOP"`.) Blocked (`400`) until 8b has been done with `matches: true`. If the
job's warranty status is `OOW` (out of warranty), also blocked until 8d (below) is done
first — this is the real enforcement point for "no work without a genuine check."

### 8d. Customer approval (only needed for OOW jobs) — superseded, see Section 9
**`POST /job-cards/{id}/approve-customer`**
```json
{ "notes": "Customer approved by phone, confirmed in CRM ticket #4521" }
```
Try creating a Job Card from an appointment whose serial number is **outside** the warranty
range from Section 3c (e.g. capture `"SN999999999"` in Section 6b instead of `"SN150000"`)
to get an OOW job, then try 8c on it — you'll get blocked until an approval is recorded.

**This endpoint still works but is no longer the intended path** — it was a temporary manual
stand-in for FR-06 before the Estimates module existed. Now that Phase 4 is built, use
**Section 9** instead: send a real Estimate and either let the customer respond via the
link (9c) or have staff record a phone/WhatsApp/email approval (9d) — both of those set the
same `customerApproved` flag this endpoint sets, so 8c unblocks either way. This endpoint is
kept only as a manual fallback; skip straight to Section 9 unless you're specifically testing
the old stopgap.

### 8e. Warranty Override (FR-17) — Technical Team Leader only
**`POST /job-cards/{id}/warranty-override`**
```json
{ "newStatus": "OOW", "reason": "Physical inspection found the warranty sticker had been tampered with" }
```
For correcting a warranty badge that was wrong (e.g. the technician's S/N-range lookup said
IW but a supervisor's on-site inspection says otherwise). Requires a `reason` of at least 5
characters — it's written to the permanent audit trail along with who did it and when. Can
be called more than once; each call is logged separately. If it flips an already
section-assigned job to `OOW`, any prior customer approval is automatically cleared — you'd
need to redo 8d before the job could (in a later phase) proceed further.

Restricted to **Technical Team Leader, Service Head, or Super Admin** — try it while logged
in as the technician from Section 6 to see the `403`.

### 8f. Look around
- **`GET /job-cards/{id}`** — the full record.
- **`GET /job-cards/by-appointment/{appointmentId}`** — look one up by its appointment instead of its own id.

### 8g. Prove the guardrails work
- Try **8a** on an appointment with no `invoiceNumber` → expect **`400`**.
- Try **8a** on an appointment where you haven't done Section 6 (no visit, or an incomplete one) → expect **`404`** or **`400`**.
- Try **8a** twice on the same appointment → expect **`409`** the second time.
- Try **8c** immediately after **8a** (skipping 8b) → expect **`400`**.
- Try **8c** on an OOW job without doing 8d first → expect **`400`**.
- Try **8e** while logged in as the technician → expect **`403`**.
- Try **8e** with `"reason": "hi"` (too short) → expect **`400`**.
- Try **8e** with `"newStatus"` equal to the job's current warranty status → expect **`400`** ("nothing to override").

### 8h. Cancel a Job Card
**`POST /job-cards/{id}/cancel`**
```json
{ "reason": "Customer withdrew the job, appliance being taken elsewhere" }
```
Sets the Job Card's status to `CANCELLED` and, if it's holding any active spare-part
reservations (Section 10), automatically moves every one of them to `RETURN_PENDING` — the
same as manually requesting each part's return (10g), just done for you in one call. Nothing
is added back to `quantityOnHand` yet, though — that still needs a Main Store clerk to
physically receive the part(s) and call `confirm-return` (10g) on each one.

Try it twice on the same Job Card → expect **`400`** the second time ("already CANCELLED").
Try it on a Job Card that's already `READY_FOR_QC` → also expect **`400`** — work that far
along isn't cancellable, only returnable/reworked through later-phase flows.

---

## 9. Estimates — the real customer-approval flow (replaces the Job Cards stopgap)

Built this session (Phase 4). This is what actually stands behind Section 8d
(`approve-customer`) now: a priced Estimate, a shareable link the customer can approve or
reject themselves, **and** a way for staff to record a decision obtained by phone/WhatsApp
call — because in practice most customers never click the link. Both paths lead to the
same place. You'll need a Job Card that's `SN_VALIDATED` and out-of-warranty (OOW) — do
Sections 5–8a/8b first, using an `SN999999999`-style serial in 6b so the job comes out
OOW, and stop after **8b** (don't do 8c/8d — Estimates replaces those for this flow).

### 9a. Create a DRAFT Estimate
**`POST /estimates`**
```json
{
  "jobCardId": "PASTE_YOUR_JOB_CARD_ID_HERE",
  "lineItems": [
    { "description": "Drum Motor Assembly (Part)", "quantity": 1, "unitPrice": 350.00 },
    { "description": "Labor - Workshop repair", "quantity": 1, "unitPrice": 120.00 }
  ]
}
```
Blocked (`400`) unless the Job Card is OOW and already `SN_VALIDATED`. Blocked (`409`) if
an active Estimate already exists for it. Totals (`subtotal`/`vatAmount`/`totalAmount`) are
computed server-side from the service centre's VAT rate — copy the response's `id`.

### 9b. Send it
**`POST /estimates/{id}/send`** (no body). Only works from `DRAFT`. Generates the
shareable link's token (valid 7 days) and attempts a notification on every configured
channel — copy the response's `accessToken`, you'll use it as `{token}` below. Nothing
actually gets delivered yet (no WhatsApp/SMS/email provider is wired up — see
`channelsAttempted` vs `channelsDelivered` in the response; the second one will be empty on
purpose until a real provider exists), which is exactly why 9d exists.

### 9c. The customer's side of the link (no login needed)
Open a new browser tab/incognito window — these two don't need the "Authorize" step at all:
- **`GET /estimates/public/{token}`** → the customer-safe summary (line items, total, expiry).
- **`POST /estimates/public/{token}/respond`**
  ```json
  { "approved": true, "notes": "Please proceed" }
  ```
  Try `"approved": false` instead to see the rejection path (9e below). Try calling
  **GET** again afterward → expect **`410 Gone`** (a decided estimate isn't a live page
  anymore). Try **respond** a second time → expect **`409 Conflict`**.

### 9d. Recording a decision staff obtained by phone (the realistic path)
Back to being logged in as **admin/CCE**. **`POST /estimates/{id}/record-response`**
```json
{
  "approved": true,
  "contactMethod": "PHONE_CALL",
  "contactValue": "PASTE_THE_APPOINTMENT_CUSTOMER_PHONE_HERE",
  "notes": "Called customer, confirmed total AED 493.50, approved to proceed"
}
```
`contactValue` must match the phone or email already on the appointment **exactly** — this
is deliberate: it stops anyone from attesting to a call with a number that isn't actually
on file. Try a made-up number first to see the **`400`** it produces before trying the
real one. `contactMethod` is also `WHATSAPP`, `EMAIL_REPLY`, or `IN_PERSON`. Whichever path
gets there first (this one or 9c) wins — the other gets a **`409`** if tried afterward, same
as 9c's own double-response guard.

Approving here does the same thing 8d used to: it sets `JobCard.customerApproved`, so
**`POST /job-cards/{id}/assign-section`** (Section 8c) now unblocks.

### 9e. Rejected → RWR → revise (not a dead end)
Reject an Estimate (via 9c or 9d with `"approved": false`) and the Job Card moves to a new
`RWR` status (Ready for Return) — `GET /job-cards/{id}` will show it. While `RWR`,
`validate-sn`/`assign-section`/`warranty-override` are all blocked (try one, expect
**`400`**). This isn't final, though — real customers often come back with "actually,
lower the price and I'll approve it":

**`POST /estimates/{id}/revise`** (on the *rejected* estimate's id)
```json
{
  "lineItems": [
    { "description": "Drum Motor Assembly (Part) - discounted", "quantity": 1, "unitPrice": 280.00 }
  ]
}
```
Body is optional — omit it (`{}`) to carry the same line items forward unchanged. Creates
a new `DRAFT` Estimate linked to the rejected one and moves the Job Card back to
`SN_VALIDATED`, so 9b onward can run again.

### 9f. Look around
- **`GET /estimates/{id}`** — full staff detail.
- **`GET /estimates/by-job-card/{jobCardId}`** — every Estimate for a Job Card, newest
  first, including the full reject→revise chain via each one's `previousEstimateId`.

### 9g. Prove the guardrails work
- Try **9a** on a Job Card that isn't OOW, or isn't `SN_VALIDATED` yet → expect **`400`**.
- Try **9a** twice on the same Job Card → expect **`409`** the second time.
- Try **9b** on an Estimate that isn't `DRAFT` → expect **`400`**.
- Try **9c**'s `GET` on a made-up token → expect **`404`**.
- Try **9d** with a `contactValue` that doesn't match the appointment → expect **`400`**.
- Try **9e**'s `revise` on an Estimate that isn't `REJECTED` → expect **`400`**.

---

## 10. Workshop + Inventory — spare part reservations, not deductions

The core idea, in plain terms: when a workshop technician needs a spare part, the system
**reserves** it for them out of Main Store stock — it doesn't hand it over and forget about
it. Nothing is treated as permanently consumed until the technician physically gives an
unused part back and someone at Main Store confirms receiving it. This section walks
through that whole loop, plus the technician-deactivation safety check that goes with it.

### 10a. Create a workshop technician test account
Same helper script as Section 4, with a different role:
```powershell
cd "D:\Jackys\jackys service portal"
$env:SEED_TECH_EMAIL="workshop@x.com"; $env:SEED_TECH_PASSWORD="Pass123!"; $env:SEED_TECH_ROLE="TECHNICIAN_WORKSHOP"; npm run seed:technician
```
Copy the printed **user id** — you'll assign the Job Card to this id in 10d.

### 10b. Link a spare part to a model, then receive stock (GRN)
Stock can't be received for a spare part until it's linked to at least one appliance model
(this stops orphaned parts nobody can ever match to a repair). If you haven't already made
a spare part and a spare part model (Section 3), do that first under **master-data**, then:

**`POST /master-data/spare-parts/{id}/link-model`** (`{id}` = the spare part's id)
```json
{ "modelId": "<the spare part model's id>" }
```
Safe to call again with the same model — it won't duplicate the link.

**`POST /inventory/grn`** (Goods Received Note — new stock arriving)
```json
{ "sparePartId": "<spare part id>", "quantity": 5, "notes": "GRN against PO-2044" }
```
Try this on a spare part you *haven't* linked to a model yet first → expect **`400`**.

**`GET /inventory/stock/{sparePartId}`** — check `quantityOnHand` and `quantityReserved`.

### 10c. Get a Job Card to the Workshop section
Follow Sections 5, 6, 8 up through **`POST /job-cards/{id}/assign-section`** with
`{"section": "WORKSHOP"}` (an in-warranty job or an approved-OOW job both work — either
way `assign-section` needs to succeed first).

### 10d. Assign the workshop technician and start work
**`POST /workshop/{jobCardId}/assign`**
```json
{ "technicianId": "<the workshop technician's user id from 10a>" }
```
Status moves to `WORKSHOP_ASSIGNED`. Now **log in as the workshop technician** (Section 1,
their email/password from 10a) and use their token from here on:

**`POST /workshop/{jobCardId}/start-wip`** — no body. Status moves to `IN_PROGRESS`.

### 10e. Request a spare (reserve, don't deduct)
**`POST /workshop/{jobCardId}/request-spare`**
```json
{ "sparePartId": "<the linked spare part's id>", "quantity": 2 }
```
Check `GET /inventory/stock/{sparePartId}` afterward — `quantityReserved` went up by 2, but
`quantityOnHand` **did not change**. That's the point: reserving isn't consuming.

Now request more than what's left (e.g. `"quantity": 10` when only 3 remain) → the
response comes back `"status": "PARTIALLY_RESERVED"` with `quantityReserved` capped at
whatever was actually available, and `GET /job-cards/{id}` shows the Job Card moved to
`SPARE_PENDING`. Try **`POST /workshop/{jobCardId}/complete`** while `SPARE_PENDING` →
expect **`400`** (can't finish a job that's still waiting on a part).

### 10f. The technician-deactivation safety check
While the technician from 10a still holds an unreturned reservation, try:

**`PATCH /auth/users/{technicianId}/deactivate`** (as admin) → expect **`409`**, with a
`blockers` array listing every open appointment, workshop job, and spare-part reservation
still tied to them. This is deliberate — a technician can't be deactivated (and their
custody quietly lost track of) while they're still holding something. Clear everything
below first, then try this again — it should succeed and return `"status": "INACTIVE"`.

### 10g. Returning a spare / cancelling the job
Two ways an active reservation gets resolved:

- **Technician returns it voluntarily:** `POST /inventory/reservations/{id}/request-return`
  (as the technician, or a Team Leader+ on their behalf) → moves to `RETURN_PENDING`.
- **A Team Leader reviews an idle one:** `POST /inventory/reservations/{id}/review`
  ```json
  { "decision": "APPROVE_REALLOCATION", "notes": "Checked with technician, job stalled" }
  ```
  → `RETURN_PENDING`. Using `"decision": "REJECT"` instead leaves the reservation exactly
  where it was (it isn't a permanent exemption — it resurfaces on the stale-reservations
  list again later).
- **The Job Card is cancelled:** `POST /job-cards/{id}/cancel` with `{"reason": "..."}` →
  every open reservation on that Job Card moves to `RETURN_PENDING` automatically (see
  Section 8h).

Either way, nothing is added back to `quantityOnHand` until someone at Main Store
physically has the part in hand and confirms it:

**`POST /inventory/reservations/{id}/confirm-return`**
```json
{ "quantityReturned": 2 }
```
This is the *only* action anywhere in the system that increases `quantityOnHand` for a
return. `GET /inventory/stock/{sparePartId}` afterward to see it reflected. Try confirming
the same reservation's return twice → expect **`400`** the second time.

### 10h. Look around
- **`GET /inventory/reservations/stale`** — reservations idle 24h+ with no request or
  review since, oldest first (a deactivated technician's reservations always sort to the
  top regardless of age). Empty in a fresh test run — nothing's had time to go stale yet.
- **`GET /workshop/{jobCardId}`** — full workshop state for one Job Card, including any of
  its own reservations that have gone stale. This is the screen a Team Leader actually
  opens day to day, so staleness is surfaced right there rather than needing a separate
  report nobody remembers to check.

### 10i. Prove the guardrails work
- Try **10b**'s GRN on an unlinked spare part → expect **`400`**.
- Try **10f** while the technician still holds a reservation → expect **`409`** (all
  blockers listed, not just the first one found).
- Try **10e** on a Job Card that isn't `IN_PROGRESS`/`SPARE_PENDING` → expect **`400`**.
- Try **10g**'s `confirm-return` on a reservation that isn't `RETURN_PENDING` yet → expect
  **`400`**.
- Try **`POST /workshop/{jobCardId}/request-spare`** as a *different* workshop technician
  than the one assigned to that Job Card → expect **`403`** (Team Leaders and above can
  still act on any job; a workshop technician only their own).

**One known gap, on purpose:** there's currently no step that permanently deducts a spare
from `quantityOnHand` when a job finishes normally (spare genuinely used, not returned).
Only a confirmed physical return adds stock back — nothing yet subtracts it for a
legitimate use. That "mark as consumed" step naturally belongs at QC completion (Phase 6,
not built yet) per the original design note ("not consumed till job is completed or QC
completed") — flagged in `docs/planning/STATUS_TRACKER.md` so it isn't forgotten, and it's
the first thing Phase 6 builds.

---

## 11. Full endpoint index (100 endpoints, all documented above)

Every route the app exposes, and exactly where in this guide it's covered. Use this to
confirm nothing was missed — if you ever add a new endpoint and it doesn't show up here,
that's the signal to update this guide.

### auth (7)
| Endpoint | Section |
|---|---|
| `POST /auth/login` | 1a |
| `POST /auth/refresh` | 1b |
| `POST /auth/logout` | 1c |
| `POST /auth/change-password` | 1d |
| `GET /auth/profile` | 1a |
| `PATCH /auth/users/:id/deactivate` | 10f |
| `POST /auth/seed-roles` | 2 |

### master-data (29)
| Endpoint | Section |
|---|---|
| `POST /master-data/service-centres` | 3a |
| `GET /master-data/service-centres` | 3a |
| `GET /master-data/service-centres/:id` | 3a |
| `PUT /master-data/service-centres/:id` | 3a |
| `DELETE /master-data/service-centres/:id` | 3a |
| `POST /master-data/fault-symptoms` | 3b |
| `GET /master-data/fault-symptoms` | 3b |
| `GET /master-data/fault-symptoms/code/:faultCode` | 3b |
| `GET /master-data/fault-symptoms/symptom/:symptomCode` | 3b |
| `POST /master-data/spare-parts` | 3f |
| `GET /master-data/spare-parts` | 3f |
| `GET /master-data/spare-parts/:id` | 3f |
| `GET /master-data/spare-parts/model/:modelId` | 3f |
| `POST /master-data/spare-parts/:id/link-model` | 3f, 10b |
| `POST /master-data/spare-part-models` | 3d |
| `GET /master-data/spare-part-models` | 3d |
| `POST /master-data/price-lists` | 3e |
| `GET /master-data/price-lists` | 3e |
| `POST /master-data/kpi-rules` | 3g |
| `GET /master-data/kpi-rules` | 3g |
| `POST /master-data/notification-templates` | 3h |
| `GET /master-data/notification-templates` | 3h |
| `GET /master-data/notification-templates/:trigger/:channel` | 3h |
| `POST /master-data/warranty-master` | 3c |
| `GET /master-data/warranty-master/check/:serialNumber` | 3c |
| `POST /master-data/component-yield` | 3i |
| `GET /master-data/component-yield/model/:modelId` | 3i |
| `GET /master-data/component-yield/category/:category` | 3i |
| `POST /master-data/bulk-import/:entityType` | 3j |

### appointments (14)
| Endpoint | Section |
|---|---|
| `POST /appointments` | 5a |
| `GET /appointments` | 5c |
| `GET /appointments/dashboard/stats` | 5c |
| `GET /appointments/service-centre/:serviceCentreId/schedule` | 5c |
| `GET /appointments/technician/:technicianId/schedule` | 5c |
| `GET /appointments/:id` | 5c |
| `GET /appointments/number/:appointmentNumber` | 5c |
| `PUT /appointments/:id` | 5d |
| `PUT /appointments/:id/assign-technician` | 5b |
| `PUT /appointments/:id/confirm` | 5e |
| `PUT /appointments/:id/on-site` | 5e |
| `PUT /appointments/:id/complete` | 5e |
| `PUT /appointments/:id/cancel` | 5f |
| `DELETE /appointments/:id` | 5g |

### technician (5)
| Endpoint | Section |
|---|---|
| `POST /technician/visits/:appointmentId/start` | 6a |
| `POST /technician/visits/:appointmentId/serial-number` | 6b |
| `POST /technician/visits/:appointmentId/fault-symptom` | 6c |
| `GET /technician/visits/:appointmentId` | 6d |
| `GET /technician/schedule` | 6e |

### job-cards (10)
| Endpoint | Section |
|---|---|
| `POST /job-cards` | 8a |
| `POST /job-cards/:id/validate-sn` | 8b |
| `POST /job-cards/:id/assign-section` | 8c |
| `POST /job-cards/:id/approve-customer` | 8d |
| `POST /job-cards/:id/warranty-override` | 8e |
| `POST /job-cards/:id/cancel` | 8h |
| `POST /job-cards/:id/qc/approve` | 12c |
| `POST /job-cards/:id/qc/reject` | 12e |
| `GET /job-cards/:id` | 8f |
| `GET /job-cards/by-appointment/:appointmentId` | 8f |

### estimates (6) + estimates-public (2)
| Endpoint | Section |
|---|---|
| `POST /estimates` | 9a |
| `POST /estimates/:id/send` | 9b |
| `POST /estimates/:id/record-response` | 9d |
| `POST /estimates/:id/revise` | 9e |
| `GET /estimates/:id` | 9f |
| `GET /estimates/by-job-card/:jobCardId` | 9f |
| `GET /estimates/public/:token` | 9c |
| `POST /estimates/public/:token/respond` | 9c |

### inventory (6)
| Endpoint | Section |
|---|---|
| `POST /inventory/grn` | 10b |
| `GET /inventory/stock/:sparePartId` (optional `?location=` query, defaults `MAIN_STORE`) | 10b, 12c |
| `GET /inventory/reservations/stale` | 10h |
| `POST /inventory/reservations/:id/review` | 10g |
| `POST /inventory/reservations/:id/request-return` | 10g |
| `POST /inventory/reservations/:id/confirm-return` | 10g |

### workshop (5)
| Endpoint | Section |
|---|---|
| `POST /workshop/:jobCardId/assign` | 10d |
| `POST /workshop/:jobCardId/start-wip` | 10d |
| `POST /workshop/:jobCardId/request-spare` (also callable from `READY_FOR_QC` for a post-QC-block top-up) | 10e, 12d |
| `POST /workshop/:jobCardId/complete` | 10e |
| `GET /workshop/:jobCardId` | 10h |

### permissions (4)
| Endpoint | Section |
|---|---|
| `POST /permissions/grant` | 12a |
| `POST /permissions/revoke` | 12f |
| `GET /permissions/users/:userId` | 12a |
| `GET /permissions` (`?type=`) | 12a |

### delivery (8)
| Endpoint | Section |
|---|---|
| `GET /delivery/ready` (`?warrantyStatus=IW\|OOW`) | 13b |
| `GET /delivery/job-card/:jobCardId` | 13b |
| `POST /delivery` | 13b |
| `GET /delivery` (`?status=`) | 13b |
| `GET /delivery/:id` | 13b |
| `POST /delivery/:id/dispatch` | 13c |
| `POST /delivery/:id/pod` | 13d |
| `POST /delivery/:id/cancel` | 13f |

### invoicing (5)
| Endpoint | Section |
|---|---|
| `GET /invoicing/job-card/:jobCardId` | 13e, 14a |
| `GET /invoicing/b2b-aging` | 14c |
| `GET /invoicing/:id` | 13e |
| `GET /invoicing/:id/payments` | 14b |
| `POST /invoicing/:id/record-payment` | 13e, 14b |

### debit-notes (5)
| Endpoint | Section |
|---|---|
| `GET /debit-notes/job-card/:jobCardId` | 14d |
| `GET /debit-notes/recharge-report` | 14d |
| `GET /debit-notes` | 14d |
| `GET /debit-notes/:id` | 14d |
| `POST /debit-notes/:id/post` | 14d |

### gl-postings (1)
| Endpoint | Section |
|---|---|
| `GET /gl-postings` (`?sourceType=`) | 14e |

### customer-portal/public (3)
| Endpoint | Section |
|---|---|
| `GET /customer-portal/public/track/:token` | 14f |
| `GET /customer-portal/public/invoice/:token` | 14f |
| `GET /customer-portal/public/job-card/:token/summary` | 14f |

**Total: 111 endpoints, all documented above.** (7 auth + 29 master-data + 14 appointments + 5 technician + 10 job-cards + 8 estimates + 6 inventory + 5 workshop + 4 permissions + 8 delivery + 5 invoicing + 5 debit-notes + 1 gl-postings + 3 customer-portal.)


## 12. QC gate + admin-assignable permissions + inventory consumption (Phase 6)

This is where a spare part stops being merely *reserved* and becomes permanently
**consumed** — the "mark as consumed" step flagged as a known gap at the end of Section
10. Nothing is ever deducted from `quantityOnHand` until a Job Card actually passes QC;
until then everything you did in Section 10 (reserve, top-up, return) still applies
unchanged.

The core idea: a Job Card that reaches `READY_FOR_QC` freezes there until someone holding
a **QC_APPROVAL permission grant** approves or rejects it. That grant is admin-assignable
to *any* user regardless of their role — a CCE, a Team Leader, a field technician, whoever
your business actually wants doing QC — not a hardcoded `QC_OFFICER`-only check. The same
mechanism (a different grant, `REWORK_APPROVAL`) gates re-consuming the *same* spare part
on the *same* job after a QC rejection, so a second draw on a part always gets a second
pair of eyes.

### 12a. Grant a permission (admin only)
**`POST /permissions/grant`**
```json
{ "userId": "<any user's id>", "permissionType": "QC_APPROVAL", "notes": "Covering QC this week" }
```
`permissionType` is either `QC_APPROVAL` or `REWORK_APPROVAL`. Grants are admin-only
(`SUPER_ADMIN`/`SERVICE_HEAD`) and never deleted, only revoked — the full history stays.
Granting the same active permission twice to the same user → expect **`409`**.

**`GET /permissions/users/{userId}`** — that user's full grant history (active + revoked).
**`GET /permissions?type=QC_APPROVAL`** — everyone currently holding a given permission.

### 12b. Get a Job Card to READY_FOR_QC
Follow Section 10c–10e to get a Job Card assigned to `WORKSHOP`, request whatever spares
it needs, then:

**`POST /workshop/{jobCardId}/complete`** — moves `IN_PROGRESS` → `READY_FOR_QC`. Blocked
(**`400`**) while `SPARE_PENDING`, same as before.

### 12c. QC approve — stock actually moves
**`POST /job-cards/{id}/qc/approve`** — no body. The caller needs an active `QC_APPROVAL`
grant (12a); without one, expect **`403`** regardless of their `@Roles()` — role alone is
no longer enough for this specific action.

On success: every reservation still attached to the job (`HELD`/`PARTIALLY_RESERVED`) is
marked `CONSUMED`, its quantity moves out of `MAIN_STORE` and into a `DAMAGE_LOCATION`
stock row for the same part (a real double-entry movement, not a silent decrement), and
the Job Card becomes `QC_PASSED`. Check it:

**`GET /inventory/stock/{sparePartId}`** — `quantityOnHand` dropped by the consumed amount.
**`GET /inventory/stock/{sparePartId}?location=DAMAGE_LOCATION`** — the new `?location=`
query param (defaults to `MAIN_STORE` if omitted) shows the consumed total landed here.

Try approving the same Job Card again → expect **`400`** (`QC_PASSED`, not `READY_FOR_QC`).

### 12d. The negative-inventory hard gate
This is the "never allow negative inventory" requirement, and it's a hard block, not a
warning. Reserve more of a part than is actually on hand (Section 10e's `PARTIALLY_RESERVED`
case), let an unrelated fully-held request flip the job back out of `SPARE_PENDING`, then
`complete` it — the job reaches `READY_FOR_QC` (Phase 5's job-level check only looks at the
*latest* request, not per-part — a pre-existing gap this gate compensates for). Now:

**`POST /job-cards/{id}/qc/approve`** → expect **`409`**, with a `blockers` array naming
exactly which spare part is still short and by how much.

To resolve it: `POST /inventory/grn` to bring in more stock, then **`POST
/workshop/{jobCardId}/request-spare`** again for the remaining shortfall — this now works
even while the Job Card is `READY_FOR_QC` (not just `IN_PROGRESS`/`SPARE_PENDING`), because
this exact top-up-after-the-gate-blocked-you scenario is the whole point of "reserved isn't
necessarily final." The Job Card's status doesn't change either way (still `READY_FOR_QC`)
— `qc/approve` just re-checks stock fresh on the next attempt and succeeds once the part's
most recent reservation is fully `HELD`.

### 12e. QC reject + the rework gate
**`POST /job-cards/{id}/qc/reject`**
```json
{ "reason": "Compressor swap didn't fix the noise, needs another unit" }
```
Also needs an active `QC_APPROVAL` grant. Sends the job back to `IN_PROGRESS` and
increments `qcRejectionCount` — nothing is ever consumed on a rejection, since nothing gets
consumed until an approval.

Now, if the *same* spare part gets requested again on this *same* job (a genuine rework —
not the 12d top-up scenario, which never touches `qcRejectionCount`):

**`POST /workshop/{jobCardId}/request-spare`** for that same part, no extra fields →
expect **`400`** — it needs one of:
```json
{ "sparePartId": "...", "quantity": 1, "approverId": "<a different user with an active REWORK_APPROVAL grant>" }
```
or, if no one holding the grant is reachable:
```json
{ "sparePartId": "...", "quantity": 1, "verbalOverrideBy": "Supervisor Raj (phone, off-site)", "verbalOverrideNotes": "Confirmed verbally, will countersign tomorrow" }
```
`verbalOverrideNotes` needs at least 5 characters, or expect **`400`**. Setting `approverId`
to the same user who's making the request → expect **`400`** (anti-self-dealing — the
requester can never also be their own rework approver). An `approverId` who doesn't
actually hold an active `REWORK_APPROVAL` grant → expect **`403`**.

Complete and QC-approve the job again as usual (12b/12c) — both the original and the
rework reservation get consumed together.

### 12f. Prove the guardrails work
- Try **12c** without a `QC_APPROVAL` grant → expect **`403`**.
- Try **12c** on a job with a genuine stock shortfall → expect **`409`** with `blockers`.
- Try **12e**'s rework re-request with no `approverId`/`verbalOverrideBy` → expect **`400`**.
- Try `approverId === requestedByUserId` on a rework re-request → expect **`400`**.
- Revoke a grant (`POST /permissions/revoke`, same body shape as 12a) and try **12c** again
  as that same user → expect **`403`**.

**Live-verified**: `scripts/phase6-e2e-test.ps1` runs this entire section end to end against
a real server — happy-path consumption with real stock movement, the access-control story,
the negative-inventory gate (blocked, then resolved via the READY_FOR_QC top-up in 12d), the
full rework gate (blocked, anti-self-dealing, missing-grant, granted-and-succeeds, verbal
override), a real concurrent-approval race (two Job Cards sharing two spare parts reserved
in reverse order, `qc/approve` fired at the same time — no deadlock, correct totals), and
the permissions admin surface. Run it yourself with `powershell -ExecutionPolicy Bypass
-File scripts\phase6-e2e-test.ps1` while the dev server is up.

One gap knowingly left as-is: Phase 5's `SPARE_PENDING`→`IN_PROGRESS` status flip is still
job-level, not per-part (12d references this) — it can never cause negative inventory,
because Phase 6's gate re-checks per-part before anything is ever consumed, but it's worth
knowing the job-level status alone isn't proof every part on it is actually fully stocked.


## 13. Delivery + POD + OOW invoicing block (Phase 7)

Once a Job Card passes QC (`QC_PASSED`, Section 12c), it's ready to go back to the
customer. This phase covers batching one or more `QC_PASSED` Job Cards into a single
delivery (`DLV-####`), dispatching it, capturing proof of delivery, and - for
out-of-warranty jobs - blocking the hand-back until the repair is actually paid for (or
approved as B2B Credit).

Login roles you'll need beyond what Sections 1-12 already set up: seed a
`LOGISTICS_DISPATCHER` (and optionally a `DRIVER`) the same way Section 4 seeded a
technician (`SEED_TECH_ROLE='LOGISTICS_DISPATCHER'`). Delivery endpoints accept
`LOGISTICS_DISPATCHER`/`DRIVER`/`SUPER_ADMIN`/`SERVICE_HEAD`. Invoicing endpoints
(recording a payment) accept `ACCOUNTANT`/`FINANCE_MANAGER`/`SUPER_ADMIN`/`SERVICE_HEAD`
- plus `LOGISTICS_DISPATCHER`/`DRIVER` for the read-only "what does this job owe" lookup,
so a dispatcher can see the amount without being able to record it themselves.

### 13a. Get a Job Card to QC_PASSED

Nothing new here - it's exactly Sections 8-12 end to end: create the appointment, run the
field visit, create the Job Card, `validate-sn`, (OOW only) get an Estimate approved
(Section 9) and `approve-customer` (8d), `assign-section` into `WORKSHOP`, `workshop/assign`
+ `start-wip` + `complete` (Section 10), then `qc/approve` (12c) with a user holding the
`QC_APPROVAL` grant. An in-warranty job needs no Estimate at all - warranty covers it.

### 13b. List the ready-for-delivery pool and create a delivery

```
GET /delivery/ready?warrantyStatus=IW
```
Lists every `QC_PASSED` Job Card with no delivery attached yet. Each entry also carries
`invoiceStatus`/`payable` - for an in-warranty job these are always `null`/`true` (nothing
to pay); for an out-of-warranty job, `payable` reflects whatever invoice already exists
*without creating one* - so browsing this list never side-effects an invoice into
existence. Swap `warrantyStatus=OOW` for the out-of-warranty tab.

```
POST /delivery
{ "jobCardIds": ["<jobCardId1>", "<jobCardId2>"] }
```
A single id is a normal delivery; two or more is a batch - same endpoint, same response
shape, one generated `DLV-####` either way. Every listed Job Card must currently be
`QC_PASSED` and not already attached to another delivery, or the whole call is rejected
(nothing partially succeeds) - expect **`400`** for a not-yet-`QC_PASSED` Job Card,
**`404`** for one that doesn't exist, **`409`** for one already claimed by another
delivery. The response is `{ delivery, jobCards }`.

`GET /delivery/:id`, `GET /delivery` (optionally `?status=PENDING|DISPATCHED|DELIVERED|
CANCELLED`), and `GET /delivery/job-card/:jobCardId` (returns `null` if that Job Card
isn't attached to a delivery yet) are all read-only lookups.

### 13c. Dispatch

```
POST /delivery/:id/dispatch
{ "driverUserId": "<optional driver user id>" }
```
Only legal from `PENDING` → expect **`400`** on a delivery that's already `DISPATCHED`/
`DELIVERED`/`CANCELLED`.

### 13d. Capture POD (proof of delivery)

```
POST /delivery/:id/pod
{ "signatureBase64": "<base64>", "recipientName": "Anita Kumar", "notes": "Handed over at reception" }
```
AC-12: at least one of `signatureBase64` or `photoBase64` is required - send neither and
expect **`400`**. Either one alone is enough (they're not both required). Only legal from
`DISPATCHED` → expect **`400`** otherwise. On success, the delivery *and every member Job
Card* move to `DELIVERED` in one step - terminal for the repair-and-hand-back cycle.

### 13e. FR-12/AC-11: the OOW-paid block, and recording payment

Try to batch an out-of-warranty Job Card that hasn't been paid yet (13b) and expect
**`409`**, with a `blockers` array (same shape as Section 12's negative-inventory gate):
```json
{ "message": "Cannot create delivery: ...", "blockers": [{ "jobCardId": "...", "jobCardNumber": "JC-0040", "invoiceId": "...", "invoiceStatus": "DRAFT", "amount": 493.5 }] }
```
The `invoiceId`/`amount` come from a DRAFT invoice that's lazily created the first time
anyone asks (either this blocked attempt, or `GET /invoicing/job-card/:jobCardId`
directly) - snapshotted from the Job Card's approved Estimate total, so there's always a
real number behind it. Resolve it:
```
POST /invoicing/:invoiceId/record-payment
{ "method": "CASH", "amountReceived": 493.5, "reference": "receipt-001" }
```
`method` is one of `CASH`/`CARD`/`BANK_TRANSFER`/`B2B_CREDIT` (FR-14 - no online gateway
yet). **As of Phase 8**, `amountReceived` no longer has to match the invoice amount
exactly - partial payments are supported (see Section 14b); it just has to be `> 0` and
`<=` the remaining balance, or you get **`400`** (no overpayment). `B2B_CREDIT` is
rejected with **`403`** unless the Job Card's appointment is an actual `customerType:
B2B` - it can't be used as a free payment-bypass for a B2C customer who won't pay. Once
the invoice's balance reaches zero (one full payment, or several partial ones), retry
`POST /delivery` (13b) - it now succeeds. As a defense-in-depth measure, `POST /delivery/:id/pod` (13d) re-checks
the same paid/B2B-Credit gate right before the irreversible `DELIVERED` flip, in case
anything changed in between.

### 13f. Cancel before dispatch

```
POST /delivery/:id/cancel
{ "reason": "Wrong job cards batched together" }
```
Only legal from `PENDING` (before dispatch) → expect **`400`** otherwise. Releases every
member Job Card's `deliveryId` back to `null`, so they reappear in the ready-for-delivery
pool (13b) and can be re-batched into a fresh delivery.

### 13g. Prove the guardrails work
- Batch an OOW Job Card with no payment recorded → expect **`409`** with `blockers` (13e).
- `record-payment` with `B2B_CREDIT` on a B2C customer → expect **`403`**.
- `record-payment` with an `amountReceived` that doesn't match the invoice → expect **`400`**.
- `POST /delivery/:id/pod` with neither `signatureBase64` nor `photoBase64` → expect **`400`**.
- Batch a Job Card that isn't `QC_PASSED` yet → expect **`400`**; a nonexistent one → **`404`**.
- Re-batch an already-`DELIVERED` Job Card → expect **`400`**.
- Two dispatchers `POST /delivery` on the *same* Job Card at the same time → exactly one
  succeeds, the other gets a clean `409` - never a silent double-claim.

**Live-verified**: `scripts/phase7-e2e-test.ps1` runs this entire section end to end
against a real server - the happy path (batch two IW jobs, dispatch, POD with a signature
only, both Job Cards DELIVERED), the OOW-paid block and its resolution via
`record-payment`, the B2B Credit loophole rejection on a real B2C customer (and a
successful B2B_CREDIT payment on a real B2B customer), the amount-mismatch rejection, POD
validation (photo-only also proven to succeed, not just signature-only), a real
concurrent-dispatcher race on the same Job Card (two `POST /delivery` calls fired at the
same time - one clean winner, one clean `409` loser, no double-claim), batch cancel + the
freed Job Cards being genuinely re-batchable afterward, and the missing/not-ready Job Card
guards. Run it yourself with `powershell -ExecutionPolicy Bypass -File
scripts\phase7-e2e-test.ps1` while the dev server is up.

One deliberate scope limit to be aware of: this phase doesn't track failed-delivery-attempt
history (driver arrives, customer isn't home, needs to retry as a fresh `DLV#` tomorrow) -
out of what FR-11/FR-12/AC-10-12 actually ask for. If that need comes up, it wants a proper
attempt-history table, not a workaround bolted onto this one.

---

## 14. Finance extension + Customer Portal (Phase 8)

Phase 7 built `Invoice` as a deliberate stopgap (amount only, DRAFT/PAID/CANCELLED, one
all-or-nothing payment) purely so FR-12/AC-11's OOW-paid delivery block had a real
Paid/not-Paid signal. Phase 8 extends that entity in place - adds a VAT breakdown,
partial payments, a B2B aging report, and a new Debit Note (FR-15/AC-15) + internal GL
posting log for interdepartment recharges - plus the read-only Customer Portal
(EPIC-005: track a job, view what's owed, download a summary - approving an Estimate
already has its own public flow from Section 9c, unchanged here).

Login roles: everything in this section uses the same roles as Section 13 -
`ACCOUNTANT`/`FINANCE_MANAGER`/`SUPER_ADMIN`/`SERVICE_HEAD` for invoicing/debit-notes/
gl-postings. The `customer-portal/public/*` routes need **no login at all** - they're
gated by a per-Job-Card token instead (see 14f).

### 14a. VAT breakdown on the invoice

```
GET /invoicing/job-card/:jobCardId
```
Same lazy-create-on-first-read behavior as Phase 7, but the response now also carries
`subtotal`, `vatRate`, and `vatAmount` (all copied from the Job Card's already-approved
Estimate - the Estimate did the real VAT math back in Section 9a using the Job Card's
Service Centre `vatRate`, so this is a snapshot, not a recomputation), plus a `dueDate`
(created-at + 30 days - only meaningful for B2B Credit's terms, see 14c).

### 14b. Partial payments

```
POST /invoicing/:id/record-payment
{ "method": "CASH", "amountReceived": 200, "reference": "partial-1" }
```
You can now record less than the full amount - the invoice moves to
`PARTIALLY_PAID` (not `PAID`) until the balance actually reaches zero across one or more
payments. Send an `amountReceived` greater than the remaining balance and expect
**`400`** (no overpayment). Send another payment for the rest and the invoice flips to
`PAID`. See every payment recorded against an invoice, oldest first:
```
GET /invoicing/:id/payments
```

### 14c. B2B aging report

```
GET /invoicing/b2b-aging
```
Lists every still-open (`DRAFT`/`PARTIALLY_PAID`) invoice belonging to a `B2B` customer,
bucketed by days past `dueDate`: `0-30 days` / `31-60 days` / `61-90 days` / `90+ days`,
each with its own `totalOutstanding`, plus a grand `totalOutstanding` across all buckets.
A brand-new unpaid B2B invoice (dueDate 30 days out) shows up in `0-30 days` immediately -
that's expected, not a bug (a "not yet due" invoice is still open, just not yet late).

### 14d. Interdepartment Debit Notes (FR-15/AC-15)

Only for a Job Card whose appointment is `customerType: B2B_SALES_CHANNEL` **and** whose
warranty status is `IN_WARRANTY` - a warranty repair done for an internal sales channel,
recharged internally instead of billed to an external customer. Everything else
(B2C/B2B of either warranty status, or a B2B_SALES_CHANNEL job that's OOW) still goes
through Invoice as before.

Before you can generate one, a `REPAIR` row must exist in the Service Price List (Section
3e) with an `interdepartmentLaborCost` set - either matching the Job Card's exact
`modelId`, or a model-agnostic default row (`modelId` left blank). Skip this and you get a
clear **`400`** rather than a silently-wrong 0.
```
GET /debit-notes/job-card/:jobCardId
```
Lazily creates a `DRAFT` Debit Note (`DN-####`) the first time it's asked for -
`sparePartsCost` is the real cost (not customer price) of every spare consumed at QC for
this job, `laborCost` comes from the price list row above, `totalAmount` is their sum.
```
POST /debit-notes/:id/post
```
Moves it to `POSTED` (terminal - posting twice is **`400`**) and generates its GL entry
(14e). List everything, or just the summary:
```
GET /debit-notes
GET /debit-notes/recharge-report
```
The recharge report (AC-16) splits count/total between `posted` and `draft` notes.

### 14e. GL postings (internal ledger stopgap)

```
GET /gl-postings
```
(optionally `?sourceType=INVOICE_PAYMENT` or `?sourceType=DEBIT_NOTE`). There is
deliberately no endpoint to create one by hand - every row here is generated
automatically, one per payment recorded (14b) and one per Debit Note posted (14d). This
is an internal-only journal log, not a real accounting-system export - the discovery doc
lists the actual GL/ERP integration format as an open, unresolved dependency, so fixed
account-code strings (e.g. `1000-CASH`, `4000-SERVICE-REVENUE`) stand in for a real chart
of accounts until that's defined.

### 14f. Customer Portal (public, no login)

Every Job Card gets a `publicToken` the moment it's created (see its `GET /job-cards/:id`
response, Section 8f) - a 180-day link a customer could use to check on their own repair
without an account. Three read-only routes, none of which need an `Authorization` header:
```
GET /customer-portal/public/track/:token
GET /customer-portal/public/invoice/:token
GET /customer-portal/public/job-card/:token/summary
```
`track` returns a customer-safe status timeline (no internal ids or staff notes).
`invoice` shows what's owed (VAT breakdown, amount paid, amount due) for an OOW job, or
`{"applicable": false}` for an in-warranty one - it's deliberately **view-only**: the BRD
confirms no online payment gateway is in scope (FR-14/S2), so a real payment still has to
go through staff via 14b, not a checkout button here. `summary` is the "download job
card" view - job card + estimate + invoice + delivery essentials in one payload, meant for
the (not-yet-built) React frontend to render as a printable page. An unknown or expired
token gets a plain **`404`** on all three - it never reveals which.

### 14g. Prove the guardrails work
- Record a payment larger than the remaining balance → expect **`400`**.
- Record a payment against an already fully-`PAID` invoice → expect **`400`**.
- `B2B_CREDIT` on a B2C customer's invoice → expect **`403`**.
- Try to generate an Invoice for an in-warranty Job Card → expect **`400`** (nothing to
  bill - it should be a Debit Note instead, if it's also B2B_SALES_CHANNEL).
- Try to generate a Debit Note for an out-of-warranty Job Card, or a non-
  `B2B_SALES_CHANNEL` one → expect **`400`** either way.
- Generate a Debit Note with no matching (or default) `REPAIR` price list row → expect
  **`400`**, not a silent 0.
- Post an already-`POSTED` Debit Note again → expect **`400`**.
- Hit any `customer-portal/public/*` route with a made-up token → expect **`404`**.

**Live-verified**: `scripts/phase8-e2e-test.ps1` runs this entire section end to end
against a real server - a B2C OOW job through a partial payment then a completing
payment (with the overpayment and already-paid guards both proven), a B2B OOW job left
deliberately unpaid and confirmed to surface in the aging report's `0-30 days` bucket,
the B2B_CREDIT-on-a-B2C-invoice rejection, a full interdepartment job through Debit Note
creation (labor cost checked against the seeded price list row) and posting (with the
double-post guard proven), the recharge report, exactly 3 GL postings appearing for this
run's 2 payments + 1 debit note, and all three Customer Portal routes (including the
unknown-token 404). Run it yourself with `powershell -ExecutionPolicy Bypass -File
scripts\phase8-e2e-test.ps1` while the dev server is up.

One deliberate scope limit to be aware of: GL posting here is a simplified two-line
journal entry against fixed account-code strings, not a real chart-of-accounts-backed
export - see 14e. If/when a real accounting system integration is scoped, this log is
meant to be the ready-made source list to replay from, not something to throw away.

---

## Troubleshooting

| Symptom | What it means | Fix |
|---|---|---|
| Browser can't reach `localhost:3000` | Server isn't running | Check the PowerShell window running `npm run start:dev` is still open and shows no red errors — see 0f |
| `EADDRINUSE: address already in use :::3000` | Something's already using port 3000 (maybe a previous run you forgot about) | `Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess \| Stop-Process -Force`, then restart `npm run start:dev` |
| `401 Unauthorized` on everything | Not authorized, or your token expired (15 min lifetime) | Repeat Section 1a, or use 1b to refresh |
| `403 Forbidden` | You're authorized, but your role/ownership doesn't allow this action | Expected in Section 7's tests; otherwise check you're logged in as the right user |
| `404 Not Found` on a fresh `id` you just created | Typo'd or didn't copy the `id` correctly | Re-copy the `id` from the earlier response |
| `409 Conflict` creating an appointment | Service centre at capacity for that day/time, or the day is marked closed | Use a day with `isOpen: true` and a generous `maxJobsPerDay` (Section 3a already does this) |
| Postgres won't start | Windows service stopped or not installed | See 0b |
| `psql`/`CREATE DATABASE` fails | Database already exists, or wrong password | Skip 0c if it already exists; check `DB_PASSWORD` in `.env` |
| `npm install` fails or hangs | Corrupted `node_modules`, or a network hiccup | Delete `node_modules` and `package-lock.json`, retry `npm install` |
| `npm run seed:admin` says the admin already exists | You already ran this before | That's fine — skip it, your existing login still works |
| Code changes don't seem to apply | `start:dev` restarts automatically on save, but check the PowerShell window for a red compile error after any update I push | Read the error at the top — usually self-explanatory. Tell me what it says. |

**To stop everything:** click into the PowerShell window running the server and press `Ctrl+C`.

---

## What's testable right now vs. not yet

Everything through **Phase 8** (Auth, Master Data, Appointments, Technician Mobile API,
Job Cards, Estimates + Notifications, Workshop + Inventory, QC gate + Permissions, Delivery
+ POD + OOW invoicing block, Finance extension + Customer Portal) is real, working code
you can exercise exactly as above — all 111 endpoints in Section 11 are live. AMC,
Dismantling, and Reports/Dashboards remain unbuilt (Phase 2/post-MVP per the
implementation plan).

One known, deliberate gap to be aware of while testing:
- **Notifications** (WhatsApp/SMS/Email) only *attempt* sends right now — no real provider
  is wired up (Section 9b) — so the record-response phone/call path (9d) is the actually
  usable way to move an Estimate forward today.

Spare-part consumption is no longer a gap — Section 12 covers the QC-approval step that
permanently deducts a spare from `quantityOnHand` (Main Store → Damage Location) once a
job passes QC.

`docs/planning/STATUS_TRACKER.md` always reflects current status — check there first if
you're unsure what's ready.
