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

## Project layout

```
src/
  app/                 expo-router screens (file-based routing)
    _layout.tsx         root layout: QueryClientProvider + AuthProvider + auth gate
    login.tsx            unauthenticated screen
    index.tsx             Today's Schedule - the authenticated home screen
  context/
    AuthContext.tsx      session state (mirrors the web app's src/lib/auth.tsx)
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

## Testing

```bash
npm test        # jest + jest-expo + @testing-library/react-native
npm run typecheck
```

Auth (session restore, login, logout, 401 handling) and the schedule screen (sorting,
empty/error states, date navigation) have unit/component test coverage. See
`AGENTS.md` before making SDK-version-sensitive changes (navigation, secure storage,
etc.) - Expo's APIs move fast enough that training-data assumptions about them are
often stale; check the versioned docs for the SDK version pinned in `package.json`.
