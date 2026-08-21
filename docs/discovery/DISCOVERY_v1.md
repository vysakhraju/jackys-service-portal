# Jacky's Service Portal — Discovery Document

**Version:** 1.0
**Date:** 2026-08-20
**Source:** BRD Rev 2.1 (SOW v2.1) + BRD Walkthrough Presentation
**Tech Stack:** NestJS (Backend), PostgreSQL (DB), JWT Auth, React (Frontend)

---

## 1. Discovery Overview

### Epic
**Title:** Jacky's Distribution — ERP, CRM & Service Management Implementation
**Scope:** Field-Service-First model connecting Field Techs (mobile), CCEs (web), Workshop Techs, Logistics, and Finance.

### Discovery Goal
Define functional & technical requirements for two logical portals:
- **Service Portal** (Front-end / Operational)
- **Accounts & Finance Portal** (Back-end / Transactional)

### Success Criteria
- [x] All 14+1 workflows mapped
- [x] User roles & permissions defined
- [x] Master data requirements identified
- [x] Technical stack decisions (NestJS, PostgreSQL, JWT)
- [x] API surface enumerated
- [ ] Acceptance criteria validated with stakeholders

### Timeline
No dev milestones defined in BRD. To be planned.

### Stakeholders
| Role | Responsibility |
|------|----------------|
| Vysakh Raju | Service Ops Lead / BRD Author |
| Technical Architect | System design, stack decisions |
| Finance Lead | Invoicing, GL posting, interdepartment recharge |
| Service Ops Lead | Workflow validation, SLA definitions |
| Development Team | Implementation |

---

## 2. Hypothesis Map

| Hypothesis ID | Statement | Confidence | Validation Method | Status |
|---------------|-----------|------------|-------------------|--------|
| H1 | Field-Service-First model reduces turnaround time | Med | Pilot with 50 jobs | Open |
| H2 | S/N validation at field level prevents warranty fraud | High | Audit historical claims | Open |
| H3 | Spare reservation during WIP prevents stock discrepancies | High | Inventory reconciliation | Open |
| H4 | WhatsApp integration improves customer response rate | Med | A/B test notifications | Open |
| H5 | Interdepartment recharge model improves cost allocation | Med | Finance pilot | Open |

---

## 3. Research Questions Matrix

### Customer/User Discovery
| ID | Question | Priority | Method | Owner | Status |
|----|----------|----------|--------|-------|--------|
| Q1 | What is the current manual process pain point? | High | Process mapping | Vysakh | Open |
| Q2 | How many field techs / workshop techs active daily? | High | Ops data | Vysakh | Open |
| Q3 | Customer notification preferences (Email/WhatsApp/SMS split)? | Med | Survey | Vysakh | Open |

### Technical Feasibility
| ID | Question | Priority | Method | Owner | Status |
|----|----------|----------|--------|-------|--------|
| T1 | Can we integrate external supplier warranty API? | High | API spike | Architect | Open |
| T2 | WhatsApp Business API template approval process? | High | Vendor research | Architect | Open |
| T3 | Offline mode requirements for field techs? | Med | Requirements | Architect | Open |
| T4 | Real-time dashboard (WebSocket) load capacity? | Med | Benchmark | Architect | Open |

### Business Viability
| ID | Question | Priority | Method | Owner | Status |
|----|----------|----------|--------|-------|--------|
| B1 | VAT compliance per service center location (UAE 5% / KSA 15%)? | High | Legal review | Finance | Open |
| B2 | Interdepartment recharge reporting frequency? | Med | Finance discussion | Finance | Open |

### Scope & Boundaries
| ID | Question | Priority | Method | Owner | Status |
|----|----------|----------|--------|-------|--------|
| S1 | MVP = Service Portal first, Finance later? | High | Discussion | Vysakh | Open |
| S2 | Payment gateway explicitly out of scope? | High | Confirmed | BRD | Closed |

---

## 4. Dependencies & Blockers

### External Dependencies
- **Supplier Warranty API** — S/N warranty check (CSV upload or API)
- **WhatsApp Business API** — Template messages with buttons
- **Email Service** — HTML templates + PDF attachments
- **SMS Gateway** — Technician arrival, notifications
- **GL / Accounting System** — Auto journal entries

### Internal Dependencies
- Service Centre master data (schedule, capacity)
- Fault & Symptom library
- Spare Parts to Model mapping
- Service Price List
- Warranty Master Table
- Component Yield Matrix (v2.1)

