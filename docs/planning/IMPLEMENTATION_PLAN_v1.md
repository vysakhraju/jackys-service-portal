# Jacky's Service Portal — Implementation Plan

**Version:** 1.0
**Date:** 2026-08-20
**Source:** Discovery Document v1.0
**Stack:** NestJS + PostgreSQL + JWT + React

---

## 1. Epic Overview

### Purpose
Build a field-service-first Service Management System for Jacky's Distribution covering the complete service lifecycle from appointment scheduling through invoicing and finance.

### User Value
- **Field Technicians:** Mobile app with 4-button workflow (Start/Need Spare/Complete/QC) — zero data entry
- **CCEs:** Single web portal for all operational data entry & customer communication
- **Finance:** Automated invoicing, VAT compliance, interdepartment recharge
- **Management:** Real-time Kanban dashboards, SLA tracking, inventory visibility

### Scope
**Included (MVP - Phase 1):**
- Service Portal Core (EPIC-001): Appointment → On-Site → Job Card → Workshop
- Workshop Management (EPIC-002): Engineering → QC
- Inventory & Spare Parts (EPIC-003): Reservation model, deduction at QC
- Customer Portal & Notifications (EPIC-005): Tracking, estimates, WhatsApp/Email

**Phase 2:**
- Finance & Invoicing (EPIC-004): Auto-draft, VAT, GL, interdept recharge
- Reports & Dashboards (EPIC-006): Real-time WebSocket

**Optional:**
- Warranty Claims (EPIC-007 partial)
- Dismantling Module (EPIC-007)

### Key Stakeholders
| Role | Impact |
|------|--------|
| Vysakh Raju | Service Ops Lead, Product Owner |
| Technical Architect | System design, code review |
| Finance Lead | Invoicing, GL, VAT validation |
| Development Team | Implementation |

---

## 2. Epic Goals & Success Metrics

### Primary Goal
Deploy Service Portal Core (EPIC-001 + EPIC-002 + EPIC-003) enabling field-first service workflow within 8 weeks.

### Success Metrics
| Metric | Target |
|--------|--------|
| Appointment → Job Card time | < 5 min (CCE) |
| On-site validation → workshop collect | < 30 min |
| Spare reservation → QC deduction | 100% accuracy |
| Customer estimate response time | < 24 hrs |
| API response time (p95) | < 300ms |
| Unit test coverage | ≥ 90% branch |

---

## 3. Requirements Summary

### Functional Requirements (EARS Format)

| ID | Requirement |
|----|-------------|
| FR-01 | When a CCE creates an appointment, the system shall check Service Centre capacity before confirming. |
| FR-02 | When a Field Technician starts a visit, the system shall capture GPS coordinates and timestamp. |
| FR-03 | When a Technician captures S/N, the system shall validate against Warranty Master Table and return IW/OOW status. |
| FR-04 | When S/N is validated, the system shall require Fault Code + Symptom Code before proceeding. |
| FR-05 | When S/N is not validated against invoice, the system shall block Job Card creation. |
| FR-06 | When job is OOW, the system shall require Customer Approval via shareable link before WIP starts. |
| FR-07 | When estimate is sent, the system shall deliver notification via WhatsApp/Email/SMS within 1 minute. |
| FR-08 | When customer rejects estimate, the system shall set job status to RWR and block further work. |
| FR-09 | When spare is requested during WIP, the system shall RESERVE (not deduct) stock from Main Store. |
| FR-10 | When QC Passes, the system shall auto-deduct reserved spares from Main Store → Damage Location. |
| FR-11 | When batch delivery is created, the system shall generate single DLV# for all jobs. |
| FR-12 | When OOW delivery is attempted, the system shall block unless invoice = Paid OR B2B Credit. |
| FR-13 | When QC Passes, the system shall auto-draft Invoice with correct VAT (5% UAE / 15% KSA by centre). |
| FR-14 | When payment is recorded, the system shall accept Cash/Card/Bank Transfer/Credit (no online gateway). |
| FR-15 | When Interdepartment warranty job passes QC, the system shall auto-generate Internal Debit Note (spare cost + internal labor rate). |
| FR-16 | When GRN is created for spare not linked to model, the system shall block and require linking. |
| FR-17 | When Warranty Override is used, the system shall create audit trail (TL approval, reason, timestamp). |
| FR-18 | When AMC renewal is 30 days away, the system shall auto-send reminder and schedule PM. |
| FR-19 | When BOM dismantling is approved, the system shall convert BOM items to spares with manual pricing and simultaneous inventory adjust. |
| FR-20 | When any status changes, the system shall update real-time Kanban dashboard via WebSocket. |

### Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-01 | API response time p95 < 300ms for all CRUD operations |
| NFR-02 | WebSocket latency < 100ms for dashboard updates |
| NFR-03 | Mobile app offline mode: queue actions, sync on reconnect (conflict: last-write-wins + audit) |
| NFR-04 | JWT tokens: 15min access, 7-day refresh, role-based claims |
| NFR-05 | Audit trail on ALL status changes, inventory moves, financial transactions |
| NFR-06 | Database: PostgreSQL with JSONB for flexible master data, advisory locks for reservations |
| NFR-07 | VAT calculation: configurable per Service Centre location (country → rate) |
| NFR-08 | File uploads: S3-compatible, max 10MB per photo, virus scan |

### Business Rules
- **Reservation Model:** Spare stock reserved during WIP, deducted ONLY at QC Passed
- **S/N Validation:** Mandatory — no Job Card without invoice verification
- **Warranty:** IW (green badge) / OOW (red badge); mismatch → TL override with audit
- **Customer Types:** B2B, B2C, B2B-SalesChannel (interdept recharge)
- **Payment:** Manual only (Cash, Card, Bank Transfer, B2B Credit 30-day)
- **VAT:** By Service Centre location (UAE 5%, KSA 15%)
- **AMC:** 30-day renewal reminder, auto PM schedule

---

## 4. Technical Change Overview

| Component | Type | Description | Risk | Dependencies |
|-----------|------|-------------|------|--------------|
| NestJS Project Scaffold | New | Monorepo with backend/ frontend/ shared | Low | None |
| PostgreSQL Schema | New | 30+ tables for master data, transactions, audit | Med | NFR-06 |
| Auth Module (JWT + Guards) | New | Access/refresh tokens, role guards, audit interceptor | Med | NFR-04 |
| Appointment Module | New | Scheduling, capacity check, notifications | Low | Master data |
| Technician Mobile API | New | GPS, S/N capture, warranty check, fault codes | Low | Warranty API |
| Job Card Module | New | S/N validation, warranty override, section assignment | Med | FR-05, FR-17 |
| Estimate Module | New | Link generation, approve/reject, RWR flow | Med | Notifications |
| Workshop Module | New | Assign, WIP, spare log (reserve), QC | Med | Inventory |
| Inventory Module | New | Reservation model, auto-deduct at QC, GRN block | High | FR-09, FR-10, FR-16 |
| Delivery Module | New | Batch/normal, DLV#, POD, OOW block | Med | FR-11, FR-12 |
| Finance Module | New | Auto-invoice, VAT, payment, GL, interdept debit | High | FR-13, FR-14, FR-15 |
| AMC Module | New | Contracts, PM schedule, renewal, RWR upsell | Low | |
| Dismantling Module | New | BOM→spare, pricing, inventory adjust, audit | Med | v2.1 |
| Notifications Service | New | WhatsApp/Email/SMS templates, triggers | Med | External APIs |
| Reports/Dashboard | New | WebSocket real-time Kanban, aging alerts | Med | NFR-02 |
| Customer Portal | New | Track, approve estimate, pay, download | Low | |
| WhatsApp Integration | New | Business API, templates, webhooks | High | T2 |
| External Warranty API | New | S/N check, CSV fallback | High | T1 |

---

## 5. Impact Analysis

### Codebase Impact
- **New monorepo:** `backend/`, `frontend/`, `shared/`
- **Backend modules:** 15+ NestJS modules
- **Database:** 30+ tables with migrations
- **Mobile API:** REST + WebSocket endpoints

### Data Model Changes (New)
Core entities: `ServiceCentre`, `Appointment`, `Technician`, `JobCard`, `SparePart`, `InventoryReservation`, `Estimate`, `Invoice`, `Payment`, `WarrantyMaster`, `FaultSymptom`, `ServicePriceList`, `AMCContract`, `DismantlingRecord`, `AuditLog`

