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

## 11. Full endpoint index (147 endpoints, all documented above)

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

### amc (16)
| Endpoint | Section |
|---|---|
| `POST /amc/contracts` | 15a |
| `GET /amc/contracts` (`?status=`) | 15a |
| `GET /amc/contracts/expiring` (`?withinDays=`) | 15d |
| `GET /amc/upsell-candidates` | 15g |
| `GET /amc/contracts/number/:contractNumber` | 15a |
| `GET /amc/contracts/:id` | 15a |
| `GET /amc/contracts/:id/schedule` | 15b |
| `POST /amc/contracts/:id/renew` | 15e |
| `POST /amc/contracts/:id/cancel` | 15f |
| `POST /amc/contracts/:id/send-renewal-reminder` | 15d |
| `POST /amc/visits/:appointmentId/complete` | 15c |
| `GET /amc/visits/:appointmentId/completion` | 15c |
| `POST /amc/contracts/:id/billing-invoices` | 15e |
| `GET /amc/contracts/:id/billing-invoices` | 15e |
| `GET /amc/billing-invoices/:id` | 15e |
| `POST /amc/billing-invoices/:id/record-payment` | 15e |

### dismantling (7)
| Endpoint | Section |
|---|---|
| `POST /dismantling` | 16a |
| `GET /dismantling` (`?status=`) | 16a |
| `GET /dismantling/serial/:applianceSerialNumber` | 16d |
| `GET /dismantling/:id` | 16d |
| `POST /dismantling/:id/harvest` | 16b |
| `POST /dismantling/:id/verify` | 16c |
| `POST /dismantling/:id/price-and-post` | 16c |
| `POST /dismantling/:id/cancel` | 16e |

### reports (6)
| Endpoint | Section |
|---|---|
| `GET /reports/dashboard/kanban` | 17a |
| `GET /reports/dashboard/kanban/summary` | 17a |
| `GET /reports/dashboard/approval-aging` | 17b |
| `GET /reports/dashboard/service-efficiency` | 17c |
| `GET /reports/dashboard/first-time-fix-rate` | 17d |
| `GET /reports/dashboard/overview` | 17a |

### warranty-claims (7)
| Endpoint | Section |
|---|---|
| `POST /warranty-claims/aggregate` | 30b |
| `GET /warranty-claims` (`?supplier=`, `?status=`) | 30c |
| `GET /warranty-claims/recovery-rate` (`?supplier=`) | 30c |
| `GET /warranty-claims/:id` | 30c |
| `POST /warranty-claims/:id/submit` | 30d |
| `POST /warranty-claims/:id/cancel` | 30e |
| `POST /warranty-claims/:id/credit-note` | 30f |

**Total: 147 endpoints, all documented above.** (7 auth + 29 master-data + 14 appointments + 5 technician + 10 job-cards + 8 estimates + 6 inventory + 5 workshop + 4 permissions + 8 delivery + 5 invoicing + 5 debit-notes + 1 gl-postings + 3 customer-portal + 16 amc + 7 dismantling + 6 reports + 7 warranty-claims.)


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

## 15. AMC Management (Phase 9, post-MVP)

Everything here is under the `amc` Swagger tag - login as admin (Section 1a), keep using
the same `Bearer` header. This is the first post-MVP phase (BRD Workflow 13): Annual
Maintenance Contracts, their auto-generated Preventive Maintenance visit schedule, visit
completion, renewal, cancellation, and their own billing cycle (separate from the
Section 13e/14 out-of-warranty repair Invoice - an AMC installment is a pre-agreed
contract line item, not a repair bill).

### 15a. Create a contract - auto-generates its PM visit schedule
`POST /amc/contracts`:
```json
{
  "customerName": "Al Futtaim Facilities LLC",
  "customerPhone": "+971501234567",
  "customerEmail": "facilities@example.com",
  "customerType": "B2C",
  "serviceCentreId": "<a service centre id from 3a>",
  "coveredSerialNumbers": ["SN-000123"],
  "brand": "Samsung",
  "modelNumber": "M100",
  "coverageType": "COMPREHENSIVE",
  "serviceLevel": "Standard",
  "visitFrequency": "QUARTERLY",
  "startDate": "2026-09-01T00:00:00.000Z",
  "endDate": "2027-08-31T00:00:00.000Z",
  "totalAmount": 4800,
  "paymentTerms": "FULL_UPFRONT"
}
```
The moment this contract is created, its whole PM visit schedule is generated as
`Appointment` rows (`type: "AMC"`) at the chosen `visitFrequency` (`MONTHLY`/`QUARTERLY`/
`HALF_YEARLY`) between `startDate` and `endDate` - a quarterly, 12-month contract like the
example above generates 4 visits. This deliberately bypasses the ordinary appointment
capacity-check gate (Section 5a) - a signed contract's obligatory maintenance cadence
should never be spuriously rejected by an unrelated day's booking load. There's a
defensive 60-visit safety cap (not a business rule) - a mistakenly huge date range or a
too-frequent schedule gets a **`400`** instead of silently creating hundreds of rows.
`GET /amc/contracts` (`?status=`), `GET /amc/contracts/:id`, and
`GET /amc/contracts/number/:contractNumber` all work as you'd expect.

### 15b. View the generated schedule
`GET /amc/contracts/:id/schedule` - lists the PM-visit Appointments in date order. Copy
one `id` from here for the next section.

### 15c. Complete a PM visit
`POST /amc/visits/:appointmentId/complete`:
```json
{ "checklistNotes": "Filter cleaned, all normal" }
```
Marks that Appointment `COMPLETED` and records a checklist entry. To record an extra
charge on the spot (e.g. a replacement part not covered by the contract), you must also
set `extraChargeApprovedByCustomer: true` in the same call:
```json
{
  "extraChargeDescription": "Replacement belt",
  "extraChargeAmount": 150,
  "extraChargeApprovedByCustomer": true
}
```
Sending `extraChargeAmount` without the approval flag is rejected (**`400`**) - an AMC is
pre-paid; nothing extra gets billed silently. `GET /amc/visits/:appointmentId/completion`
fetches the completion record back.

### 15d. Expiring contracts + renewal reminder
`GET /amc/contracts/expiring?withinDays=30` lists `ACTIVE` contracts ending within the
given window. There is no scheduler in this app (no cron infrastructure exists anywhere),
so the BRD's "auto-fire 30 days before expiry" isn't actually automated - this list is the
manual companion a human (or a future scheduler) uses to decide what needs the next
endpoint: `POST /amc/contracts/:id/send-renewal-reminder`, which fires the
`AMC_RENEWAL_REMINDER` notification trigger to the customer (same stubbed WhatsApp/Email/
SMS channels as everywhere else in this app - Section 9b's note about no real provider
being wired up applies here too).

### 15e. Billing - installments, payment, B2B Credit
`POST /amc/contracts/:id/billing-invoices`:
```json
{ "periodLabel": "Full Term" }
```
The amount charged depends on the contract's `paymentTerms`: `FULL_UPFRONT` bills the
whole `totalAmount` in one invoice, `HALF_YEARLY` splits it into 2, `QUARTERLY` into 4.
`GET /amc/contracts/:id/billing-invoices` lists them; `GET /amc/billing-invoices/:id`
fetches one. To pay: `POST /amc/billing-invoices/:id/record-payment`:
```json
{ "method": "BANK_TRANSFER", "reference": "TXN-1001" }
```
`method` is one of `CASH`/`CARD`/`BANK_TRANSFER`/`B2B_CREDIT` (same universe as Section
13e). Unlike the Section 14b Invoice, this is **full-amount-only** - there's no partial-
payment support for an AMC installment (it's a fixed pre-agreed figure, not a running
balance). `B2B_CREDIT` is rejected (**`403`**) unless the contract's own `customerType`
is `B2B`.

### 15f. Renew or cancel a contract
`POST /amc/contracts/:id/renew`:
```json
{ "startDate": "2027-09-01T00:00:00.000Z", "endDate": "2028-08-31T00:00:00.000Z", "totalAmount": 5000 }
```
Creates a brand-new contract (its own new schedule, its own `AMC-####` number) with
`previousContractId` pointing back at the original, and marks the original `RENEWED` - a
forward-only chain, same pattern as an Estimate's `revise()` (Section 9e). A `CANCELLED`
or already-`RENEWED` contract can't be renewed again (**`400`**).

`POST /amc/contracts/:id/cancel`:
```json
{ "reason": "Customer requested early termination" }
```
Only works on an `ACTIVE` contract (**`400`** otherwise) and also cancels every
still-future `SCHEDULED` PM visit tied to it, so cancelled contracts don't leave stray
appointments on anyone's calendar.

### 15g. Upsell candidates (bonus report)
`GET /amc/upsell-candidates` - out-of-warranty customers who've just proven they'll pay
for a repair (an `APPROVED` Estimate exists) and whose phone number isn't already covered
by an `ACTIVE` AMC contract. This is a heuristic phone-number match, not a real CRM
lookup (no customer master exists to match on precisely) - useful as a lead list, not as
a guarantee of who is or isn't already covered.

