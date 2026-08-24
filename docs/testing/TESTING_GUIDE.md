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
  "modelNumber": "WA80J5710"
}
```
Use a `scheduledAt` date that's today or in the near future (any day except the one you set `isOpen: false` for — Sunday, above). Copy the appointment's `id` from the response.

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

Everything through **Phase 2** (Auth, Master Data, Appointments, Technician Mobile API) is real, working code you can exercise exactly as above. Phases 3–8 (Job Cards, Estimates, Workshop, Inventory, Delivery, Finance, Customer Portal) aren't built yet — their Swagger sections don't exist until we build them, so there's nothing to click there yet. `docs/planning/STATUS_TRACKER.md` always reflects current status — check there first if you're unsure what's ready.