### API Changes
| Endpoint Group | Count | Pattern |
|----------------|-------|---------|
| Appointments | 8 | REST |
| Technician Mobile | 12 | REST + WebSocket |
| Job Cards | 10 | REST |
| Estimates | 6 | REST |
| Workshop | 10 | REST |
| Inventory | 12 | REST |
| Delivery | 8 | REST |
| Finance | 10 | REST |
| AMC | 6 | REST |
| Dismantling | 5 | REST |
| Notifications | 5 | Internal |
| Reports | 8 | REST + WebSocket |

### Migration Strategy
- Greenfield — no existing data migration
- Master data import from Excel/CSV (BRD provides templates)
- Sequential module deployment: Auth → Master Data → Appointments → Job Cards → Workshop → Inventory → Delivery → Finance → Reports

### Rollback Plan
- Database migrations: reversible (down migrations for each)
- Feature flags per module
- Blue-green deployment for zero-downtime

---

## 6. Testing Strategy

### Unit Testing (Target: 90% branch coverage)
- Service layer: all business logic (reservation model, VAT calc, warranty check)
- Guards: role-based access, audit interceptor
- Utilities: date helpers, VAT calculator, S/N validator

### Integration Testing
- Appointment → Job Card flow
- Spare reservation → QC deduction flow
- Estimate approve/reject → RWR flow
- OOW delivery block → payment → release flow
- Interdepartment recharge at QC

### API Testing
- All endpoints: 200, 400, 401, 403, 404, 409, 500
- WebSocket: connect, auth, subscribe, broadcast
- File upload: valid, oversized, malicious

### Test Data
- Fixtures: 10 Service Centres, 50 Technicians, 500 Models, 1000 Spares
- Factory pattern for test data generation
- Seed scripts for local/dev environments

---

## 7. User Behavior Testing (E2E)

### Critical Journeys
1. **Happy Path:** Appointment → On-Site (IW) → On-Site Repair → QC → Delivery → Invoice (Auto) → Paid
2. **OOW Flow:** Appointment → On-Site (OOW) → Estimate → Approve → Workshop → QC → Delivery → Invoice → Pay
3. **Reject Flow:** OOW → Estimate → Reject → RWR → Return
4. **Workshop Major:** On-Site → Collect → Workshop Assign → Spare Request (Reserve) → WIP → QC Pass → Auto-deduct → Delivery
5. **Interdepartment:** B2B-SalesChannel → Warranty → QC → Internal Debit Note
6. **Batch Delivery:** 10 jobs ready → Batch DLV# → Driver POD → All delivered

### Acceptance Test Cases
- Each FR-XX mapped to 1+ test case
- AC-01 through AC-31 covered

---

## 8. Implementation Notes

### Patterns to Follow
- **NestJS:** Module-per-feature, DTOs with class-validator, Guards for auth/roles, Interceptors for audit
- **Database:** TypeORM with repository pattern, advisory locks for reservations
- **API:** RESTful with OpenAPI/Swagger, consistent error format, pagination
- **Frontend:** React + TanStack Query, React Hook Form, Role-based routing

### Architecture Decisions
| Decision | Rationale |
|----------|-----------|
| Monorepo (Nx) | Shared types, unified build, single CI |
| PostgreSQL + JSONB | Relational integrity + flexible master data |
| JWT + Refresh | Stateless, scalable, mobile-friendly |
| Reservation Model | Prevents overselling, audit trail |
| WebSocket (Socket.io) | Real-time Kanban, low latency |
| WhatsApp Business API | Template approval required, high engagement |

### Security Considerations
- JWT: RS256, short expiry, rotation
- Role guards: @Roles('TECHNICIAN', 'CCE', 'FINANCE', 'ADMIN')
- Audit interceptor: logs all mutating requests (user, action, before/after)
- File upload: type validation, size limit, S3 presigned URLs
- SQL injection: TypeORM parameterized queries
- CORS: whitelist origins only

### Technical Debt (Known)
- WhatsApp template approval may delay notifications
- External warranty API may need CSV fallback initially
- Offline sync conflict resolution: last-write-wins + manual review queue

---

## 9. Acceptance Criteria (Definition of Done)

