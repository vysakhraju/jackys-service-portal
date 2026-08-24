# Testing Guide — Try It Yourself

**For:** someone new to NestJS/PostgreSQL/JWT who wants to click through the API and see it actually work, with no UI yet.
**What you're using:** Swagger — an auto-generated web page that lists every API endpoint and lets you send real requests to your own running server by clicking buttons and filling in forms. It's built into the app; you don't install anything extra.

Everything below runs on **your own machine** against **your own database**. Nothing here talks to the internet. If something doesn't match what you see, that's useful information — tell me exactly what you see and I'll fix it.

---

## 0. Before you start

You only need two things running:

1. **PostgreSQL** — the database. It's installed as a Windows service, so it should already be running. To check:
   ```powershell
   Get-Service postgresql-x64-16
   ```
   Status should say `Running`. If it says `Stopped`:
   ```powershell
   Start-Service postgresql-x64-16
   ```

2. **The app itself.** Open PowerShell and run:
   ```powershell
   cd "D:\Jackys\jackys service portal"
   npm run start:dev
   ```
   Wait until you see:
   ```
   🚀 Application running on: http://localhost:3000
   📚 Swagger docs: http://localhost:3000/api/docs
   ```
   **Leave this window open** — this is your server. Closing it (or pressing Ctrl+C) stops the app. It also auto-restarts itself whenever a file changes, so if I make a code fix while you're testing, just wait a few seconds and try again.

Now open **http://localhost:3000/api/docs** in your browser. This is Swagger. You'll see a list of sections (auth, master-data, appointments, technician, ...) — each one is a group of related endpoints. Click a section name to expand it and see its endpoints.

For every endpoint below, the pattern is always the same:
1. Click the endpoint to expand it.
2. Click the **"Try it out"** button (top right of the expanded box).
3. Edit the example JSON in the body box if needed.
4. Click **"Execute"**.
5. Scroll down slightly — the **Response body** and **Code** (e.g. `200`, `201`, `404`) appear right below.

A **2xx** code (200, 201) means success. A **4xx** code (400, 401, 403, 404, 409) means the request was rejected on purpose, for a specific reason shown in the response — these are just as useful to see as successes, because they prove the safety checks work.

---

## 1. Log in and authorize (do this first, every time)

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

Tokens expire after **15 minutes**. If you start getting `401 Unauthorized` after a break, just repeat this section to log in again.

Try one more thing to prove it worked:
- **`GET /auth/profile`** → Try it out → Execute (no body needed). You should get your own admin user details back, `200`.

### 1a. Change password (optional — careful)

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

- **`POST /auth/seed-roles`** → Try it out → Execute (no body). This creates all 14 roles (Field Technician, CCE, etc.) if they don't already exist. Safe to run more than once — it skips roles that are already there.

You need this done once before creating a technician test user in the next section.

---

## 3. Master Data — set up the building blocks

Everything downstream (appointments, technician visits) needs a service centre, a fault/symptom pair, and a warranty record to point at. Create one of each:

