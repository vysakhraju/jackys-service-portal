# Jacky's Service Portal — Mobile App Scoping (v1)

**Version:** 1.0
**Date:** 2026-09-03
**Framework:** React Native (decided this session)
**Scope of this doc:** Field Technician mobile app only — planning/scoping, no code written yet.

---

## 1. Decisions locked this session

| Question | Decision |
|---|---|
| Framework | React Native |
| v1 audience | **Field Technicians only.** Drivers and Workshop Technicians are explicitly out of v1 (see §6). |
| Platforms | iOS + Android together from day one (one RN codebase) |
| Offline mode (NFR-03) | **Built into v1**, not deferred — queue actions locally, sync on reconnect, last-write-wins + audit |
| Push notifications | Deferred to v1.1 — pull-to-refresh in v1 |

---

## 2. Why this isn't a from-scratch backend effort

`src/technician/` already exists, is fully unit-tested, and is gated to `TECHNICIAN_FIELD` (plus supervisory roles who can act on a technician's behalf): `TechnicianController` exposes 5 endpoints — start a visit, capture serial number + warranty check, capture fault/symptom codes, get one visit, and get the calling technician's own schedule.

The web app's `FieldVisitsPage.tsx` is an explicit, source-commented stand-in for the mobile app: it calls these exact same REST endpoints — "the same call the real mobile flow would use." That page is effectively a working reference implementation of the v1 flow's happy path, already proven against the real backend.

**Bottom line:** the mobile app is primarily a native-client-plus-offline-layer effort over an already-built, already-tested API, not a new backend built from zero.

---

## 3. V1 feature set that maps cleanly to what exists today

1. **Today's Schedule** — `GET /technician/schedule` (defaults to today, `?date=` optional)
2. **Start Visit** — `POST /technician/visits/:appointmentId/start`, captures GPS + timestamp (FR-02)
3. **Capture Serial Number + Warranty Check** — `POST /technician/visits/:appointmentId/serial-number`, returns IW/OOW badge (FR-03)
4. **Capture Fault + Symptom Codes** — `POST /technician/visits/:appointmentId/fault-symptom`, gated on a captured S/N (FR-04)
5. **View visit status** — `GET /technician/visits/:appointmentId`

These four screens can be built directly against the existing API with no backend changes, the same way `FieldVisitsPage.tsx` already does on web.

---

## 4. Gap found this session: the BRD's "4-button" vision needs 2 backend pieces that don't exist yet

The BRD describes the field technician flow as a 4-button workflow: **Start / Need Spare / Complete / QC**. Item 3 above (Start) and the diagnostic capture steps map to what's built. The other two buttons don't have a technician-facing endpoint today:

- **Need Spare.** Spare part reservations are created by `WorkshopService` calling `InventoryService.reserve()` — a workshop-side action. There is no endpoint today that lets a field technician request a spare directly from an on-site visit. Building this button means adding a new technician-facing endpoint (or exposing `reserve()` through a technician-appropriate gate), not just a client screen.
- **Complete / QC handoff.** Job completion and QC approve/reject live in the Job Cards and QC modules, gated to `QC_OFFICER` behind the `QC_APPROVAL` grant (the dynamic permission system from Phase 6). A field technician isn't meant to perform QC — realistically their "Complete" button means "my on-site work is done, hand this off," which needs its own small endpoint rather than reusing the QC-gated ones as-is.

Neither gap is a blocker — both are normal, boundable backend work — but they mean v1 isn't purely a client-side build. Recommend building these two endpoints in Phase 5 (see §7), once the core capture flow (which needs no backend work at all) is proven on-device.

---

## 5. Offline mode approach (NFR-03)

Since offline was chosen for v1 rather than deferred, this is the single largest technical unknown in the plan and deserves being named as such rather than waved through.

- **What needs to queue:** the write actions only — start visit, capture S/N, capture fault/symptom (plus Need Spare / Complete once §4's endpoints exist). Reads (schedule, visit status) don't need offline write-queueing, just a local cache for display.
- **Approach:** local persistence on-device (a lightweight action queue is enough for this bounded action set — doesn't need a full offline-first database like WatermelonDB unless the app's scope grows well past these 4-5 actions). Each queued action gets a client-generated idempotency key and a client timestamp at the moment it's taken, so a retried sync never double-submits and "last write wins" has an actual timestamp to compare against.
- **Sync on reconnect:** replay the queue in order against the same endpoints listed in §3. The backend's existing `AuditInterceptor`/`@Audit` decorator already logs who/when for every one of these actions server-side, satisfying NFR-03's "+ audit" requirement without new backend work — the client only needs to send the action with its client timestamp attached.
- **Conflict rule:** last-write-wins, per NFR-03 exactly as specified — no new conflict-resolution UI is implied by the BRD, just picking the request whose client timestamp is newer when a stale queued action collides with a newer server state.
- **Recommendation:** run a short offline-queue spike (a few days, one action end-to-end: queue → app killed/reopened → reconnect → sync) before committing engineering time to the full four-screen build, so the offline mechanism is proven on real devices with real network drops before it's relied on everywhere.

---

## 6. Explicitly out of scope for v1

- **Driver mobile app.** BRD marks Logistics Dispatcher/Driver as "Web + Mobile" — they already have a working path today through the Delivery & Invoicing web module. The delivery module's dispatch/POD-capture/cancel endpoints are already built and tested, so adding a driver mobile client later is a comparatively cheap fast-follow once the technician app has shipped.
- **Workshop Technician.** The BRD's role table groups "Technician (Field/Workshop)" together under "Mobile App," but Workshop Technicians work at a fixed bench, not on-site with GPS — nothing in the existing API models a workshop-technician mobile flow the way `technician/visits/*` models the field visit. Treating this as an assumption worth a quick confirmation from you rather than a fully settled decision (see §8).
- **Push notifications** — pull-to-refresh instead, per the decision above.
- Any admin/back-office feature. This is a single-purpose field app, not a mobile version of the staff console.

---

## 7. Suggested phased build order

1. **RN app skeleton + auth.** Reuse the existing JWT login (same credentials/endpoint as web); Today's Schedule screen, read-only.
2. **Start Visit + GPS capture**, built online-only first — de-risks the UI and the GPS/permissions handling before the offline layer is added on top of it.
3. **Serial number + warranty capture, Fault/Symptom capture** — same online-first approach.
4. **Offline queue layer**, retrofitted onto the actions from phases 2-3 (spike first, per §5).
5. **Need Spare + Complete/QC-handoff** — new backend endpoints (§4) built alongside their client screens.

## 8. Open questions before backend work starts on this

- Confirm Workshop Technician is genuinely out of v1 — bench-based work, not field/GPS-based, so it doesn't fit this app's shape even though the BRD's role table lists it alongside Field Technician.
- For **Need Spare**: should a field technician's request go straight to a reservation (like the existing workshop flow), or should it require Team Leader review first the way idle/stale reservations already do?
- For **Complete**: what should actually happen server-side when a field technician taps it — is it enough to just mark the visit's on-site work done and hand the Job Card to the next stage, or does it need to carry anything else (photos, notes)?