- [ ] All 20 FR-XX implemented and tested
- [ ] All 8 NFR-XX verified (load test, security scan)
- [ ] Unit test coverage ≥ 90% branch
- [ ] Integration tests for 6 critical flows
- [ ] OpenAPI spec generated and validated
- [ ] Database migrations reversible
- [ ] Documentation: API docs, deployment guide, runbook
- [ ] Security review: OWASP top 10, dependency audit
- [ ] Performance: p95 < 300ms, WebSocket < 100ms
- [ ] Accessibility: WCAG 2.1 AA for Customer Portal

---

## 10. Open Questions & Risks

### Blockers
- [ ] WhatsApp Business API account approval (2-4 weeks)
- [ ] External Warranty API access / documentation
- [ ] Mobile framework decision: Flutter vs React Native

### Unknowns
- [ ] Exact S/N validation API contract from suppliers
- [ ] GL/Accounting system integration format
- [ ] Real-time dashboard concurrent user count

### Assumptions
- Team has NestJS + PostgreSQL experience
- Mobile team can start React Native in parallel
- Master data import scripts can be written from BRD templates

### Risks & Mitigation
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| WhatsApp template rejection | Med | Med | Pre-submit 10 templates, have Email/SMS fallback |
| Inventory reservation bugs | Low | High | Comprehensive integration tests, advisory locks |
| VAT calc errors by location | Low | High | Config-driven, unit tests per country |
| Offline sync data loss | Low | High | Queue + conflict resolution + audit trail |

---

## 11. Codebase Analysis (Greenfield)

### Affected Modules (New)
```
backend/
├── src/
│   ├── auth/              # JWT, guards, roles
│   ├── master-data/       # ServiceCentre, FaultSymptom, SparePart, PriceList, Warranty
│   ├── appointments/      # Scheduling, capacity, notifications
│   ├── technician/        # Mobile API: GPS, SN, warranty, faults
│   ├── job-cards/         # SN validation, override, assignment
│   ├── estimates/         # Links, approve/reject, RWR
│   ├── workshop/          # Assign, WIP, spares, QC
│   ├── inventory/         # Reservation, GRN, deduction, transfers
│   ├── delivery/          # Batch, DLV#, POD, OOW block
│   ├── finance/           # Invoice, VAT, payment, GL, interdept
│   ├── amc/               # Contracts, PM, renewal
│   ├── dismantling/       # BOM→spare, pricing, inventory
│   ├── notifications/     # WhatsApp/Email/SMS
│   ├── reports/           # Dashboards, WebSocket
│   ├── customer-portal/   # Track, approve, pay, download
│   └── common/            # Audit, exceptions, utils, dto
```

### Reference Implementations
- NestJS official examples: auth, TypeORM, WebSocket
- TypeORM advisory lock pattern for reservations
- Socket.io rooms for real-time dashboards

---

## 12. Implementation Phases (Suggested 8-Week MVP)

| Week | Phase | Modules | Deliverable |
|------|-------|---------|-------------|
| 1 | Foundation | Auth, Master Data, DB schema | Running API with RBAC |
| 2 | Appointments | Appointments, Technician Mobile | Schedule → On-site flow |
| 3 | Job Cards | Job Cards, Warranty Check | SN validation, override |
| 4 | Estimates | Estimates, Notifications | OOW approval flow |
| 5 | Workshop | Workshop, Inventory (Reserve) | Spare reservation during WIP |
| 6 | QC + Inventory | QC Pass → Auto-deduct, GRN block | Inventory accuracy |
| 7 | Delivery | Delivery, POD, OOW block | End-to-end logistics |
| 8 | Finance + Customer | Finance, Customer Portal | Auto-invoice, tracking |

**Phase 2 (Post-MVP):** Reports/Dashboards, AMC, Dismantling, Warranty Claims

---

## 13. Next Steps

1. **Approve this plan** — confirm scope, stack, timeline
2. **Scaffold NestJS monorepo** — `nx create jackys-service-portal`
3. **Set up PostgreSQL** — Docker compose, migrations
4. **Implement Auth Module** — JWT, roles, audit interceptor
5. **Build Master Data import** — from BRD Excel templates
6. **Start Appointment Module** — capacity check, notifications

---

**Plan Status:** Ready for execution → `/project:execution:execute-ticket` for first sprint tickets