### Information Blockers
- No dev timeline defined
- Real-time dashboard performance targets unspecified
- SLA breach thresholds partially defined

---

## 5. Research Plan

### Activity 1: Warranty API Integration Spike
- **Questions:** T1
- **Method:** Test supplier API with sample S/N ranges
- **Output:** Feasibility report + fallback (CSV upload) design

### Activity 2: WhatsApp Business API Setup
- **Questions:** T2
- **Method:** Register business account, submit templates
- **Output:** Approved template list + webhook design

### Activity 3: Field Tech Offline Mode Design
- **Questions:** T3
- **Method:** Requirements workshop with field team
- **Output:** Sync conflict resolution spec

---

## 6. Decision Framework

| Decision Point | Options | Criteria | Owner |
|----------------|---------|----------|-------|
| Mobile Framework | Flutter, React Native | Team skill, offline support | Architect |
| Database | PostgreSQL, MySQL | JSON support, Geo queries | Architect |
| Notification Channel Priority | WhatsApp, Email, SMS | Cost, delivery rate | Vysakh |
| MVP Scope | Service Portal, Full | Risk, timeline | Vysakh |

---

## 7. Risk Register

| Risk | Likelihood | Impact | Mitigation | Owner |
|------|------------|--------|------------|-------|
| Supplier API unavailable | Med | High | CSV upload fallback | Architect |
| WhatsApp template rejection | Med | Med | Pre-approved templates | Vysakh |
| Offline sync conflicts | Low | High | Last-write-wins + audit | Architect |
| Inventory discrepancies | Low | High | Reservation model + cycle counts | Ops |
| VAT calculation errors | Low | High | Location-based config + tests | Finance |

---

## 8. Target Implementation Epics

| Epic | Title | Relationship |
|------|-------|--------------|
| EPIC-001 | Service Portal Core (Appointment → Job Card) | Primary MVP |
| EPIC-002 | Workshop Management (Engineering → QC) | Depends on EPIC-001 |
| EPIC-003 | Inventory & Spare Parts | Cross-cutting |
| EPIC-004 | Finance & Invoicing | Back-end, post-MVP |
| EPIC-005 | Customer Portal & Notifications | Parallel track |
| EPIC-006 | Reports & Dashboards | Final phase |
| EPIC-007 | Dismantling & Component Recovery (v2.1) | Optional |

---

## 9. Core Workflows (14+1)

1. **Schedule & Appointment Creation** — CCE books, capacity check
2. **Technician On-Site Visit & Validation** — GPS, S/N capture, warranty check
3. **Option A — On-Site Repair** — Light maintenance
4. **Option B — Collect to Workshop** — Major repair
5. **Service Centre — Job Card Creation & Validation** — S/N vs invoice
6. **Out of Warranty — Estimate & Customer Approval** — Link + approve/reject
7. **Engineering Activity (Workshop)** — Assign, WIP, spare log
8. **Spare Parts Management & Inventory** — Reservation, deduction at QC
9. **Quality Control & Transfer to Logistics** — Pass/Fail
10. **Delivery & Proof of Delivery** — POD capture
11. **Invoicing & Finance** — Auto-draft at QC, VAT, payment methods
12. **Warranty Claims & Vendor Management** — Optional
13. **AMC Management** — Contracts, renewals
14. **Reports & Dashboards** — Real-time Kanban
15. **Defective/DOA Appliance Dismantling** — v2.1 new

---

## 10. User Roles & Permissions

| Role | Access | Key Responsibilities |
|------|--------|---------------------|
| Technician (Field/Workshop) | Mobile App | Start/Complete repair, Request spares, Mark QC (if authorized) |
| CCE (Customer Care Executive) | Web Portal | Appointments, S/N validation, estimates, invoices, close jobs |
| Technical Team Leader / Supervisor | Web Portal | Validate spare consumption, warranty override, assign jobs, QC |
| QC Officer | Web Portal | Final QC Pass/Fail |
| Accountant / Finance | Web Portal | Finalize invoices, GL posting, interdepartment recharge |
| Service Head | Super Admin | AMC contracts, dismantle module, renewal reminders |
| Logistics Dispatcher / Driver | Web + Mobile | Batch/normal delivery, POD capture |
| Inventory / Warehouse Clerk | Web Portal | GRN creation, van stock replenishment |
| End Customer | Customer Portal | Track job, approve estimate, pay invoice, download job card |
| Warranty Clerk | Web Portal | Generate vendor claim reports (Optional) |

