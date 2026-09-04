# Jacky's Field Technician (Mobile App v1)

React Native (Expo) app for field technicians - the mobile counterpart to
[Jacky's Service Portal](../README.md). Scoped in `docs/planning/MOBILE_APP_SCOPE_v1.md`,
stress-tested in a the-fool pre-mortem before this build started (same doc, §9).

## What this is (v1 scope)

Field Technicians only - not a mobile version of the staff console. Built directly
against the existing, already-tested `src/technician` API (`TechnicianController`);
the web app's `FieldVisitsPage.tsx` is a working reference implementation of the same
flow. See the scope doc for the full phased build order.

- **Phase 1 (this phase):** app skeleton, JWT login (same credentials/backend as web),
  Today's Schedule (read-only).
- **Phase 2-5:** Start Visit + GPS, Serial Number + Fault/Symptom capture, an offline
  action queue, then Need Spare + Complete/QC-handoff. Not built yet.

## Running it

```bash
npm install
cp .env.example .env   # then edit EXPO_PUBLIC_API_BASE_URL to your backend's LAN IP
npm start
```

`localhost` in the default config only works from a browser/simulator on the *same*
machine as the backend - a real phone or most Android emulators need your machine's
actual LAN address (see `.env.example`). The backend itself is the same NestJS API the
web app talks to; nothing mobile-specific runs on the server for Phase 1.

Sign in with any `TECHNICIAN_FIELD` account (or `SUPER_ADMIN`/`SERVICE_HEAD`/
`TECHNICAL_TEAM_LEADER`, who can also act on a technician's behalf per
`TechnicianController`'s existing role gate).

## Testing Phase 1 end-to-end (backend + a real phone or emulator)

This walks through everything needed to see Phase 1 (login + Today's Schedule) working
live - not just `npm test`. You'll need three things running at once: the backend, the
Expo dev server, and either a phone with Expo Go or an emulator. Keep two (or three)
terminal windows open.

**1. Start the backend** (repo root, first terminal)

```bash
cd "D:\Jackys\jackys service portal"
npm run start:dev
```

Wait for the `🚀 Application running on: http://localhost:3000` and
`📚 Swagger docs: http://localhost:3000/api/docs` banner lines. Leave this window open
- closing it or Ctrl+C stops the backend. It auto-restarts on file changes, so you don't
need to repeat this step unless you closed the window. Full details:
`docs/testing/TESTING_GUIDE.md` §0f/§0g.

**2. Create a technician test account** (second terminal, backend still running)

```bash
cd "D:\Jackys\jackys service portal"
npm run seed:technician
```

This prints an email, password, and user id for a `TECHNICIAN_FIELD` account - copy all
three. (There's no sign-up UI; this seed script is the only way to get a mobile login.
Override the defaults with `$env:SEED_TECH_EMAIL` / `$env:SEED_TECH_PASSWORD` if you
want.) Full details: `docs/testing/TESTING_GUIDE.md` §4.

**3. Create an appointment and assign it to that technician** (same terminal, via
Swagger in your browser)

Open `http://localhost:3000/api/docs`, then:

- `POST /appointments` - create one with a `scheduledAt` of today (or the next couple of
  days), and copy the returned `id`. Body needs `type`, `customerType`, `customerName`,
  `customerPhone`, `scheduledAt`, `serviceCentreId`, `brand`, `modelNumber` (see
  `docs/testing/TESTING_GUIDE.md` §5a for a ready-to-paste example body). **Leave
  `technicianId` out of this body**, even though Swagger's "Try it out" auto-fills it as
  part of the full example schema - setting it here does NOT move the appointment out of
  `SCHEDULED` status (only the next step does), and Start Visit will reject a
  `SCHEDULED` appointment with "Can only mark on-site for confirmed/assigned
  appointments." Delete that field from the body, or leave it blank, before executing.
- `PUT /appointments/{id}/assign-technician` - body `{ "technicianId": "<user id from
  step 2>" }`. This is the step that actually moves status to `TECHNICIAN_ASSIGNED` and
  makes the appointment show up in `GET /technician/schedule`, which is what the mobile
  app's Today's Schedule screen calls, AND what Start Visit requires - skipping it means
  either an empty schedule or a rejected Start Visit. Full details:
  `docs/testing/TESTING_GUIDE.md` §5b.
- Already created one with `technicianId` in the body by mistake? No need to start over
  - just run this step now; it fixes the status in place.

**4. Find your machine's LAN IP address** (Windows, any terminal)

```bash
ipconfig
```

Look for the `IPv4 Address` under your active adapter (usually "Wireless LAN adapter
Wi-Fi") - something like `192.168.1.50`. This is what a phone or emulator uses to reach
your backend; `localhost` in the mobile app would otherwise mean "the phone itself,"
which has no backend running on it.

**5. Configure and start the mobile app** (third terminal, or reuse the Swagger one -
the backend keeps running regardless)

```bash
cd "D:\Jackys\jackys service portal\mobile"
npm install
cp .env.example .env
```

Edit `.env` and set:

```
EXPO_PUBLIC_API_BASE_URL=http://<your LAN IP from step 4>:3000/api/v1
```

Then start Metro:

```bash
npm start
```

This opens the Expo dev server and prints a QR code in the terminal.

**6. Load the app**

Pick whichever you have available:

- **Real phone (fastest to set up):** install the free "Expo Go" app from the App
  Store or Google Play, make sure the phone is on the **same Wi-Fi network** as your PC,
  then scan the QR code from step 5 (Expo Go's built-in scanner on Android, or the
  Camera app on iOS). If it can't connect, Windows Firewall is the usual culprit - it
  may need to allow Node.js to accept connections on your private network the first
  time you're prompted, and some Wi-Fi networks (guest networks, some public/office
  networks) block phone-to-PC traffic entirely ("client isolation") - a home network or
  mobile hotspot avoids that.
- **Android emulator:** with Android Studio installed and an emulator already created,
  press `a` in the Expo terminal.
  **iOS simulator (Mac only):** with Xcode installed, press `i` in the Expo terminal.

The app should load to the login screen.

**7. Sign in and verify**

Sign in with the email/password from step 2. You should land on Today's Schedule and
see the appointment you created and assigned in step 3. Check:

- The appointment card shows the right customer name/time.
- The `‹`/`›` date arrows move the header date and reload the list (an appointment
  scheduled for today won't appear if you navigate to another day - that's correct
  behavior, not a bug).
- Pull down to refresh re-fetches from the backend.
- The logout button returns you to the login screen, and closing/reopening the app
  before logging out keeps you signed in (session persistence via `expo-secure-store`).

**8. Stopping everything**

Ctrl+C in the Expo terminal stops Metro; Ctrl+C in the backend terminal stops the
backend. Both are safe to stop and restart independently.

## Automated tests only (no backend/phone needed)

```bash
npm test        # jest + jest-expo + @testing-library/react-native
npm run typecheck
```

Auth (session restore, login, logout, 401 handling) and the schedule screen (sorting,
empty/error states, date navigation) have unit/component test coverage. These don't
need the backend, a phone, or an emulator - they mock the API layer.

## Project layout

```
src/
  app/                 expo-router screens (file-based routing)
    _layout.tsx         root layout: QueryClientProvider + AuthProvider + auth gate
    login.tsx            unauthenticated screen
    index.tsx             Today's Schedule - the authenticated home screen
  __tests__/
    app/                 tests for src/app/* screens (see note below - NOT inside src/app/)
  context/
    AuthContext.tsx      session state (mirrors the web app's src/lib/auth.tsx)
    AuthContext.test.tsx
  lib/
    api.ts                axios instance + 401-refresh interceptor (mirrors web's src/lib/api.ts)
    tokenStorage.ts       expo-secure-store wrapper (Keychain/Keystore, not AsyncStorage)
    technicianApi.ts      one function per backend route actually called
    types.ts               shapes mirrored from the backend's real DTOs/entities
    config.ts               API_BASE_URL
```

Auth and API client code deliberately mirror the web app's `src/lib/auth.tsx` /
`src/lib/api.ts` file-for-file where the platform allows it (SecureStore is async where
localStorage isn't - that's the one real difference) - anyone who has worked on the web
app already knows how this half of the mobile app works.

**Important: never put a `*.test.tsx` file directly inside `src/app/`.** expo-router
scans that folder recursively to build the route table, and it only excludes
`+api`/`+html`/`+native-intent` files - not test files. A test file left in `src/app/`
gets bundled into the real app and breaks Android/iOS bundling (it imports
`@testing-library/react-native`, which needs Node's `console` module - not available in
the native runtime). This is why `src/app/`'s screen tests live in `src/__tests__/app/`
instead, one directory outside the router's scan root - keep any new screen tests there
too.

See `AGENTS.md` before making SDK-version-sensitive changes (navigation, secure
storage, etc.) - Expo's APIs move fast enough that training-data assumptions about
them are often stale; check the versioned docs for the SDK version pinned in
`package.json`.
