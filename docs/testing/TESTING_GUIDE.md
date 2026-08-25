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

## 11. Full endpoint index (82 endpoints, all documented above)

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

### job-cards (8)
| Endpoint | Section |
|---|---|
| `POST /job-cards` | 8a |
| `POST /job-cards/:id/validate-sn` | 8b |
| `POST /job-cards/:id/assign-section` | 8c |
| `POST /job-cards/:id/approve-customer` | 8d |
| `POST /job-cards/:id/warranty-override` | 8e |
| `POST /job-cards/:id/cancel` | 8h |
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
| `GET /inventory/stock/:sparePartId` | 10b |
| `GET /inventory/reservations/stale` | 10h |
| `POST /inventory/reservations/:id/review` | 10g |
| `POST /inventory/reservations/:id/request-return` | 10g |
| `POST /inventory/reservations/:id/confirm-return` | 10g |

### workshop (5)
| Endpoint | Section |
|---|---|
| `POST /workshop/:jobCardId/assign` | 10d |
| `POST /workshop/:jobCardId/start-wip` | 10d |
| `POST /workshop/:jobCardId/request-spare` | 10e |
| `POST /workshop/:jobCardId/complete` | 10e |
| `GET /workshop/:jobCardId` | 10h |

**Total: 82 endpoints, all documented above.** (7 auth + 29 master-data + 14 appointments + 5 technician + 8 job-cards + 8 estimates + 6 inventory + 5 workshop.)

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

Everything through **Phase 5** (Auth, Master Data, Appointments, Technician Mobile API, Job
Cards, Estimates + Notifications, Workshop + Inventory) is real, working code you can
exercise exactly as above — all 82 endpoints in Section 11 are live. Phases 6–8 (QC +
Inventory auto-deduct, Delivery, Finance, Customer Portal) aren't built yet — their Swagger
sections don't exist until we build them, so there's nothing to click there yet.

Two known, deliberate gaps to be aware of while testing:
- **Notifications** (WhatsApp/SMS/Email) only *attempt* sends right now — no real provider
  is wired up (Section 9b) — so the record-response phone/call path (9d) is the actually
  usable way to move an Estimate forward today.
- **Spare-part consumption**: nothing yet permanently deducts a spare from `quantityOnHand`
  when a job finishes normally (Section 10i) — only a confirmed physical return adds stock
  back. This is exactly what Phase 6 builds first (see below).

`docs/planning/STATUS_TRACKER.md` always reflects current status — check there first if
you're unsure what's ready.
