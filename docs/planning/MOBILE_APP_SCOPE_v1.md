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

- **Need Spare.** Spare part reservations are created by `WorkshopService` calling `InventoryService.reserve()` — a workshop-side action. There is no endpoint today that lets a field technician request a spare directly from an on-site visit. Building this button means adding a new technician-facing endpoint (or exposing `reserve()` through a technician-appropriate gate), not just a client screen. **Decided 2026-09-03: Need Spare is offline-first, like every other capture action** — the technician taps it in the field (possibly with no signal at all), it's captured and queued on-device immediately, and it's pushed to the server as an actual spare request only once the app reconnects. See §5 and §8.

  **Decided 2026-09-03 (the-fool pre-mortem):** Need Spare is financially/inventory-sensitive
  in a way the other three capture actions aren't, so it does NOT reuse the existing
  `TechnicianController` pattern's "a retry that double-submits is harmless" tolerance. It
  gets its own dedicated endpoint (not a repurposed existing one), and it is the ONE action
  in this app whose idempotency key is actually checked and enforced server-side — a
  retried sync must not create two spare requests. The request is captured with the spare
  part(s) and quantity the technician entered and stored in a new `PENDING_REVIEW`
  reservation state (no stock movement yet, `custodianUserId` = the field technician) —
  distinct from the existing idle/stale-reservation `review()` flow, which decides the fate
  of stock already reserved; this is a pre-reservation approval gate instead. The field
  technician is never blocked on the approval — they carry on and complete their visit at
  the customer's site regardless. Once a Team Leader approves it (online, back at the
  review queue), THAT is when stock actually moves and the financial/inventory records
  update; a rejection simply closes the pending request with no stock ever touched. Start
  Visit / serial-number / fault-symptom capture keep the original tolerant behavior — a
  duplicate resubmission there has no financial or inventory consequence, so no
  idempotency-key enforcement is being added to those three.
- **Complete / QC handoff.** Job completion and QC approve/reject live in the Job Cards and QC modules, gated to `QC_OFFICER` behind the `QC_APPROVAL` grant (the dynamic permission system from Phase 6). A field technician isn't meant to perform QC — realistically their "Complete" button means "my on-site work is done, hand this off," which needs its own small endpoint rather than reusing the QC-gated ones as-is.

Neither gap is a blocker — both are normal, boundable backend work — but they mean v1 isn't purely a client-side build. Recommend building these two endpoints in Phase 5 (see §7), once the core capture flow (which needs no backend work at all) is proven on-device.

---

## 5. Offline mode approach (NFR-03)

Since offline was chosen for v1 rather than deferred, this is the single largest technical unknown in the plan and deserves being named as such rather than waved through.

- **What needs to queue:** the write actions only — start visit, capture S/N, capture fault/symptom, and (confirmed 2026-09-03) **Need Spare** once its endpoint exists — a technician can trigger it fully offline in the field, and it's only pushed to the server as a real spare request once the device reconnects, the same as every other capture action. Complete/QC-handoff likely queues the same way but hasn't been confirmed yet (see §8). Reads (schedule, visit status) don't need offline write-queueing, just a local cache for display.
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