### 15h. Prove the guardrails work
- Try to create a contract with `endDate` before `startDate` → expect **`400`**.
- Try to create a contract whose date range/frequency would generate more than 60 PM
  visits → expect **`400`**, and confirm no Appointments were created.
- Complete the same PM visit twice → expect **`400`** on the second call.
- Record an extra charge without `extraChargeApprovedByCustomer: true` → expect **`400`**.
- Use `B2B_CREDIT` to pay a B2C contract's billing invoice → expect **`403`**.
- Record payment against an already-`PAID` AMC billing invoice → expect **`400`**.
- Cancel an already-`CANCELLED` contract, or renew an already-`RENEWED` one → expect
  **`400`** either way.

**Live-verified**: `scripts/amc-e2e-test.ps1` runs this entire section end to end against
a real server - a quarterly 6-month contract generating exactly 3 PM visits, both the
bad-date-range and the 60-visit-cap rejections, completing one visit plain and a second
with an approved extra charge (plus the double-completion and unapproved-extra-charge
guards both proven), the expiring-contracts list and a manual renewal-reminder trigger, a
`FULL_UPFRONT` invoice charging the exact contract total, the B2B_CREDIT-on-a-B2C-
contract rejection, a `QUARTERLY` invoice on a separate B2B contract correctly billing
1/4 of the total and a `B2B_CREDIT` payment succeeding against it, a full cancel-cascade
(every future visit confirmed no longer `SCHEDULED`), and a full renew (new contract
chained via `previousContractId`, original confirmed `RENEWED`). Run it yourself with
`powershell -ExecutionPolicy Bypass -File scripts\amc-e2e-test.ps1` while the dev server
is up.

Known limitation, same honesty pattern as the GL-posting/notification stubs elsewhere in
this guide: there is no cron/scheduler infrastructure in this app, so the 30-days-before-
expiry renewal reminder is a manual trigger (15d), not an automatic one.



## 16. Dismantling — Defective/DOA Appliance Recovery (Phase 10, post-MVP, BRD Workflow 15)

FR-19, AC-29/AC-30/AC-31. Recovers salvageable components from a defective/DOA/DAP
appliance already sitting in Damage Location, converting them into priced, live spare-part
stock. Standalone from Job Cards - this is recovery of a written-off whole appliance, not
a step of an active repair.

Three DISTINCT people are required end to end (AC-31): whoever harvests components can't
also verify them, and whoever prices+posts can't be either of the other two. The API
enforces this at the service layer (400, not just a role check) - try it with the same
account twice and you'll see the exact rejection message.

### 16a. Create a record (step 15.1) — Technician/Team Leader/Service Head/Super Admin
```
POST /dismantling
{
  "applianceSerialNumber": "SN-000987",
  "modelId": "M100",
  "damageLocationNotes": "Confirmed DOA, water damage, Damage Location bay 3"
}
```
Starts `PENDING_HARVEST`. No appliance-stock gate exists to check against (see the
entity's doc comment in `dismantling-record.entity.ts` for why - there's no whole-appliance
inventory ledger anywhere in this codebase, only spare-part quantities).