### 3a. Service Centre
**`POST /master-data/service-centres`**
```json
{
  "code": "DXB-TEST",
  "name": "Dubai Test Centre",
  "country": "UAE",
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
Copy the `id` from the response — you'll need it as `serviceCentreId` below. (`maxJobsPerDay: 20` for every open day means you won't hit the capacity limit while testing.)

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

### 3c. Warranty range
**`POST /master-data/warranty-master`**
```json
{
  "serialNumberRange": "SN100000-SN199999",
  "brand": "Samsung",
  "model": "WA80J5710",
  "warrantyPeriodMonths": 24,
  "supplier": "Samsung Gulf"
}
```
This means any serial number that sorts between `SN100000` and `SN199999` counts as **in warranty (IW)**. Anything outside that range is **out of warranty (OOW)**.

You can check this directly right now, before even touching an appointment:
- **`GET /master-data/warranty-master/check/{serialNumber}`** → try `SN150000` (should say `isUnderWarranty: true`) and then `SN999999999` (should say `false`).

---

## 4. Create a technician test account

There's no sign-up page (on purpose — real technician accounts get created by an admin), so use the helper script instead. **Open a second PowerShell window** (don't close the one running the server) and run:
```powershell
cd "D:\Jackys\jackys service portal"
npm run seed:technician
```
This prints a login email/password and a **user id** — copy the user id, you'll need it in the next step to assign appointments to this technician.

(Want a different email/password? `SEED_TECH_EMAIL=you@x.com SEED_TECH_PASSWORD=Pass123! npm run seed:technician` in the same PowerShell window before running it.)

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
  "scheduledAt": "2026-08-25T10:00:00Z",
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
- **`GET /appointments/{id}`** — see the full record.
- **`GET /appointments/dashboard/stats`** — today's/this-week's counts by status.
- **`GET /appointments/technician/{technicianId}/schedule?date=2026-08-25`** — this technician's day.

### 5d. Cancel an appointment (optional — this ends it)

**`PUT /appointments/{id}/cancel`**
```json
{ "reason": "Customer requested reschedule to next week" }
```
Only useful on an appointment you don't need anymore — cancelling is final for that
appointment (status → `CANCELLED`), so create a throwaway one via 5a first if you just want
to see this work rather than cancelling the one you'll use for Sections 6–8 below.
Try it again on the same appointment afterward → expect **`400`** ("Cannot cancel
completed/cancelled appointment").

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

### 8d. Customer approval (only needed for OOW jobs)
**`POST /job-cards/{id}/approve-customer`**
```json
{ "notes": "Customer approved by phone, confirmed in CRM ticket #4521" }
```
Try creating a Job Card from an appointment whose serial number is **outside** the warranty
range from Section 3c (e.g. capture `"SN999999999"` in Section 6b instead of `"SN150000"`)
to get an OOW job, then try 8c on it — you'll get blocked until you call this endpoint.
This is a **temporary manual stand-in** for FR-06 (the real "customer approves via a
shareable link" flow is a later phase, not built yet) — it just records that someone
obtained approval, however they obtained it.

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

## Troubleshooting

| Symptom | What it means | Fix |
|---|---|---|
| Browser can't reach `localhost:3000` | Server isn't running | Check the PowerShell window running `npm run start:dev` is still open and shows no red errors |
| `EADDRINUSE: address already in use :::3000` | Something's already using port 3000 (maybe a previous run you forgot about) | `Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess \| Stop-Process -Force`, then restart `npm run start:dev` |
| `401 Unauthorized` on everything | Not authorized, or your token expired (15 min lifetime) | Repeat Section 1 |
| `403 Forbidden` | You're authorized, but your role/ownership doesn't allow this action | Expected in Section 7's tests; otherwise check you're logged in as the right user |
| `404 Not Found` on a fresh `id` you just created | Typo'd or didn't copy the `id` correctly | Re-copy the `id` from the earlier response |
| `409 Conflict` creating an appointment | Service centre at capacity for that day/time, or the day is marked closed | Use a day with `isOpen: true` and a generous `maxJobsPerDay` (Section 3a already does this) |
| Postgres won't start | Windows service stopped or not installed | `Get-Service postgresql-x64-16` then `Start-Service postgresql-x64-16` |
| Code changes don't seem to apply | `start:dev` restarts automatically on save, but check the PowerShell window for a red compile error after any update I push | Read the error at the top — usually self-explanatory. Tell me what it says. |

**To stop everything:** click into the PowerShell window running the server and press `Ctrl+C`.

---

## What's testable right now vs. not yet

Everything through **Phase 4** (Auth, Master Data, Appointments, Technician Mobile API, Job Cards, Estimates + Notifications) is real, working code you can exercise exactly as above. Phases 5–8 (Workshop, Inventory, Delivery, Finance, Customer Portal) aren't built yet — their Swagger sections don't exist until we build them, so there's nothing to click there yet. Note that Notifications (WhatsApp/SMS/Email) only *attempts* sends right now — no real provider is wired up (a known blocker, see Section 9b) — so the record-response phone/call path (9d) is the actually-usable way to move an Estimate forward today. `docs/planning/STATUS_TRACKER.md` always reflects current status — check there first if you're unsure what's ready.