---

## 11. Master Data Required

| Entity | Key Fields |
|--------|-----------|
| Service Centre Schedule | Centre ID, Day, Start/End, Max Jobs/Day, Technicians, Break Times |
| Fault & Symptom Library | Fault Code, Description, Symptom Code, Category, Requires Workshop |
| Spare Parts to Model | Model ID, Spare Part Code, Min Stock, Location ID, Van Stock |
| Service Price List | Activity Type, Price B2B, Price B2C, Warranty Labor, Interdept Labor |
| Technician KPI Rules | KPI Name, Weightage, Target, Incentive Points |
| Notification Templates | Trigger Event, Channel, Subject, Body (placeholders) |
| Warranty Master Table | S/N Range, Brand, Model, Warranty Period, Supplier |
| Component Yield Matrix | Model, BOM Item, Category, Recovery Evaluation |

---

## 12. API Endpoints (Derived)

| Module | Endpoints |
|--------|-----------|
| Appointments | create, check-availability, get-slots, notify |
| Technician (mobile) | start-visit (GPS), capture-SN, warranty-check, fault-codes, onsite-repair, spare-request, signature, collect, POD |
| Job Cards | create (linked to Appointment), validate-SN, warranty-override, assign-section |
| Estimates | create, generate-link, capture-response |
| Workshop | assign-tech (SLA), start-WIP, log-spares (reserve), spare-pending, complete, QC |
| Inventory | GRN (blocked if unlinked), link-spare-model, auto-deduct (QC), low-stock-alert, van-transfer, damage-transfer |
| Delivery | list-ready (IW/OOW tabs), batch/normal, generate-DLV, block-OOW-if-unpaid, POD |
| Invoicing/Finance | auto-draft (QC), finalize (B2B/B2C VAT), payment (Cash/Card/Bank/Credit), GL-post, interdept-DebitNote, B2B-aging |
| AMC | create-contract, schedule-PM, billing, renewal-alert, RWR-upsell |
| Warranty Claims | aggregate-spares, claim-report, vendor-credit, recovery-rate |
| Dismantling | BOM-to-spare, manual-pricing, inventory-adjust |
| Reports | Service Manager, Finance, Quality, Operational (WebSocket) |
| Notifications | Email/WhatsApp/SMS triggers |

---

## 13. Key Business Logic / Acceptance Criteria

| ID | Rule | Source |
|----|------|--------|
| AC-01 | Schedule check before appointment creation | Service Portal |
| AC-02 | GPS capture on technician visit start | Service Portal |
| AC-03 | S/N + warranty validation before job close | Service Portal |
| AC-04 | Fault/symptom code mandatory | Service Portal |
| AC-05 | Block job card until S/N validated vs invoice | Service Portal |
| AC-06 | OOW must get customer approval before WIP | Service Portal |
| AC-07 | Estimate notification < 1 min | Service Portal |
| AC-08 | Reject → RWR (Ready for Return) | Service Portal |
| AC-09 | Spares deducted ONLY at QC Completed | Inventory |
| AC-10 | Batch delivery = single DLV# | Delivery |
| AC-11 | Block OOW delivery if invoice ≠ Paid (unless B2B Credit) | Delivery |
| AC-12 | POD mandatory (signature OR photo) | Delivery |
| AC-13 | Auto-invoice + correct VAT at QC Completed | Finance |
| AC-14 | Manual payment, no gateway | Finance |
| AC-15 | Interdepartment warranty → Internal Debit Note at QC | Finance |
| AC-16 | Recharge report | Finance |
| AC-17 | GRN blocked if spare not linked to model | Inventory |
| AC-18 | Warranty override → audit trail | Service Portal |
| AC-19/20/21 | Notifications (Email/WhatsApp/SMS) | Notifications |
| AC-22/23/24 | Reporting dashboards | Reports |
| AC-25/26/27/28 | Role/tech requirements | Security |
| AC-39/30/31 | Dismantling module | v2.1 |

---

## 14. Next Steps

1. **Validate discovery** with stakeholders (Vysakh, Finance, Architect)
2. **Run `/project:planning:epic-plan`** to create implementation roadmap
3. **Start EPIC-001** (Service Portal Core) — NestJS scaffold
4. **Set up PostgreSQL** schema for master data
5. **Implement auth** (JWT + role guards)

---

**Discovery Status:** Ready for synthesis → `/project:discovery:synthesize`