### 16b. Log harvested components (steps 15.2-15.3) — same actor group as 16a
```
POST /dismantling/:id/harvest
{
  "components": [
    { "originalBomItemCode": "COMP-COMPRESSOR-01", "testedCondition": "GOOD_WORKING", "quantity": 1 },
    { "originalBomItemCode": "COMP-GASKET-01", "testedCondition": "GOOD_WORKING", "quantity": 2 }
  ]
}
```
One-shot (only while `PENDING_HARVEST`). Each `originalBomItemCode` is looked up against
`ComponentYieldMatrix` (by this record's `modelId`) and snapshotted - `itemName`,
`category`, `convertedSparePartCode`. A component is only `eligibleForConversion` if it's
`GOOD_WORKING` **and** category `RECOVERABLE_SPARE` **and** has a converted spare part
code - consumables/scrap are excluded per step 15.5, and a component with no matching
matrix row is logged but never convertible. Moves to `COMPONENTS_LOGGED`.

### 16c. Verify, then price-and-post (AC-31's three-actor chain)
```
POST /dismantling/:id/verify
{ "notes": "Confirmed compressor tests good, matches technician log" }
```
Requires `COMPONENTS_LOGGED`; the caller must be a **different** account from whoever
harvested, or you get a 400 ("AC-31 requires the verifier to be different..."). Moves to
`VERIFIED`.

```
POST /dismantling/:id/price-and-post
{
  "conversions": [
    { "originalBomItemCode": "COMP-COMPRESSOR-01", "recoveryUnitPrice": 85.00, "quantityToConvert": 1 }
  ]
}
```
Requires `VERIFIED`; the caller must differ from **both** the harvester and the verifier
(400 otherwise). This is BRD steps 15.4-15.6 combined (Service Manager role - mapped to
`SERVICE_HEAD`/`SUPER_ADMIN`, since there's no dedicated "Service Manager" role in this
system): only components already marked `eligibleForConversion` can be priced - AC-39, no
financial value or live-inventory entry before this point. On success (one atomic
transaction, AC-30):
- The resolved spare part's `MAIN_STORE` stock (`GET /inventory/stock/:sparePartId`)
  increases by `quantityToConvert`.
- The record moves to `POSTED` (terminal), `totalRecoveredValue` is set, and a
  `DISMANTLING_RECOVERY` entry appears in `GET /gl-postings?sourceType=DISMANTLING_RECOVERY`.
- The same AC-17 integrity rule GRN uses applies here too: if the converted spare part
  isn't linked to any `SparePartModel` yet, posting is blocked with a 400 naming it - link
  it via `POST /master-data/spare-parts/:id/link-model` first.

### 16d. Look around
```
GET /dismantling                              (?status= filter)
GET /dismantling/:id
GET /dismantling/serial/:applianceSerialNumber
```

### 16e. Cancel (before verification only)
```
POST /dismantling/:id/cancel
{ "reason": "No salvageable components after inspection" }
```
Only while `PENDING_HARVEST` or `COMPONENTS_LOGGED` - once `VERIFIED`, a supervisor's
sign-off exists and cancelling is blocked (mirrors Delivery's "only while PENDING" gate).

### 16f. Prove the guardrails work
- Try `verify` with the **same** account that just harvested → 400, named error.
- Try `price-and-post` with the harvester's or the verifier's account → 400, named error.
- Try `price-and-post` on a `CONSUMABLE`-category or `DAMAGED` component → 400, "not
  eligible for conversion."
- Try `price-and-post` where the converted spare part has no linked model → 400, same
  message GRN gives for AC-17.
- Try `cancel` on a record that's already `VERIFIED` → 400.
- Live-verified via `scripts/dismantling-e2e-test.ps1` - zero failures, all of the above
  confirmed against the running server, including the actual inventory increment and the
  GL posting.

## 17. Reports/Dashboards — BRD 18.1 Service Manager Dashboard (Phase 11, post-MVP)

FR-20, NFR-02. Read-only Kanban board + three supporting reports over data every earlier
phase already produces — no new entity, nothing to create here, just log in as
SERVICE_HEAD/SUPER_ADMIN/TECHNICAL_TEAM_LEADER and look. 18.2 Finance Dashboard, 18.3
Quality/Product Dashboard, and 18.4 Operational Reports are out of scope for this phase
(see `docs/planning/STATUS_TRACKER.md`'s Phase 11 write-up for why).

### 17a. Job Status Board — GET /reports/dashboard/kanban
```
GET /reports/dashboard/kanban
```
Returns 8 columns in board order (Scheduled, On-Site, WIP, Spare Pending, Approval
Pending, QC Completed, Out for Delivery, Delivered), each with its job cards and a count.
`GET /reports/dashboard/kanban/summary` returns just the counts (cheaper, for a polling
client); `GET /reports/dashboard/overview` bundles this plus the three reports below into
one payload for a dashboard's first page load.

### 17b. Pending Approval Aging — GET /reports/dashboard/approval-aging
```
GET /reports/dashboard/approval-aging
```
Lists every OOW Estimate that's been sent (FR-06 link or a staff-recorded contact) but has
no customer response yet, with `ageHours` and a `breached` flag past the 4-hour threshold
(BRD 18.1's stated red-alert window). Empty until you have a `SENT` Estimate sitting
unanswered — see Section 9 to create one.

### 17c. Service Efficiency — GET /reports/dashboard/service-efficiency
```
GET /reports/dashboard/service-efficiency
```
Average hours from a technician's visit start (`TechnicianVisit.startedAt`, FR-02) to QC
approval (`JobCard.qcApprovedAt`), grouped by technician and by appliance category. Only
counts jobs that have actually passed QC (Section 12) — `sampleSize: 0` is normal on a
freshly-seeded database.

### 17d. First-Time Fix Rate — GET /reports/dashboard/first-time-fix-rate
```
GET /reports/dashboard/first-time-fix-rate
```
`onSiteOnlyCompletedJobs / totalCompletedJobs` — a completed on-site repair is a Job Card
whose `section` is still `ON_SITE_REPAIR` when it reaches `QC_PASSED`/`DELIVERED`. Returns
`rate: null` (not a divide-by-zero error) when nothing's completed yet.

### 17e. The live WebSocket channel
Not reachable from Swagger — connect a Socket.io client to `ws://localhost:3000/reports`
with `{ auth: { token: "<your JWT>" } }` in the handshake. A permitted connection
(same three roles as the REST endpoints) gets an immediate `kanban:update` +
`approval-aging:update` snapshot, then `kanban:update` again whenever the board actually
changes (polled every 5 seconds server-side) and `approval-aging:update` every 15 minutes.
A missing/invalid/wrong-role token gets an `error` event and an immediate disconnect —
never a silently-open, useless connection.

### 17f. Prove the guardrails work
- Any of the 6 REST endpoints with no `Authorization` header → 401.
- Any of them logged in as a role outside `SERVICE_HEAD`/`SUPER_ADMIN`/
  `TECHNICAL_TEAM_LEADER` (e.g. `TECHNICIAN_FIELD`) → 403, naming the required roles.
- The same wrong-role account against the WebSocket channel → connects, then immediately
  gets an `error` event and is disconnected — no snapshot is ever sent.
- Live-verified via `scripts/reports-e2e-test.ps1` (which drives
  `scripts/reports-ws-test.js` for the WebSocket half) — zero failures, all of the above
  confirmed against the running server with real seeded data.

## 18. Frontend — React app (Frontend Phase 1: Auth)

Everything above is tested through Swagger (no UI). Starting this session, there's also a
real React app in `frontend/`, being built the same one-module-at-a-time way as the
backend. So far it only covers login/logout — every other screen is still "Swagger only"
until its own frontend phase ships (tracked in `docs/planning/STATUS_TRACKER.md`'s
"Next" section).

**a. Start it** (if it isn't already running in its own window):
```powershell
cd "D:\Jackys\jackys service portal\frontend"
npm run dev
```
Leave the backend (`npm run start:dev`, port 3000) running in its own window too — the
frontend calls it directly and does nothing useful without it.

**b. Open the app**: browse to **http://localhost:5173**. You should land on a sign-in
form for "Jacky's Service Portal."

**c. Sign in** with the same admin login as everywhere else:
```
email:    admin@jackys.com
password: Admin123!
```
On success you land on a dashboard showing your profile (name, email, role, employee ID,
status, last login) pulled live from `GET /auth/profile` — not hardcoded — plus a list of
the 12 frontend phases and which ones are done vs. still queued.

**d. Things worth trying**:
- Log out (button in the bottom-left sidebar) — you should land back on the sign-in form.
- Try a wrong password — you should see "Incorrect email or password," not a raw error.
- Refresh the page while signed in — you should stay signed in (the app re-checks who you
  are via `/auth/profile` on every load, rather than trusting a cached name).
- Leave the tab open for over 15 minutes (the access token's lifetime, NFR-04), then click
  something — it should silently refresh your session using the refresh token rather than
  bouncing you out; if it does bounce you to `/login`, that's a bug worth reporting.

**e. What to report back**: anything that looks wrong, confusing, or ugly — this phase-by-
phase process only works if real screens get real reactions before the next phase starts.

---

## 19. Frontend — Master Data Management (Frontend Phase 2)

Adds a **Master Data** section to the sidebar nav, with its own row of 9 tabs — one per
sub-module the backend exposes under `/master-data/*`. Every screen calls the real
backend directly; nothing here is mocked. Bulk Import is **not** a screen yet (no
file-upload UX has been designed) — it stays Swagger-only for now.

**a. Get there**: sign in as `admin@jackys.com` / `Admin123!` (Section 1a), then click
**Master Data** in the sidebar. You should land on the first tab (Service Centres) with
the other 8 as tabs across the top.

**b. Service Centres** — the only tab with full create/update/delete:
- Click **New Service Centre**, fill in name/address/contact, and set at least one
  weekday (e.g. Monday) to open with a start/end time and a max-jobs-per-day number.
  Save — the new row should appear in the table immediately.
- Edit that row (change the max-jobs number) and confirm the table updates.
- Delete it (soft delete) — it should disappear from the list.

**c. Create-and-list-only tabs** (no Edit/Delete button — the backend has no update or
delete endpoint for these, so none is shown):
- **Fault & Symptoms** — add a fault, confirm it lists.
- **Spare Part Models** — add a model (note its name — Component Yield in step d needs an
  existing model).
- **Technician KPI Rules** — add a rule for an activity type.
- **Notification Templates** — add a template for a channel/trigger pair.

**d. The three "shaped differently" tabs** (each mirrors a real backend gap, not a UI
bug):
- **Spare Parts**: the list has no create form of its own (parts come from GRN, a later
  phase) — instead try **Link to model** on an existing part and confirm it succeeds
  once a real Spare Part Model exists (AC-17: a part must be linked before GRN accepts
  stock for it).
- **Service Price List**: there's no plain table — pick an **activity type** from the
  dropdown first; the list only populates after that, because `GET /price-lists` requires
  the `activityType` query param.
- **Warranty Master**: no list at all — use the **create** form to add a warranty rule,
  then use the separate **check by serial number** box (the same lookup a technician's
  S/N validation step uses) to confirm it returns `isUnderWarranty`/period/supplier for a
  serial you'd expect to match.
- **Component Yield Matrix**: no plain list either — toggle between **by model** and **by
  recovery category** and confirm both views return rows once at least one entry exists.

**e. What to report back**: same as Phase 1 — anything confusing, broken, or where a
missing Edit/Delete button looks like a bug rather than the deliberate gap it is (check
`docs/planning/STATUS_TRACKER.md`'s Frontend Phase 2 section first if unsure which is
which).

---

## 20. Frontend — Appointment Scheduling + Technician Field View (Frontend Phase 3)

Adds an **Appointments** section to the sidebar nav, with two tabs: **Schedule** (the
admin/CCE console) and **My Field Visits** (the technician's own day). Both call the real
backend directly.

**a. Get there**: sign in as `admin@jackys.com` / `Admin123!` (Section 1a), then click
**Appointments** in the sidebar. You land on the **Schedule** tab.

**b. Create an appointment**: click **New Appointment**, fill in the customer/service
centre/date-time/type fields, and save. It should appear in the table with status
`SCHEDULED`.

**c. Walk it through its lifecycle** (the row's action buttons only show what's actually
allowed from the current status — same guards the backend enforces):
- **Confirm** (`SCHEDULED` → `CONFIRMED`).
- **Assign Technician** — paste the technician user id from Section 4 (there's no user
  picker — the backend has no "list users" endpoint, so this mirrors the Warranty
  Master/Spare Parts precedent of a pasted id). The backend rejects a non-technician id.
- **Mark On-site** (`CONFIRMED`/`TECHNICIAN_ASSIGNED` → `ON_SITE`).
- **Complete** (`ON_SITE` → `COMPLETED`).
- **Cancel** — try it with a reason under 3 characters first (should be blocked
  client-side, matching the backend's `@MinLength(3)`), then with a real reason.
- Try the filters (service centre, technician, status, type, date range) and confirm the
  table and pagination update.

**d. Technician Field View**: click **My Field Visits**. This calls
`GET /technician/schedule` as whoever is logged in — sign in as the technician account
from Section 4 to see appointments actually assigned to them. Pick a date, expand an
appointment, and walk the 3-step capture flow:
- **Start visit** — click **Use my location** (allow the browser's location prompt) or
  type a latitude/longitude manually if you'd rather not grant it. This should move the
  appointment to `ON_SITE` if it wasn't already.
- **Serial number** — enter a serial number that exists in Warranty Master (Section 3's
  Warranty Master tab) and capture it; you should see the warranty badge
  (in/out-of-warranty) come back.
- **Fault/Symptom** — only enabled once a serial number is captured; enter a fault and
  symptom code that exist in Master Data's Fault & Symptoms tab.
- Re-capture the serial number and confirm the fault/symptom you just entered is cleared —
  that's the backend's real behavior, not a UI bug.

**e. What to report back**: same as Phases 1–2 — anything confusing, broken, or where a
button that should be enabled/disabled looks wrong (check `docs/planning/STATUS_TRACKER.md`'s
Frontend Phase 3 section first if unsure which behavior is deliberate).

---

## 21. Frontend — Job Cards + Warranty Override (Frontend Phase 4)

Adds a **Job Cards** section to the sidebar nav. There's no list here on purpose — the
backend has no "list all Job Cards" endpoint, only look-up by appointment — so this
screen is a lookup/create panel, not a table.

**a. Get there**: sign in as `admin@jackys.com` / `Admin123!` (Section 1a). The quickest
path is from an appointment: go to **Appointments → Schedule** (Section 20), open a
**COMPLETED** appointment (one where the technician has already captured serial number
and fault/symptom — Section 20d), and click the **Job Card →** button in its detail view.
That takes you straight to the Job Cards screen with the appointment id pre-filled.
Alternatively, click **Job Cards** in the sidebar and paste an appointment id in
yourself.

**b. Create it**: if no Job Card exists yet, click **Create Job Card**. This is blocked
by the backend (FR-05) unless the appointment has an invoice number on file *and* the
technician's visit is fully captured (serial number, warranty check, fault/symptom) —
if either is missing you'll see the backend's real error message, not a generic one.

**c. Walk it through its lifecycle**:
- **Validate S/N** (shown only while `OPEN`) — click **Matches** to move to
  `SN_VALIDATED`, or **Doesn't match** to record a mismatch without advancing (the job
  stays `OPEN`).
- **Assign section** (shown only once `SN_VALIDATED`) — pick **On-site repair** or
  **Workshop**. If the job is out-of-warranty and no customer approval is on file yet,
  the buttons are disabled with an explanation — that's the real FR-06 gate, not a bug.
- **Record customer approval** (shown for out-of-warranty jobs) — add optional notes and
  approve; this unblocks section assignment above.
- **Warranty Override** (shown only if you're signed in as a Technical Team Leader,
  Service Head, or Super Admin) — the button offers the *other* warranty status with a
  required reason (minimum 5 characters). Try it, then confirm the badge and override
  count update.
- **Cancel** — available until the job reaches `READY_FOR_QC`/`QC_PASSED`/`DELIVERED`
  (later phases' territory) or is already cancelled.

**d. Things worth trying**: sign in as a CCE (not a Team Leader) and confirm the Warranty
Override panel doesn't appear at all; try assigning a section on an out-of-warranty job
before approving the customer and confirm you're blocked; try validating S/N a second
time once it's already `SN_VALIDATED` and confirm the backend rejects it.

**e. What to report back**: same as Phases 1–3 — anything confusing, broken, or where a
missing action looks like a bug rather than a status the backend genuinely hasn't
reached yet (check `docs/planning/STATUS_TRACKER.md`'s Frontend Phase 4 section if
unsure).

---

## 22. Frontend — Estimates + Public Approval Link (Frontend Phase 5)

Adds an **Estimates** section to the sidebar nav (staff), plus a brand-new
**unauthenticated** page at `/estimate/:token` that only a customer would open (no
sidebar, no sign-in) — this is the shareable-link side of Section 9's backend flow, now
with real screens on both ends.

**a. Get there (staff side)**: sign in as `admin@jackys.com` / `Admin123!` (Section 1a).
The quickest path is from a Job Card: go to **Job Cards** (Section 21), look up an
out-of-warranty Job Card that's `SN_VALIDATED`, and click **Use the Estimate flow →** next
to the manual "Record customer approval" note. Alternatively, click **Estimates** in the
sidebar and paste the Job Card's id yourself.

**b. Create and send it**: click **Create Estimate**, add one or more line items
(description/quantity/unit price), and submit — this only appears while there's no
active estimate already on file (an `EXPIRED` or `REJECTED` one doesn't block a fresh
one; only `DRAFT`/`SENT`/`APPROVED` does). Once created, click **Send Estimate** — this
generates a 7-day shareable link and shows what channels were attempted/delivered
(Section 9b's known gap: real delivery isn't wired up yet, so treat the link itself as
the reliable path). **Copy** the link shown — you'll need it for step c.

**c. Respond as the customer**: open the copied link in a private/incognito window (so
it's not carrying your staff session) — you should land on a plain, unbranded-for-staff
approval page showing the job card number, line items, subtotal/VAT/total, and an
**Approve**/**Decline** choice. Try both an approval and, on a separate estimate, a
decline, and confirm the Job Card (back in the staff view) reflects it — `customerApproved`
flips true on approval; the Job Card moves to `RWR` on a decline.

**d. The staff-recorded path (most customers never click the link)**: on a `SENT`
estimate, use **Record customer decision** instead — note the contact-value buttons that
prefill the exact phone/email on file; using those instead of typing avoids the
backend's anti-consent-laundering check rejecting a slightly different format of the
same number.

**e. Revise after a rejection**: on a `REJECTED` estimate, use **Revise** — leave "reuse
line items" checked to create an identical fresh `DRAFT` linked to the rejected one, or
uncheck it to change the numbers. Confirm the Job Card comes back out of `RWR` to
`SN_VALIDATED`, and that the estimate history below now shows both the old (rejected) and
new (draft) rows.

**f. Things worth trying**: try opening an already-responded-to or expired link a second
time and confirm you get a clear "no longer active" message, not a raw error; try
responding to the same link twice in two tabs and confirm the second one reports it was
already decided; try recording a response with a contact value that doesn't match what's
on file and confirm you get a specific rejection, not a silent failure.

**g. What to report back**: same as Phases 1–4 — anything confusing, broken, or where a
missing action looks like a bug rather than a status the backend genuinely hasn't reached
yet (check `docs/planning/STATUS_TRACKER.md`'s Frontend Phase 5 section if unsure).

**Before testing this section**: run `npm install` once in `frontend/` if you haven't
since this phase shipped — it adds the test tooling (Vitest, React Testing Library) this
phase's automated tests use; it doesn't affect the app you run in the browser, only
`npm test`.

---

## 23. Frontend — Workshop + Inventory (Frontend Phase 6)

Adds a **Workshop & Inventory** section to the sidebar nav (staff only — nothing here is
customer-facing), with two tabs: **Workshop** (per-Job-Card: assign a technician, start
WIP, request spares, mark complete) and **Inventory & Stock** (GRN, stock lookup, the
stale-reservations queue, review/return). This is the richest edge-case screen built so
far — partial reservations, a staleness clock, and a rework-approval gate all live here.

**a. Get there (staff side)**: sign in as `admin@jackys.com` / `Admin123!` (Section 1a).
The quickest path is from a Job Card: go to **Job Cards** (Section 21), look up a
`SN_VALIDATED` job, click **Workshop** in the "Assign section" step, and once you assign
`WORKSHOP` you'll see a **"Go to the Workshop screen →"** link right there. Alternatively,
click **Workshop & Inventory** in the sidebar and paste the Job Card's id yourself.

**b. Assign a technician, start WIP**: on `SECTION_ASSIGNED` (Workshop section), paste a
technician's user id (same "no list-technicians endpoint" convention as Appointments) and
**Assign**. Once `WORKSHOP_ASSIGNED`, click **Start WIP** to move to `IN_PROGRESS`.

**c. Request a spare part**: pick a spare part (create one under Master Data → Spare
Parts first if you haven't, and link it to a model — GRN below is blocked otherwise, AC-17)
and a quantity, then **Request Spare**. Watch the result panel: if stock only partially
covers the request, you'll see `PARTIALLY_RESERVED` and the job moves to `SPARE_PENDING`
— **Complete** is blocked while this is true. A follow-up request for the shortfall (after
receiving more stock via GRN on the Inventory tab) that's fully covered moves the job back
to `IN_PROGRESS` automatically. Try the **"Not needed — request return"** shortcut on a
`HELD` result too.

**d. Complete workshop work**: once `IN_PROGRESS` with nothing outstanding, **Complete →
Ready for QC** moves the job to `READY_FOR_QC`. Note that the Request Spare form is still
there on a `READY_FOR_QC` job — try a top-up request and confirm the job stays
`READY_FOR_QC` (this is deliberate: QC approval itself re-checks stock and can be blocked
on a shortfall the same way `complete()` can, per `workshop.service.ts`'s own comment —
QC's own screens are Frontend Phase 7).

**e. Inventory tab — GRN, stock, stale reservations, returns**: **Goods Received Note**
receives new stock for a spare part (try an unlinked one to see the AC-17 block). **Stock
lookup** shows on-hand/reserved/available for Main Store or Damage Location — a part
that's never been received shows a distinct "no stock row exists yet" note instead of a
plain zero. **Stale reservations** lists everything idle 24h+ (nothing will appear here
for a reservation you *just* made — that's the documented visibility gap, not a bug; see
the note on both screens). If something is listed, try **Approve reallocation** (moves it
to `RETURN_PENDING`) or **Reject** (snoozes another 24h). After an approval, use **Confirm
a physical return** (paste the reservation id shown) to complete the loop and watch stock
move back onto Main Store.

**f. The rework re-request gate — UI-visible but not yet UI-triggerable**: the Request
Spare form shows extra sign-off fields (approver id or verbal override) whenever
`qcRejectionCount > 0` on the Job Card, but nothing in this phase's screens can actually
*cause* a QC rejection yet — QC approve/reject get their own screens in Frontend Phase 7.
`verify-phase6.ps1` (below) exercises the real gate directly against the backend so it
isn't untested, but a fully click-through demonstration of it has to wait for Phase 7.

**g. Things worth trying**: request more of a spare part than is on hand and confirm you
get a clear `PARTIALLY_RESERVED` result, not a silent short-fill; try completing a
`SPARE_PENDING` job and confirm you get a specific, readable block rather than a raw 400;
open the Workshop screen as a technician not assigned to that job (if you have a second
technician account) and confirm you see the ownership notice instead of broken buttons.

**h. What to report back**: same as Phases 1–5 — anything confusing, broken, or where a
missing action looks like a bug rather than a status the backend genuinely hasn't reached
yet (check `docs/planning/STATUS_TRACKER.md`'s Frontend Phase 6 section if unsure).

---

## 24. Frontend — QC + Permissions admin (Frontend Phase 7)

Adds a **QC & Permissions** section to the sidebar nav with two tabs: **QC** (approve or
reject a `READY_FOR_QC` Job Card) and **Permissions** (admin-only: grant/revoke
`QC_APPROVAL`/`REWORK_APPROVAL`, see who currently holds a permission, look up a user's
full grant history).

**a. Get there**: sign in as `admin@jackys.com` / `Admin123!` (Section 1a). The quickest
path to a QC-able job is from the Workshop screen (Section 23) - complete a job's
workshop work (`Complete → Ready for QC`) and you'll see a **"Go to the QC screen →"**
link right there. Alternatively, click **QC & Permissions** in the sidebar and paste the
Job Card's id yourself.

**b. Approve**: on a `READY_FOR_QC` job, **Approve → QC Passed** requires the
`QC_APPROVAL` permission (grant it to yourself on the Permissions tab first, or as
`SUPER_ADMIN`/`SERVICE_HEAD` - Section 24d below). On success, reserved stock moves
Main Store → Damage Location; check the spare part's stock on the Inventory tab
(Section 23e) before/after to see it. If the job's spares aren't all fully reserved -
specifically, if the *most recent* request for any one spare part on this job came back
short - Approve is blocked with a red list naming each short part and a link back to
Workshop to top up.

**c. Reject**: type a reason (5-500 characters) and **Reject**. The job goes back to
`IN_PROGRESS` and a link back to the Workshop screen appears immediately - there's
nothing further to do on the QC screen itself once rejected. Try requesting the same
spare part again from Workshop afterward to see the rework sign-off fields Section 23f
already covers.

**d. Permissions tab (admin only - `SUPER_ADMIN`/`SERVICE_HEAD`)**: **"Who currently
holds a permission"** lists active holders of `QC_APPROVAL` or `REWORK_APPROVAL` (switch
the dropdown to see either) with a **Revoke** button per row - check this before granting
so you're not acting blind. **Grant a permission** pastes a user id (same "no
list-users endpoint" convention as everywhere else in this app) plus a type and optional
notes; granting the same active permission to the same user twice is rejected (409). The
**grant history lookup** at the bottom shows a pasted user's full history, active and
revoked, with a status badge - useful for confirming a revoke actually took effect.

**e. Role floor vs. the real gate**: any `QC_GATE_ROLES` member (`SUPER_ADMIN`,
`SERVICE_HEAD`, `TECHNICAL_TEAM_LEADER`, `CCE`, `QC_OFFICER`) sees the Approve/Reject
buttons - that's just who the backend even lets *attempt* it. Whether the action
actually succeeds depends on the separate `QC_APPROVAL` grant (Permissions tab), which
is deliberately not tied to any role - even `SUPER_ADMIN` needs it explicitly. If you see
Approve/Reject buttons but get a 403 with "Ask an admin to grant it", that's this working
as designed, not a bug - go grant yourself the permission on the Permissions tab.

**f. Things worth trying**: request two different spare parts on the same job, let one
come back fully held and the other partially - complete the job anyway (the job-level
check only looks at the *most recent* request's outcome) and confirm Approve still
blocks on the genuinely-short part specifically, naming it. Try Approve as a role
outside `QC_GATE_ROLES` (if you have a second non-privileged account) and confirm you
see the plain "your role isn't allowed to attempt this" notice instead of a raw error.
Try the Permissions tab as a non-admin role and confirm you get a clear restricted
notice, not a broken page.

**g. What to report back**: same as Phases 1–6 — anything confusing, broken, or where a
missing action looks like a bug rather than a status the backend genuinely hasn't reached
yet (check `docs/planning/STATUS_TRACKER.md`'s Frontend Phase 7 section if unsure).

---

## 25. Frontend — Delivery + Invoicing (Frontend Phase 8)

Adds a **Delivery & Invoicing** section to the sidebar nav with two tabs: **Ready for
Delivery** (the `QC_PASSED` pool waiting to be claimed into a delivery, IW/OOW sub-tabs,
batch-select) and **Deliveries** (every DLV# through dispatch, proof of delivery, or
cancellation). Invoicing itself has no standalone screen yet - it's reached in-context,
wherever an out-of-warranty payment needs recording (a full Invoicing screen with
payment-history browsing and the B2B aging report is Frontend Phase 9).

**a. Get there**: sign in as `admin@jackys.com` / `Admin123!` (Section 1a), or any
`LOGISTICS_DISPATCHER`/`DRIVER`/`SERVICE_HEAD` account. Click **Delivery & Invoicing**
in the sidebar, or follow the **"Go to Delivery →"** link that now appears on a
`QC_PASSED` job's QC screen (Section 24).

**b. Ready for Delivery tab**: switch between **In Warranty** and **Out of Warranty**
sub-tabs. IW rows have nothing further to check - warranty covers it. OOW rows show an
**Invoice** column: `not yet invoiced` with a **Check invoice** button until you look,
or a status badge (`DRAFT`/`PARTIALLY_PAID`/`PAID`) with a **View / pay** button once
one exists - clicking either opens the payment modal for that job card without minting
an invoice just by scrolling past the row. Check one or more boxes and **Create
Delivery**: if every OOW member is `PAID` (or `B2B Credit`-eligible), you get a single
DLV# covering everything you selected, IW and OOW mixed freely. If any OOW member isn't
paid, the WHOLE batch is blocked - a red panel lists each unpaid job with the exact
amount owed and its own **Record payment** button, right there.

**c. Recording a payment**: pick a method (Cash/Card/Bank Transfer/B2B Credit), enter an
amount (partial payments are fine - the invoice sits at `PARTIALLY_PAID` until the full
amount is covered across one or more payments), an optional reference, and submit.
**B2B Credit only works for a real B2B customer's job** - try it on a B2C job and you'll
get the server's own rejection, not a silently-accepted bypass (this is deliberate: it's
the guard against B2B Credit becoming a free way to skip payment).

**d. Deliveries tab**: filter by status, click **View** on any row to open its detail
below the list - the delivery record, every member job card (via the id you paste or the
link from Ready above), and the actions available for its current status:
   - **PENDING**: **Dispatch** (driver id is optional - same "paste an id, no picker"
     convention as everywhere else in this app) or **Cancel** (requires a reason -
     releases every member job card straight back into the Ready pool).
   - **DISPATCHED**: **Capture Proof of Delivery** - a recipient name plus a signature
     OR a photo (file upload only; there's no signature-pad widget yet, see Section
     25f). Submitting flips the delivery AND every member job card to `DELIVERED`. If
     payment somehow lapsed on an OOW member since the delivery was created, this is
     blocked with the same structured red panel as batch-creation (the backend
     re-checks defensively right before the irreversible hand-back).
   - **DELIVERED**: a read-only summary - who received it, when, and the
     signature/photo thumbnails.
   - **CANCELLED**: the reason you gave.

**e. Things worth trying**: create a batch mixing an IW and an OOW job in one call and
confirm they share one DLV#. Try dispatching a delivery twice, or cancelling one that's
already been dispatched, and confirm you get a clear rejection rather than a silent
no-op. Try submitting the POD form with only a recipient name (no file) and confirm
**Mark Delivered** stays disabled until you attach one.

**f. Known limitation**: POD capture is plain file upload (read into a base64 data URI
client-side) - there's no camera-capture or signature-pad component in this app yet.
Works fine from a desktop browser with a saved image; a real driver-facing mobile app
would want a proper signature pad.

**g. What to report back**: same as Phases 1–7 — anything confusing, broken, or where a
missing action looks like a bug rather than a status the backend genuinely hasn't reached
yet (check `docs/planning/STATUS_TRACKER.md`'s Frontend Phase 8 section if unsure).

---

## 26. Frontend — Finance + Customer Portal (Frontend Phase 9)

Adds the two read primitives deferred from Phase 8 - a real invoice list and the B2B
aging report - under a new **Finance & Customer Portal** sidebar destination, plus a
brand-new **public, no-login** page customers can be sent a link to: `/track/:token`,
which shows repair status, what's owed, and a printable job summary from one shared
link.

**a. Get there (staff side)**: sign in as `admin@jackys.com` / `Admin123!` (Section 1a),
or any `ACCOUNTANT`/`FINANCE_MANAGER`/`SERVICE_HEAD` account. Click **Finance &
Customer Portal** in the sidebar. Anyone without one of those roles who navigates there
directly sees a plain "restricted" message and nothing else loads - no invoice data is
ever fetched for a denied role, not just hidden after the fact.

**b. Invoices tab**: every invoice, newest first, filterable by status
(Draft/Partially Paid/Paid/Cancelled) and by customer type (B2C/B2B) - this is the
general browse/audit view Phase 8 didn't have (it only had by-id and by-job-card
lookups, plus the B2B-unpaid-only aging report). Click **View** on any row to open its
detail: invoice fields, a payment-history list (method, amount, date, reference), the
running "Paid so far" / "Remaining" totals, a **View Job Card →** link back to the
originating job, and - if it isn't fully settled yet - a **Record Payment** button
reusing the same payment modal from Delivery (Section 25c). You can also land straight
on one invoice's detail via `?invoiceId=...` in the URL, same deep-linking convention
used throughout this app.

**c. B2B Aging Report tab**: the 4 standard aging buckets (0-30 / 31-60 / 61-90 / 90+
days past due), always all 4 shown even when a bucket is empty, each listing its unpaid
B2B invoices with the total outstanding per bucket and overall. Click any invoice in a
bucket to jump straight to its full detail on the Invoices tab.

**d. Customer tracking link**: open any Job Card (Section 21) - if it has a
`publicToken` (all job cards do, minted at creation), you'll see a new **Customer
tracking link** box with a copy-to-clipboard field, same UI as the existing Estimate
public-link box. That's the link a customer would actually receive.

**e. The public page itself**: paste the copied link into a browser - no sign-in, works
in an incognito window. Three sections in one page, since all three share one token:
   - **Status** (loads immediately): a friendly, plain-English status line (e.g. "Being
     repaired" rather than `IN_PROGRESS`) and the job card number.
   - **What You Owe** (loads only once you click its tab): either "covered by warranty -
     nothing to pay" (in-warranty job), "no invoice yet" (out-of-warranty but not
     invoiced), or the real amount due/paid - and if anything is still owed, an explicit
     line on how to actually pay (this app is manual-payment-only; there's no online
     payment button, deliberately, so it never looks broken or unfinished).
   - **Download Summary** (also loads lazily): job card + estimate line items + invoice
     + delivery details combined, with a **Print / Save as PDF** button (uses the
     browser's own print dialog).
   
   Try an invalid or made-up token in the URL - you should get a plain "we couldn't
   find that tracking link" message, and it looks identical whether the token is simply
   wrong or a real-but-expired one (tokens don't reveal which, on purpose).

**f. Things worth trying**: view the "What You Owe" tab on a fresh out-of-warranty job
*before* any invoice has been created for it, and confirm it says "no invoice yet"
rather than erroring - just viewing the portal never creates an invoice as a side
effect. Record a second partial payment on an already-`PARTIALLY_PAID` invoice through
the Finance Invoices tab (or the Delivery tabs) and confirm the payment form now
defaults to the *remaining* balance, not the full original amount (a real bug from
Phase 8 fixed this phase - it used to always default to the full amount, which the
server would reject once anything had already been paid).

**g. Known limitation**: Finance has no UI yet for `GET /gl-postings` - the underlying
ledger endpoint is fully built and role-gated, but wasn't in this phase's scope; it's on
the deferred-follow-ups list in `docs/planning/STATUS_TRACKER.md`.

**h. What to report back**: same as Phases 1-8 - anything confusing, broken, or where a
missing action looks like a bug rather than a status the backend genuinely hasn't reached
yet (check `docs/planning/STATUS_TRACKER.md`'s Frontend Phase 9 section if unsure).

---

## 27. Frontend — AMC Management (Frontend Phase 10)

Adds a new **AMC Contracts** sidebar destination covering the full Annual Maintenance
Contract lifecycle: contract creation with an auto-generated preventive-maintenance
visit schedule, visit completion, renewal, cancellation, billing, expiry reminders, and
an upsell-candidates report.

**a. Get there**: sign in as `admin@jackys.com` / `Admin123!` (Section 1a), or any
`SERVICE_HEAD`/`CCE`/`TECHNICIAN_FIELD`/`TECHNICIAN_WORKSHOP`/`ACCOUNTANT`/
`FINANCE_MANAGER` account - this screen is deliberately broad-access since technicians
need to see their PM visits and Finance needs to see billing, but individual actions
(create/renew/cancel, complete a visit, bill/record payment) stay role-gated per action,
not per page. Anyone outside all of those roles sees a plain "restricted" message and no
AMC query ever fires. Three tabs: Contracts, Expiring Soon, Upsell Candidates.

**b. Contracts tab**: every contract, newest first, filterable by status (Active /
Expired / Cancelled / Renewed). Click **+ New Contract** to open the create form -
customer details, service centre id and (optional) assigned technician id are pasted
UUIDs (this app has no picker component anywhere, same convention as every other
service-centre/technician field), covered serial numbers as a comma-separated list,
coverage type, visit frequency (Monthly/Quarterly/Half-Yearly), date range, total
amount, and payment terms. As you fill in the date range and frequency, a live line
appears - *"This will generate N PM visits"* - and if that number would exceed the
backend's 60-visit safety cap, the line turns into a warning and the Create button
disables itself before you can even submit. Click any contract to open its detail:
contract fields, the full PM visit schedule (each row shows its scheduled date and
status), and an embedded billing section - plus, for an `ACTIVE` contract you're allowed
to manage, **Renew**, **Cancel**, and **Send renewal reminder** buttons.

**c. Completing a PM visit**: on a contract's `SCHEDULED` visit row, click **Complete**
(only technicians/Service Head/Super Admin see this). The form takes checklist notes, an
optional signature capture, and an optional extra charge - AMC coverage is pre-paid, so
any extra charge requires an explicit "customer approved this on the spot" checkbox; try
entering an amount without ticking it and the Complete button disables itself with an
inline explanation, matching the backend's own rule exactly. A completed row switches to
a **View completion** button showing what was recorded.

**d. Billing**: inside a contract's detail, the billing section lists any generated
invoices and lets a Finance/Service Head/Super Admin user generate a new one by typing a
period label (e.g. "Q1 2026") - the amount is computed automatically from the contract's
total and payment terms (full upfront / half-yearly / quarterly split). Try generating a
second invoice with the *same* period label - it's rejected, since nothing else ties an
invoice to "the period it covers" and a duplicate would otherwise go unnoticed until
reconciliation. Recording payment on a `DRAFT` invoice is deliberately full-amount-only
(no partial-payment amount field, unlike the Invoicing module) - pick a method and
optionally a reference, done.

**e. Expiring Soon tab**: `ACTIVE` contracts expiring within a configurable window
(default 30 days, editable). Each row has a **View** link into the full contract detail
and, for a manager, a **Send reminder** button right there - no need to go find the
contract first just to send a reminder.

**f. Upsell Candidates tab**: out-of-warranty customers who just had a repair approved
(an approved Estimate exists) and aren't already covered by an AMC contract - a
heuristic phone-number match, called out as such rather than presented as precise CRM
data. Each row links straight into a **Create AMC Contract** form pre-filled with that
customer's name and phone.

**g. Things worth trying**: on the Schedule page (Section 20), find an AMC-type
appointment that's `ON_SITE` - instead of the usual generic **Complete** button, it
shows **Complete PM Visit →**, linking straight into this module's own completion flow;
a non-AMC appointment in the same state is completely unaffected and still shows the
regular Complete button. This is deliberate: the generic completion endpoint now
actively rejects an AMC-type appointment, so a technician can never accidentally lose a
PM visit's checklist/signature/extra-charge record by using the wrong button.

**h. What to report back**: same as Phases 1-9 - anything confusing, broken, or where a
missing action looks like a bug rather than a status the backend genuinely hasn't reached
yet (check `docs/planning/STATUS_TRACKER.md`'s Frontend Phase 10 section if unsure).

---

## 28. Frontend — Dismantling (Frontend Phase 11)

Adds a new **Dismantling** sidebar destination covering component recovery from a
write-off appliance already sitting in Damage Location (BRD Workflow 15, FR-19,
AC-29/30/31) - a standalone record, not tied to any Job Card, that moves through
`PENDING_HARVEST → COMPONENTS_LOGGED → VERIFIED → POSTED` (or `CANCELLED`).

**a. Get there**: sign in as `admin@jackys.com` / `Admin123!` (Section 1a), or any
technician/lead/`SERVICE_HEAD`/`ACCOUNTANT`/`FINANCE_MANAGER` account - the page itself is
broad-access (everyone in those roles can view), but the three key actions are individually
role- *and* status-gated: **Log Harvest** (technicians, leads, Service Head, Super Admin),
**Verify** (leads, Service Head, Super Admin), **Price & Post** (Service Head, Super Admin
only - there's no dedicated "Service Manager" role in this system).

**b. The three-distinct-actor rule (AC-31)**: this is the module's defining constraint -
the person who harvests, the person who verifies, and the person who prices-and-posts must
be three genuinely different people. The frontend enforces this pre-emptively, not just by
surfacing the backend's rejection after the fact: if you're logged in as the same person
who harvested a record, its **Verify** button renders visibly disabled with an inline
explanation ("You harvested this record — a different person must verify it") rather than
letting you click it and hit a 400. Same for **Price & Post** against both the harvester
and the verifier. To actually exercise the full lifecycle yourself you'll need at least two
accounts beyond admin - see `verify-phase11.ps1`'s header comment for how to seed a second
test account with any role via `scripts/seed-technician.ts`'s `SEED_TECH_ROLE` variable
(despite its name, it's role-agnostic - "Phase 5: any seeded role name works").

**c. Creating a record**: click **+ New Record** and fill in the appliance's serial
number, model id, and optional damage-location notes - all free text, matching this app's
established convention for fields with no picker. This creates the record at
`PENDING_HARVEST` and opens its detail panel.

**d. Log Harvest**: from a `PENDING_HARVEST` record, click **Log Harvest** to open a
dynamic line-item form - add a row per component you pulled off the appliance, typing its
original BOM item code (a shared dropdown, sourced from that model's Component Yield
Matrix if one exists, offers known codes as you type - but you can still type a code
that isn't listed), its tested condition (Good/Working or Damaged), and quantity. If a
typed code doesn't match anything in the model's yield matrix, an inline amber warning
appears right under that row before you submit - catching a typo now, since once the
record leaves `PENDING_HARVEST` there's no way to re-harvest and an unmatched code can
never become eligible for conversion. Submitting moves the record to `COMPONENTS_LOGGED`.

**e. Verify**: from a `COMPONENTS_LOGGED` record, a permitted, different-from-the-harvester
user clicks **Verify** (with optional notes) to move it to `VERIFIED`.

**f. Price & Post - read the banner first**: from a `VERIFIED` record, a permitted, third
distinct user clicks **Price & Post**. This is the single most consequential action in the
module - the modal opens with an always-visible banner stating this is *the only pricing
pass this record will ever get*. Only components flagged `eligibleForConversion` are
selectable; tick a component's checkbox to select it, then enter its recovery unit price
and (optionally) a quantity to convert, up to the harvested amount. If you select fewer
than all the eligible components, a required "I understand the rest will be permanently
forfeited" checkbox appears and must be ticked before **Post recovery** enables - selecting
every eligible component skips that extra step entirely, since nothing is being left
behind. On submit, the backend upserts recovered stock into Main Store inventory and posts
to the GL; the record moves to `POSTED` and can never be posted again.

**g. If Price & Post fails with a conflict**: if someone else posts the same record first
(a genuine race, guarded server-side), you'll see a distinct amber "reload and retry"
message rather than a generic red error - and critically, whatever prices/quantities you'd
already typed stay exactly as you left them, so you don't have to redo the work before
retrying against the refreshed record.

**h. Cancel**: available on `PENDING_HARVEST` or `COMPONENTS_LOGGED` records only - once a
record reaches `VERIFIED` it can no longer be cancelled (that would discard a supervisor's
sign-off with nothing to show for it), so the Cancel button simply isn't offered past that
point.

**i. The harvested-components table**: on any record's detail panel, a component logged
against a BOM code with no yield-matrix match at harvest time (so its category and
convertible-part fields were never resolved) shows a distinct "⚠ not in yield matrix"
badge, instead of blending in as if it were a genuine `CONSUMABLE`/`SCRAP` classification -
worth checking deliberately if you tested (d)'s typo scenario.

**j. What to report back**: same as Phases 1-10 - anything confusing, broken, or where a
missing action looks like a bug rather than a status the backend genuinely hasn't reached
yet (check `docs/planning/STATUS_TRACKER.md`'s Frontend Phase 11 section if unsure). One
known, deliberate backend limitation, unreachable from this UI and not fixed: see that same
STATUS_TRACKER section's note on a latent duplicate-conversion-line edge case in
`priceAndPost()` - the built modal can never construct a request that triggers it.
`verify-phase11.ps1` has already run clean against the real backend (51/51 checks passed,
0 failed), including AC-31's same-actor rejections at the service layer, so this section is
about manual/UI exploration, not first-pass API verification.

---

## 29. Frontend — Reports/Dashboards (Frontend Phase 12, the live Kanban board)

Adds the **Reports & Dashboards** sidebar destination (BRD 18.1 "Service Manager
Dashboard", FR-20, NFR-02) - the last of the 12 frontend phases, and the first purely
read-only screen in the app: nothing here creates, updates, or deletes anything.

**a. Get there**: sign in as `admin@jackys.com` / `Admin123!` (Section 1a), any
`SERVICE_HEAD`, or any `TECHNICAL_TEAM_LEADER` - these are the *only* three roles that can
see this page (`REPORTS_VIEW_ROLES`, notably narrower than every other module: no
`ACCOUNTANT`/`FINANCE_MANAGER` this time). Click **Reports & Dashboards** in the sidebar.

**b. If you're signed in as anyone else** (a technician, `CCE`, `ACCOUNTANT`,
`FINANCE_MANAGER`): you'll see a plain restricted-access message and nothing else - no
data ever loads and no connection is ever attempted, by design (the-fool pre-mortem
finding #5). Worth deliberately testing once: sign in as an Accountant and confirm this
page shows the restricted message instead of an error or a blank screen.

**c. The connection pill** (top right): watch it go `Connecting…` → `Live` within a
couple of seconds of the page loading, with a small timestamp underneath reading "as of
HH:MM:SS" - that timestamp is the backend's own snapshot time, not just "when your browser
last repainted." If you ever see `Reconnecting…` or `Offline - live updates paused`, that's
a real, visible signal something's wrong with the live channel - it's deliberately built to
never look like a quiet moment (the-fool finding #2).

**d. The Kanban board**: 8 columns - Scheduled, On-Site, WIP, Spare Pending, Approval
Pending, QC Completed, Out for Delivery, Delivered. Two documented simplifications worth
knowing about, not bugs: a cancelled Job Card never appears on this board at all (still
findable via normal Job Card search), and a job sitting at "Ready for QC" shows up under
WIP rather than its own column (the BRD's column list has no separate bucket for it). Each
card shows the Job Card number, serial + brand, its warranty badge, the delivery number if
one's been assigned, and when it last updated. On first paint (before the socket's own
snapshot has arrived) you may briefly see just counts with no cards inside each column -
that's the overview endpoint's placeholder data, and it's replaced by the real cards within
a second or two once the socket connects.

**e. Pending Approval Aging**: OOW estimates sent to the customer with no response yet,
oldest-waiting first, with anything past 4 hours highlighted in red and a "N past
threshold" summary line when at least one is breached. Shows "Waiting for the live feed…"
for a moment on first load, same as the Kanban board's placeholder-to-live transition.

**f. Service Efficiency / First-Time Fix Rate**: these two are visually distinct "Report"
cards, not "Live" ones - deliberately, since the backend's gateway never pushes updates for
them (the-fool finding #4). Each shows a "No completed jobs yet" zero-state if nothing
qualifies yet, otherwise its own numbers plus its own "as of" timestamp captured at the
moment it was fetched. Click either card's **Refresh** button and confirm its timestamp
updates and the button briefly reads "Refreshing…" - this is a manual pull, not something
that happens automatically in the background.

**g. What "live" actually means here** (read this before reporting a lag as a bug): the
Kanban board is driven by a 5-second server-side poll that only broadcasts when something
actually changed - so a status change can take up to ~5 seconds to appear, not
instantaneously. Approval Aging refreshes every 15 minutes on its own broadcast schedule
(matching BRD 18.1). This is a documented, deliberate simplification of FR-20's literal
"push from every status-changing method" spec (see `reports.gateway.ts`'s own doc comment)
- genuinely real-time push would mean touching six already-shipped backend modules, which
wasn't done as part of this phase. To see it in action: open `/reports` in one tab, advance
any Job Card's status in another tab (e.g. via Appointments/Job Cards), and watch the
Kanban board update within about 5 seconds without a page refresh.

**h. Token refresh on reconnect** (optional, advanced): this page is built to survive a
server-initiated disconnect (e.g. your access token expiring mid-session, 15-minute
lifetime) by silently refreshing the token and reconnecting - you shouldn't normally need
to do anything. If you want to see it happen, leave `/reports` open and idle for over 15
minutes; the pill should briefly show `Reconnecting…` and then return to `Live` on its own,
without a page refresh or a forced sign-out.

**i. What to report back**: same as Phases 1-11 - anything confusing, broken, or where the
board looks wrong given what you know is actually in the system (check
`docs/planning/STATUS_TRACKER.md`'s Frontend Phase 12 section if unsure, especially the
two documented column simplifications in (d) above before assuming a missing/misplaced
card is a bug). `verify-phase12.ps1` has already run clean against the real backend
(36/36 checks passed, 0 failed - RBAC, all 6 endpoint shapes, and every internal-
consistency check), so this section is about the manual WebSocket check in (c)/(g) above -
that's the one thing this phase's live run doesn't cover, since it can't be driven from
PowerShell.

---

## 30. Warranty Claims — Vendor Claims & Credit Notes (Phase 12, post-MVP, BRD Workflow 12)

Numbered 30 rather than slotted in after Section 17 to avoid renumbering every "Section
18/19/20..." cross-reference already scattered through this guide's frontend sections
below — this phase was built after all 12 frontend phases, not before. It's a
**backend-only** module (no frontend screen exists for it yet), so this section is
Swagger/API-driven like Sections 15-17, not a click-through walkthrough.

BRD Workflow 12, explicitly marked `[Optional]`: groups warranty spares actually used
(`InventoryReservation.status = CONSUMED`, set at QC approval) by vendor and time period
into a claim, tracks it through submission to the vendor's own portal and the vendor's
credit note, and posts the recovery to the GL.

### 30a. Get some CONSUMED warranty spares to claim against

Warranty Claims aggregates real consumption, so you need at least one Job Card that's
IN_WARRANTY with a `warrantySupplier` and has had a spare part QC-approved (`CONSUMED`)
against it. Two ways to get there:

- **Easiest**: run `scripts/warranty-claims-e2e-test.ps1` (Section 30g) — it seeds a full
  pipeline (a `WarrantyMaster` entry, an appointment, a field visit with a
  warranty-matched serial number, a Job Card, a Workshop reservation, and QC approval) for
  two vendors on its own, then exercises every endpoint below against real data.
- **Manually**: create a `WarrantyMaster` row (`POST /master-data/warranty-master`) whose
  `serialNumberRange` covers a serial you'll use, then follow Sections 6-8/10/12 to run a
  Job Card through Technician capture → Workshop reservation → QC approval with that
  serial number. The Job Card's `warrantyStatus` will come back `IN_WARRANTY` and its
  `warrantySupplier` will be snapshotted from the matched `WarrantyMaster` row at creation.

### 30b. Aggregate a claim (step 12.1) — Warranty Clerk/Service Head/Super Admin

```
POST /warranty-claims/aggregate
{
  "supplier": "Samsung Gulf FZE",
  "periodStart": "2026-08-01",
  "periodEnd": "2026-08-31"
}
```

Finds every `CONSUMED` reservation on an `IN_WARRANTY` Job Card whose `warrantySupplier`
matches exactly, `consumedAt` inside the period, and not already referenced by any other
claim line (live or cancelled) — groups them into a new `DRAFT` claim numbered `WC-####`.
400 if `periodStart` is after `periodEnd`, or if nothing unclaimed matches. Runs inside one
transaction serialized per-supplier (a Postgres advisory lock), so calling this twice for
the same vendor/period back-to-back will correctly find nothing left the second time —
that's double-claim prevention working, not a bug.

### 30c. Look around

```
GET /warranty-claims                    (?supplier=, ?status= filters)
GET /warranty-claims/:id                (includes the full lines array)
GET /warranty-claims/recovery-rate      (?supplier= optional — BRD 12.5)
```
All five roles can read (`WARRANTY_CLERK`/`ACCOUNTANT`/`FINANCE_MANAGER`/`SERVICE_HEAD`/
`SUPER_ADMIN`) — matches Discovery's own role table for this workflow, wider than the
write-side roles below. `recovery-rate`'s `rate` is `null` only when nothing's been
claimed for that vendor at all; a claim that's `SUBMITTED` but has no credit note yet
correctly shows `rate: 0`, not `null`.

### 30d. Submit (step 12.3) — Warranty Clerk/Service Head/Super Admin

```
POST /warranty-claims/:id/submit
{ "claimReferenceNumber": "VENDOR-CLM-2026-0912", "notes": "Invoices attached in vendor portal" }
```
Requires `DRAFT`. No real vendor-portal integration exists (same documented stub pattern
as Notifications) — this just records that a Warranty Clerk uploaded it externally and
flips status to `SUBMITTED`.

### 30e. Cancel a mistaken DRAFT claim

```
POST /warranty-claims/:id/cancel
{ "reason": "Wrong period selected - re-aggregating with the correct dates" }
```
Only while `DRAFT` — once `SUBMITTED`, it's out in the vendor's own portal and this app
has no authority to unilaterally cancel it (400). Cancelling deletes the claim's lines (the
claim itself stays as an audit record, flipped to `CANCELLED`), so their reservations
become claimable again the next time you `aggregate()` that vendor/period — worth trying
this yourself: aggregate, cancel, re-aggregate the same supplier/period, and watch the
same spares come back into a fresh claim.

### 30f. Record the vendor's credit note (step 12.4) — Accountant/Finance Manager/Super Admin

```
POST /warranty-claims/:id/credit-note
{ "creditNoteNumber": "CN-2026-4471", "creditNoteAmount": 450.00 }
```
Requires `SUBMITTED`. The amount may be less than `totalClaimedAmount` (a partial
recovery — the vendor disputed one line, say). On success: status → `CREDIT_RECEIVED`, and
a `WARRANTY_CLAIM_CREDIT` entry appears in
`GET /gl-postings?sourceType=WARRANTY_CLAIM_CREDIT` (Debit `2000-VENDOR-PAYABLE` / Credit
`4020-WARRANTY-RECOVERY` per the BRD's own literal wording, same simplified two-line-entry
pattern every other GL posting in this app uses).

### 30g. Prove the guardrails work / live-verify

- Try `aggregate` as a field technician or an Accountant → 403 (neither is a clerk role).
- Try `credit-note` as a Warranty Clerk → 403 (not a credit-note role).
- Try listing claims with no token → 401.
- Try `aggregate` twice for the same vendor/period → the second call 400s, nothing left
  unclaimed.
- Try `cancel` on a `SUBMITTED` claim → 400.
- Try `credit-note` twice on the same claim → 400.
- **Live-verified via `scripts/warranty-claims-e2e-test.ps1`: 70/70 checks passed, zero
  failures.** Drives the full pipeline (see 30a), exercises every check above against a
  real running server plus the partial-recovery credit note and its GL posting, and checks
  `recovery-rate` across a credited vendor (90%), a submitted-but-uncredited vendor (0%,
  not `null`), and a vendor with nothing claimed at all (`null`). Took four live runs to
  get there: run 1 caught a real backend bug (`aggregate()`/`recordCreditNote()` reading
  their own just-written row through a different DB connection than the transaction that
  wrote it — fixed by re-fetching through the transaction's own `manager`, see
  STATUS_TRACKER.md's Phase 12 section for the full write-up) plus a cosmetic script-only
  false positive (`"IN_WARRANTY"` vs. the enum's real `"IW"` value); runs 2-3 fixed the
  script's own test-data isolation (a fixed literal `serialNumberRange` was colliding with
  earlier runs' leftover `WarrantyMaster` rows in this never-reset dev DB). Unit tests: 23
  new, 515/515 passing app-wide.

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

Everything through **Phase 12** (Auth, Master Data, Appointments, Technician Mobile API,
Job Cards, Estimates + Notifications, Workshop + Inventory, QC gate + Permissions, Delivery
+ POD + OOW invoicing block, Finance extension + Customer Portal, AMC Management,
Dismantling, Reports/Dashboards, Warranty Claims) is real, working code you can exercise
exactly as above — all 147 endpoints in Section 11 are live, plus the `/reports` WebSocket
channel (Section 17e). Your full post-MVP sequencing (AMC → Dismantling →
Reports/Dashboards → Warranty Claims) is complete; BRD 18.2/18.3/18.4 (Finance/Quality/
Operational dashboards) remain unbuilt and explicitly out of scope for now (see Section
17's intro). **Phase 12 (Warranty Claims, Section 30) is unit-tested and live-verified
against your machine — 70/70 checks passed** via `scripts/warranty-claims-e2e-test.ps1`.

The React frontend (Sections 18–29) now exists at `http://localhost:5173` and covers
sign-in/sign-out, all 9 Master Data sub-modules, Appointment Scheduling + the
technician's Field View (Section 20), Job Cards + Warranty Override (Section 21),
Estimates + the public customer approval link (Section 22), Workshop + Inventory
(Section 23), QC + Permissions admin (Section 24), Delivery + Invoicing (Section 25),
Finance + Customer Portal (Section 26), AMC Management (Section 27), Dismantling
(Section 28), and Reports/Dashboards (Section 29) - all 12 frontend phases are now built,
and all are test-covered (266/266 automated frontend tests as of Section 29, run isolated
ahead of each device merge, 38 test files). Sections 18-29 are all live-verified against
the real backend (Section 26's `verify-phase9.ps1` run: 143/143 checks passed, 0 failed;
Section 27's `verify-phase10.ps1` run: 66/66 checks passed, 0 failed; Section 28's
`verify-phase11.ps1` run: 51/51 checks passed, 0 failed; Section 29's `verify-phase12.ps1`
run: 36/36 checks passed, 0 failed) - the entire frontend build is now complete and
live-verified, aside from Section 29's one manual WebSocket spot-check (PowerShell can't
drive Socket.io's handshake). Everything else in the app still only has a Swagger-based
way to test it
until its own frontend phase ships. Starting with Section 22's phase, the frontend also
has its own automated test suite (Vitest + React Testing Library, `npm test` in
`frontend/`) - Phases 1-4 predate this and are covered only by the manual walkthroughs
above.

One known, deliberate gap to be aware of while testing:
- **Notifications** (WhatsApp/SMS/Email) only *attempt* sends right now — no real provider
  is wired up (Section 9b) — so the record-response phone/call path (9d) is the actually
  usable way to move an Estimate forward today.

Spare-part consumption is no longer a gap — Section 12 covers the QC-approval step that
permanently deducts a spare from `quantityOnHand` (Main Store → Damage Location) once a
job passes QC.

`docs/planning/STATUS_TRACKER.md` always reflects current status — check there first if
you're unsure what's ready.