- ~~Confirm Workshop Technician is genuinely out of v1~~ — **confirmed 2026-09-03 (the-fool pre-mortem):** stays out. Bench-based work doesn't fit the field/GPS shape of this app, and keeping the boundary firm also avoids a worse problem found during the pre-mortem — a shared review queue between workshop reservations and field Need Spare requests would confuse Team Leaders about which type of request they're looking at (see §9, finding #4).
- ~~Should Need Spare be queueable offline?~~ — **decided 2026-09-03: yes.** The technician can tap Need Spare with no connectivity at all; it's captured client-side and only pushed to the server as a spare request once the device is back online — the same offline-first pattern as Start/S-N/Fault-Symptom (§5).
- ~~What happens server-side once a queued Need Spare request lands?~~ — **decided 2026-09-03: it routes through Team Leader review first**, the same pattern `InventoryController`'s existing idle/stale-reservation review already uses (`POST /inventory/reservations/:id/review` — TL+ approves reallocation or rejects it), rather than going straight to an immediate auto-reservation like the workshop's own `reserve()` call does today. Refined during the pre-mortem (§9, finding #1): this is a genuinely new `PENDING_REVIEW` state and approval path, not a reuse of the existing idle-reservation `review()` method - see §4.
- ~~For **Complete**: what should actually happen server-side, and does it queue offline?~~ — **decided 2026-09-03 (the-fool pre-mortem):** a status-flip plus optional notes, no mandatory photo capture in v1 - matches how the other capture steps stay lightweight. Queues offline like every other action for consistency (a technician finishing in a dead zone shouldn't be blocked). The QC notification is an in-app/pull-refresh signal once synced, not a promised immediate push - push notifications are already deferred to v1.1 app-wide, so Complete doesn't need special-cased connectivity-required behavior to work around that.
- ~~What should the offline sync engine do when a queued item fails to replay for a reason unrelated to reassignment?~~ — **decided 2026-09-04:** surface a plain-language error and let the technician decide (dismiss or retry) rather than retrying forever silently or auto-flagging a supervisor - keeps a human in the loop on real data (e.g. "this appointment was cancelled while you were offline") instead of either losing it silently or building a new supervisor-facing review surface that doesn't exist yet. See §9, finding #3, and the Phase 4 build notes in `docs/planning/STATUS_TRACKER.md`.
- **New, found during the pre-mortem, not yet resolved:** GPS/location handling when a fix can't be acquired (poor signal, denied permission) - does Start Visit block, or degrade to a best-effort/null location? Needs an answer before Phase 2 (Start Visit) is built - see §9, finding #5. Also worth planning around: iOS App Store review specifically scrutinizes location-permission justification and can add real schedule risk to a plan that assumes iOS+Android ship together.

---

## 9. the-fool pre-mortem (2026-09-03) and its resolutions

Run before any code was written, given this is the largest remaining piece of unbuilt scope,
carries real GPS/location data, and its offline-sync mechanism (idempotency + last-write-wins)
is genuinely novel for this codebase. Five failure modes were raised; two were resolved
immediately by your calls (folded into §4 and §8 above), one produced a new cross-cutting
guardrail on top of already-shipped code, and two remain open design questions to settle
during the relevant build phase rather than blocking the plan now.

1. **Idempotency was a client-side promise the server never enforced.** Resolved - scoped
   down to just the Need Spare endpoint (§4), since that's the one action with real
   financial/inventory consequences; the other three capture actions keep their original
   "a retry that overwrites is fine" tolerance, by your explicit call.
2. **Last-write-wins trusts a client clock nobody controls.** Not separately resolved, but
   substantially de-risked as a side effect of #1: the one action with real financial/stock
   weight (Need Spare) no longer depends on client-timestamp ordering at all, since nothing
   financial happens until an online Team Leader approves it. Clock skew now only affects
   which version of non-financial capture data (S/N, fault/symptom notes) ends up displayed
   - low stakes, no action taken.
3. **A single stuck queue item could silently jam a technician's whole backlog.** Partially
   resolved: **a new guardrail is now locked in** - reassigning the technician on an
   Appointment (`AppointmentsService.update()`, the same endpoint the existing web UI already
   uses) must be blocked while that Appointment's Job Card has any active spare-parts
   reservation (`HELD`, `PARTIALLY_RESERVED`, or the new `PENDING_REVIEW`) held in that
   technician's custody. A job can only be reassigned once it holds no spares - and if a
   genuine reassignment is needed, the real-world process is that customer care hears from
   the current technician first, and the whole job moves to the new technician rather than a
   partial handoff. This applies to in-house/workshop technicians too, not just field techs
   (workshop-side already can't be reassigned once `WORKSHOP_ASSIGNED` today - confirmed by
   reading `JobCardsService.assignWorkshopTechnician()` - so this guardrail is new surface
   area only for the Appointment-level field-technician reassignment path). This needs
   implementing in `AppointmentsService.update()` as part of Phase 5 (Need Spare), since
   there's no way for a field-technician-held reservation to exist before then. Still open:
   what the sync engine does when a queued item fails to replay for an UNRELATED reason
   (e.g. the appointment was cancelled while offline) - see §8.
4. **Need Spare's Team Leader review routing could make the "faster" path slower than
   today's workshop-only flow**, since push notifications are deferred to v1.1 and nothing
   proactively alerts a TL that a time-sensitive field request just landed. Not resolved -
   noted as an operational risk to watch once this ships, not a design flaw to fix now.
5. **GPS/permission handling isn't addressed in the plan** (poor signal, denied permission,
   iOS App Store review scrutiny of location justification). Not resolved - carried forward
   as an open question to settle when Phase 2 (Start Visit) is actually built, per §8.
