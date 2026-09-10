import { RoleName } from './entities/role.entity';

/**
 * The designation permission matrix's source of truth for WHAT can be granted - a code
 * const, not a DB table, on purpose: adding a new grantable capability is a deliberate
 * code change (a developer decides a new endpoint is safe to expose in the matrix and
 * writes its entry here), never something that can silently appear from stray data. The
 * matrix table (RolePermission) only ever stores WHO currently holds each of these keys.
 *
 * Each entry replaces exactly one existing @Roles() array on one or more endpoints - see
 * `migrated` and the controller comment at each capability's actual @RequiresCapability()
 * call site for which endpoints. `defaultRoles` is that array's exact membership MINUS
 * MATRIX_LOCKED_ROLES (SUPER_ADMIN/SERVICE_HEAD always pass regardless via RolesGuard's
 * hardcoded bypass, so seeding a row for them would just be inert, confusing data) - used
 * once, by the seed script, to make migrating a module a zero-behavior-change event.
 *
 * `migrated: false` entries exist here as a forward-looking index of what's NOT wired up
 * yet (so the admin matrix UI can show "coming soon" rather than a checkbox that silently
 * does nothing) - only set `migrated: true` in the same change that actually swaps the
 * controller's @Roles() decorator for @RequiresCapability().
 *
 * Users/Permissions/Auth controllers are deliberately never represented here at all - they
 * stay on the old hardcoded @Roles() forever. That's the module that fixes a bad matrix
 * state; it can't depend on the system it administers (the-fool finding, 2026-09-10).
 */
export interface CapabilityDefinition {
  key: string;
  label: string;
  module: string;
  /** Exact membership of the @Roles() array this replaces, minus MATRIX_LOCKED_ROLES. */
  defaultRoles: RoleName[];
  migrated: boolean;
}

export const CAPABILITY_CATALOG: CapabilityDefinition[] = [
  // --- Appointments / Schedule --- replaces 4 distinct role-sets found on
  // appointments.controller.ts. Kept as 4 separate capabilities rather than one "Schedule"
  // toggle because they are genuinely different levels today (e.g. CCE can create/manage an
  // appointment but cannot assign a technician to it) - collapsing them would silently
  // grant more than the role holds today (the-fool finding, 2026-09-10).
  {
    key: 'SCHEDULE_CCE_MANAGE',
    label: 'Create & manage appointments (create, cancel, confirm, map link, scheduling grid)',
    module: 'Appointments',
    defaultRoles: [RoleName.CCE],
    migrated: true,
  },
  {
    key: 'SCHEDULE_VIEW_UPDATE',
    label: 'Update an appointment & view schedule dashboard stats',
    module: 'Appointments',
    defaultRoles: [RoleName.CCE, RoleName.TECHNICAL_TEAM_LEADER],
    migrated: true,
  },
  {
    key: 'SCHEDULE_ASSIGN_TECHNICIAN',
    label: 'Assign a technician to an appointment',
    module: 'Appointments',
    defaultRoles: [RoleName.TECHNICAL_TEAM_LEADER],
    migrated: true,
  },
  {
    key: 'SCHEDULE_FIELD_VISIT',
    label: 'Mark an appointment on-site / complete (field technician self-service)',
    module: 'Appointments',
    defaultRoles: [RoleName.TECHNICAL_TEAM_LEADER, RoleName.TECHNICIAN_FIELD],
    migrated: true,
  },
  // Delete (@Roles('SUPER_ADMIN') alone) is intentionally absent - already hardcoded to
  // the one role that can never be edited via this matrix, exposing it would be inert.

  // --- Job Cards / QC gate --- replaces QC_GATE_ROLES on job-cards.controller.ts's
  // qc/approve + qc/reject. This is only the FLOOR check - requireActiveGrant(QC_APPROVAL)
  // still runs inside both handlers afterward, completely untouched by this matrix. See
  // job-cards.controller.ts's own QC_GATE_ROLES comment for why that two-layer design is
  // deliberate.
  {
    key: 'QC_GATE_ACCESS',
    label: 'Eligible to hold QC approve/reject sign-off (still needs the separate QC_APPROVAL grant to actually approve)',
    module: 'QC',
    defaultRoles: [RoleName.TECHNICAL_TEAM_LEADER, RoleName.CCE, RoleName.QC_OFFICER],
    migrated: true,
  },

  // --- Job Cards --- replaces JOB_CARD_ROLES/WARRANTY_OVERRIDE_ROLES/TASK_PAUSE_ROLES on
  // job-cards.controller.ts (2026-09-10). Kept as 3 separate capabilities, same reasoning as
  // Appointments above: warranty override is genuinely narrower (TL only, FR-17) than core
  // Job Card management, and task pause/resume is genuinely wider (also open to the
  // technician actually doing the work) - collapsing any of these would silently grant more
  // or less than today.
  {
    key: 'JOB_CARD_MANAGE',
    label: 'Create, validate S/N, assign section, record customer approval, and cancel a Job Card',
    module: 'Job Cards',
    defaultRoles: [RoleName.TECHNICAL_TEAM_LEADER, RoleName.CCE],
    migrated: true,
  },
  {
    key: 'JOB_CARD_WARRANTY_OVERRIDE',
    label: 'Warranty override on a Job Card (FR-17/AC-18)',
    module: 'Job Cards',
    defaultRoles: [RoleName.TECHNICAL_TEAM_LEADER],
    migrated: true,
  },
  {
    key: 'JOB_CARD_TASK_PAUSE',
    label: 'Pause/resume a Job Card task timer',
    module: 'Job Cards',
    defaultRoles: [RoleName.TECHNICAL_TEAM_LEADER, RoleName.CCE, RoleName.TECHNICIAN_FIELD, RoleName.TECHNICIAN_WORKSHOP],
    migrated: true,
  },

  // --- Workshop --- replaces ASSIGN_ROLES/ACTION_ROLES/the ACTION_ROLES+CCE view combo on
  // workshop.controller.ts (2026-09-10). PRIVILEGED_ROLES (the in-handler ownership-bypass
  // check on start-wip/request-spare/complete) is untouched, same reasoning as Job Cards'
  // TASK_PAUSE_PRIVILEGED_ROLES.
  {
    key: 'WORKSHOP_ASSIGN',
    label: 'Assign/reassign a workshop technician & manage crew helpers',
    module: 'Workshop',
    defaultRoles: [RoleName.TECHNICAL_TEAM_LEADER],
    migrated: true,
  },
  {
    key: 'WORKSHOP_ACTION',
    label: 'Start WIP, request a spare, complete workshop work',
    module: 'Workshop',
    defaultRoles: [RoleName.TECHNICAL_TEAM_LEADER, RoleName.TECHNICIAN_WORKSHOP],
    migrated: true,
  },
  {
    key: 'WORKSHOP_VIEW',
    label: 'View a Job Card\'s workshop state & crew helpers',
    module: 'Workshop',
    defaultRoles: [RoleName.TECHNICAL_TEAM_LEADER, RoleName.TECHNICIAN_WORKSHOP, RoleName.CCE],
    migrated: true,
  },

  // --- AMC --- replaces AMC_MANAGEMENT_ROLES/AMC_VIEW_ROLES/AMC_TECHNICIAN_ROLES/
  // FINANCE_ROLES on amc.controller.ts (2026-09-10). Named AMC_BILLING rather than a bare
  // "FINANCE" key since GL/Debit Notes will need their own, differently-scoped finance
  // capability when those modules migrate - keys must stay globally unique in this catalog.
  {
    key: 'AMC_MANAGE',
    label: 'Create, renew, cancel an AMC contract & send renewal reminders',
    module: 'AMC',
    defaultRoles: [RoleName.CCE],
    migrated: true,
  },
  {
    key: 'AMC_VIEW',
    label: 'View AMC contracts, schedules & visit completions',
    module: 'AMC',
    defaultRoles: [RoleName.CCE, RoleName.TECHNICIAN_FIELD, RoleName.TECHNICIAN_WORKSHOP, RoleName.ACCOUNTANT, RoleName.FINANCE_MANAGER],
    migrated: true,
  },
  {
    key: 'AMC_TECHNICIAN_VISIT',
    label: 'Complete an AMC preventive-maintenance visit',
    module: 'AMC',
    defaultRoles: [RoleName.TECHNICIAN_FIELD, RoleName.TECHNICIAN_WORKSHOP],
    migrated: true,
  },
  {
    key: 'AMC_BILLING',
    label: 'Generate & manage AMC billing invoices, record payments',
    module: 'AMC',
    defaultRoles: [RoleName.ACCOUNTANT, RoleName.FINANCE_MANAGER],
    migrated: true,
  },

  // --- Inventory --- replaces INVENTORY_STAFF_ROLES/REVIEW_ROLES/READ_ROLES/
  // request-return's own inline role list on inventory.controller.ts (2026-09-10).
  {
    key: 'INVENTORY_STAFF',
    label: 'Receive stock (GRN) & confirm a physical return',
    module: 'Inventory',
    defaultRoles: [RoleName.WAREHOUSE_CLERK],
    migrated: true,
  },
  {
    key: 'INVENTORY_REVIEW',
    label: 'Review a stale/Need Spare reservation, release a reservation',
    module: 'Inventory',
    defaultRoles: [RoleName.TECHNICAL_TEAM_LEADER],
    migrated: true,
  },
  {
    key: 'INVENTORY_VIEW',
    label: 'View stock levels & pending reservations',
    module: 'Inventory',
    defaultRoles: [RoleName.WAREHOUSE_CLERK, RoleName.TECHNICAL_TEAM_LEADER, RoleName.CCE],
    migrated: true,
  },
  {
    key: 'INVENTORY_RETURN_REQUEST',
    label: "Request return of a reservation as its custodian (or on a technician's behalf)",
    module: 'Inventory',
    defaultRoles: [RoleName.TECHNICAL_TEAM_LEADER, RoleName.TECHNICIAN_WORKSHOP, RoleName.TECHNICIAN_FIELD],
    migrated: true,
  },

  // --- Delivery --- replaces DELIVERY_ROLES on delivery.controller.ts (2026-09-10).
  {
    key: 'DELIVERY_MANAGE',
    label: 'View, create, dispatch, capture POD for, and cancel deliveries',
    module: 'Delivery',
    defaultRoles: [RoleName.LOGISTICS_DISPATCHER, RoleName.DRIVER],
    migrated: true,
  },

  // --- Invoicing --- replaces INVOICING_ROLES + getForJobCard()'s wider inline role list
  // on invoicing.controller.ts (2026-09-10). Recording a payment is deliberately kept on
  // the narrower INVOICING_MANAGE - the person who hands over the unit (DELIVERY_MANAGE)
  // is never the person who gets to record that it was paid for.
  {
    key: 'INVOICING_MANAGE',
    label: 'Browse invoices, B2B aging report, payment history, record a payment',
    module: 'Invoicing',
    defaultRoles: [RoleName.ACCOUNTANT, RoleName.FINANCE_MANAGER],
    migrated: true,
  },
  {
    key: 'INVOICING_JOB_CARD_VIEW',
    label: "Get (or lazily draft) a Job Card's invoice - also needed by Delivery before handover",
    module: 'Invoicing',
    defaultRoles: [RoleName.ACCOUNTANT, RoleName.FINANCE_MANAGER, RoleName.LOGISTICS_DISPATCHER, RoleName.DRIVER],
    migrated: true,
  },

  // --- Dismantling --- replaces HARVEST_ROLES/VERIFY_ROLES/MANAGER_ROLES/VIEW_ROLES on
  // dismantling.controller.ts (2026-09-10).
  {
    key: 'DISMANTLING_HARVEST',
    label: 'Open a dismantling record, log harvested components, cancel',
    module: 'Dismantling',
    defaultRoles: [RoleName.TECHNICIAN_WORKSHOP, RoleName.TECHNICIAN_FIELD, RoleName.TECHNICAL_TEAM_LEADER],
    migrated: true,
  },
  {
    key: 'DISMANTLING_VERIFY',
    label: 'Verify a harvested component log (must differ from whoever harvested)',
    module: 'Dismantling',
    defaultRoles: [RoleName.TECHNICAL_TEAM_LEADER],
    migrated: true,
  },
  {
    key: 'DISMANTLING_MANAGE',
    label: 'BOM-to-spare conversion, pricing & posting (adjusts inventory + GL)',
    module: 'Dismantling',
    // Was SERVICE_HEAD+SUPER_ADMIN only (both MATRIX_LOCKED_ROLES) - empty on purpose, see
    // the controller's own comment. Zero behavior change; an admin can now opt to extend it.
    defaultRoles: [],
    migrated: true,
  },
  {
    key: 'DISMANTLING_VIEW',
    label: 'View dismantling records',
    module: 'Dismantling',
    defaultRoles: [RoleName.TECHNICAL_TEAM_LEADER, RoleName.TECHNICIAN_FIELD, RoleName.TECHNICIAN_WORKSHOP, RoleName.ACCOUNTANT, RoleName.FINANCE_MANAGER],
    migrated: true,
  },

  // --- Warranty Claims --- replaces CLERK_ROLES/VIEW_ROLES on warranty-claims.controller.ts
  // (2026-09-10). CREDIT_NOTE_POST (below) was originally excluded on the same date - the
  // one role-set in the app that included SUPER_ADMIN but not SERVICE_HEAD - then migrated
  // once the business explicitly decided (2026-09-10, same day) that SERVICE_HEAD should
  // get that access too, which made the array symmetric.
  {
    key: 'WARRANTY_CLAIMS_CLERK',
    label: 'Aggregate, submit & cancel a warranty claim',
    module: 'Warranty Claims',
    defaultRoles: [RoleName.WARRANTY_CLERK],
    migrated: true,
  },
  {
    key: 'WARRANTY_CLAIMS_VIEW',
    label: 'View warranty claims & recovery rate',
    module: 'Warranty Claims',
    defaultRoles: [RoleName.WARRANTY_CLERK, RoleName.ACCOUNTANT, RoleName.FINANCE_MANAGER],
    migrated: true,
  },
  {
    key: 'CREDIT_NOTE_POST',
    label: "Record a vendor's credit note & post its GL entry (BRD 12.4)",
    module: 'Warranty Claims',
    defaultRoles: [RoleName.ACCOUNTANT, RoleName.FINANCE_MANAGER],
    migrated: true,
  },

  // --- Reports --- replaces each reports/*.controller.ts's own class-level VIEW_ROLES
  // (2026-09-10). Four separate dashboards, four separate capabilities - same reasoning as
  // every other module here: each audience is genuinely different today.
  {
    key: 'REPORTS_DASHBOARD_VIEW',
    label: 'BRD 18.1 Service Manager Dashboard (Kanban, approval aging, efficiency, overview)',
    module: 'Reports',
    defaultRoles: [RoleName.TECHNICAL_TEAM_LEADER],
    migrated: true,
  },
  {
    key: 'REPORTS_OPERATIONAL_VIEW',
    label: 'BRD 18.4 Operational Reports (productivity, SLA breach, parts consumption)',
    module: 'Reports',
    defaultRoles: [RoleName.TECHNICAL_TEAM_LEADER],
    migrated: true,
  },
  {
    key: 'REPORTS_QUALITY_VIEW',
    label: 'BRD 18.3 Quality Reports (product failure, repeat complaints, RWR analysis)',
    module: 'Reports',
    defaultRoles: [RoleName.TECHNICAL_TEAM_LEADER],
    migrated: true,
  },
  {
    key: 'REPORTS_FINANCE_VIEW',
    label: 'BRD 18.2 Finance Dashboard (revenue/profit summary, aging, GP by centre)',
    module: 'Reports',
    defaultRoles: [RoleName.ACCOUNTANT, RoleName.FINANCE_MANAGER],
    migrated: true,
  },

  // --- Technician --- replaces TECHNICIAN_VISIT_ROLES on technician.controller.ts and
  // GANTT_ROLES on technician-schedule.controller.ts (2026-09-10). Two capabilities, not
  // one: the mobile self-service visit flow (field technician + supervisory roles) and the
  // planning Gantt board (supervisory roles only, no TECHNICIAN_FIELD) are genuinely
  // different audiences today.
  {
    key: 'TECHNICIAN_VISIT',
    label: "Mobile on-site visit flow: start visit, capture S/N & fault, request spare, complete (field technician self-service)",
    module: 'Technician',
    defaultRoles: [RoleName.TECHNICAL_TEAM_LEADER, RoleName.TECHNICIAN_FIELD],
    migrated: true,
  },
  {
    key: 'TECHNICIAN_SCHEDULE_GANTT',
    label: 'View a technician planning board - the original combined Gantt, or its two split successors (Workshop Queue, Field Technician Schedule)',
    module: 'Technician',
    defaultRoles: [RoleName.TECHNICAL_TEAM_LEADER],
    migrated: true,
  },
  {
    key: 'FIELD_SCHEDULE_REORDER',
    label: 'Drag-reorder a field technician\'s day on the Field Technician Schedule board (priority only, never the promised appointment time)',
    module: 'Technician',
    defaultRoles: [RoleName.CCE, RoleName.TECHNICAL_TEAM_LEADER],
    migrated: true,
  },

  // --- GL Ledger --- replaces FINANCE_ROLES on gl-ledger.controller.ts (2026-09-10). Own
  // capability, not shared with AMC's AMC_BILLING or Debit Notes' DEBIT_NOTES_MANAGE below -
  // each finance-adjacent module's FINANCE_ROLES const was independently declared, and keys
  // must stay globally unique in this catalog.
  {
    key: 'GL_LEDGER_VIEW',
    label: 'View GL postings (system-generated only, no manual entry exists)',
    module: 'GL Ledger',
    defaultRoles: [RoleName.ACCOUNTANT, RoleName.FINANCE_MANAGER],
    migrated: true,
  },

  // --- Debit Notes --- replaces FINANCE_ROLES on debit-notes.controller.ts (2026-09-10).
  // One capability for browse + the GL-posting action (post()) - verified symmetric on
  // SUPER_ADMIN/SERVICE_HEAD, unlike Warranty Claims' credit-note posting.
  {
    key: 'DEBIT_NOTES_MANAGE',
    label: 'View Debit Notes & recharge report, post a DRAFT Debit Note to GL',
    module: 'Debit Notes',
    defaultRoles: [RoleName.ACCOUNTANT, RoleName.FINANCE_MANAGER],
    migrated: true,
  },

  // --- Master Data --- replaces 12 of the 13 inline @Roles() literals on
  // master-data.controller.ts (2026-09-10), one capability per distinct role membership /
  // entity-type admin action, matching the controller's own entity-type sectioning.
  // deleteServiceCentre's @Roles('SUPER_ADMIN') is deliberately absent - asymmetric (no
  // SERVICE_HEAD), see the controller's own comment.
  {
    key: 'MASTER_DATA_SERVICE_CENTRE_CREATE',
    label: 'Create a service centre',
    module: 'Master Data',
    defaultRoles: [RoleName.CCE],
    migrated: true,
  },
  {
    key: 'MASTER_DATA_SERVICE_CENTRE_UPDATE',
    label: 'Update a service centre',
    module: 'Master Data',
    defaultRoles: [],
    migrated: true,
  },
  {
    key: 'MASTER_DATA_FAULT_SYMPTOM_MANAGE',
    label: 'Create a fault/symptom code',
    module: 'Master Data',
    defaultRoles: [RoleName.CCE, RoleName.TECHNICAL_TEAM_LEADER],
    migrated: true,
  },
  {
    key: 'MASTER_DATA_SPARE_PARTS_MANAGE',
    label: 'Create a spare part, link it to a model, or create a spare part model',
    module: 'Master Data',
    defaultRoles: [RoleName.WAREHOUSE_CLERK],
    migrated: true,
  },
  {
    key: 'MASTER_DATA_PRICE_LIST_MANAGE',
    label: 'Create a service price list entry',
    module: 'Master Data',
    defaultRoles: [RoleName.FINANCE_MANAGER],
    migrated: true,
  },
  {
    key: 'MASTER_DATA_KPI_RULE_MANAGE',
    label: 'Create a technician KPI rule',
    module: 'Master Data',
    defaultRoles: [],
    migrated: true,
  },
  {
    key: 'MASTER_DATA_NOTIFICATION_TEMPLATE_MANAGE',
    label: 'Create a notification template',
    module: 'Master Data',
    defaultRoles: [],
    migrated: true,
  },
  {
    key: 'MASTER_DATA_WARRANTY_MASTER_MANAGE',
    label: 'Create a warranty master entry',
    module: 'Master Data',
    defaultRoles: [RoleName.WARRANTY_CLERK],
    migrated: true,
  },
  {
    key: 'MASTER_DATA_COMPONENT_YIELD_MANAGE',
    label: 'Create a component yield matrix entry',
    module: 'Master Data',
    defaultRoles: [],
    migrated: true,
  },
  {
    key: 'MASTER_DATA_BULK_IMPORT',
    label: 'Bulk import master data from CSV/Excel',
    module: 'Master Data',
    defaultRoles: [],
    migrated: true,
  },

  // --- Estimates --- replaces ESTIMATE_ROLES/ESTIMATE_APPROVAL_ROLES on
  // estimates.controller.ts (2026-09-10). Kept as 2 capabilities even though today's
  // membership is identical - the controller's own comment deliberately keeps them separate
  // constants so the business can extend who takes approval calls (e.g. a future "Estimate
  // Desk" role) without touching general Estimate management.
  {
    key: 'ESTIMATE_MANAGE',
    label: 'Create, send & revise an Estimate',
    module: 'Estimates',
    defaultRoles: [RoleName.TECHNICAL_TEAM_LEADER, RoleName.CCE],
    migrated: true,
  },
  {
    key: 'ESTIMATE_RECORD_RESPONSE',
    label: "Record a customer's Estimate decision taken by phone/WhatsApp/email",
    module: 'Estimates',
    defaultRoles: [RoleName.TECHNICAL_TEAM_LEADER, RoleName.CCE],
    migrated: true,
  },
];

export function getMigratedCapability(key: string): CapabilityDefinition | undefined {
  return CAPABILITY_CATALOG.find((c) => c.key === key && c.migrated);
}
