// Shapes mirror src/reports/reports.service.ts exactly (Frontend Phase 12, the last
// frontend phase - BRD 18.1 "Service Manager Dashboard" / FR-20 / NFR-02). This is the
// first purely read-only module in the app - no create/update/delete anywhere, so there's
// no per-action role fragmentation to collapse the way amcPermissions()/
// dismantlingPermissions() did for earlier phases. There's exactly one gate: can this
// user see the page at all.
//
// VIEW_ROLES is copied verbatim from reports.controller.ts/reports.gateway.ts - notably
// narrower than every other module's view list in this app (no ACCOUNTANT/FINANCE_MANAGER
// at all; this is an ops board, not a finance one).
export const REPORTS_VIEW_ROLES = ['SERVICE_HEAD', 'SUPER_ADMIN', 'TECHNICAL_TEAM_LEADER'];

export function canViewReports(roleName: string | undefined): boolean {
  return !!roleName && REPORTS_VIEW_ROLES.includes(roleName);
}

// ---------------------------------------------------------------------------------------
// Kanban board (BRD 18.1 Job Status Board)
// ---------------------------------------------------------------------------------------

export const KANBAN_COLUMNS = [
  'SCHEDULED',
  'ON_SITE',
  'WIP',
  'SPARE_PENDING',
  'APPROVAL_PENDING',
  'QC_COMPLETED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
] as const;
export type KanbanColumnValue = (typeof KANBAN_COLUMNS)[number];

export interface KanbanCard {
  jobCardId: string;
  jobCardNumber: string;
  status: string;
  section: string | null;
  serialNumber: string;
  brand: string | null;
  warrantyStatus: string;
  deliveryNumber: string | null;
  updatedAt: string;
}

export interface KanbanColumnData {
  key: KanbanColumnValue;
  label: string;
  count: number;
  jobCards: KanbanCard[];
}

export interface KanbanBoard {
  asOf: string;
  columns: KanbanColumnData[];
  totalActiveJobs: number;
}

export interface KanbanSummaryColumn {
  key: KanbanColumnValue;
  label: string;
  count: number;
}

export interface KanbanSummary {
  asOf: string;
  columns: KanbanSummaryColumn[];
  totalActiveJobs: number;
}

// ---------------------------------------------------------------------------------------
// Approval aging (BRD 18.1 Pending Approval Aging - red alert past 4hrs)
// ---------------------------------------------------------------------------------------

export interface ApprovalAgingItem {
  estimateId: string;
  jobCardId: string;
  jobCardNumber: string;
  sentAt: string;
  ageHours: number;
  breached: boolean;
}

export interface ApprovalAgingReport {
  asOf: string;
  thresholdHours: number;
  breachedCount: number;
  items: ApprovalAgingItem[];
}

// ---------------------------------------------------------------------------------------
// Service efficiency (BRD 18.1 - avg Login-to-QC-Completed time)
// ---------------------------------------------------------------------------------------

export interface ServiceEfficiencyRow {
  key: string;
  label: string;
  jobCount: number;
  avgHours: number;
}

export interface ServiceEfficiencyReport {
  asOf: string;
  overallAvgHours: number | null;
  sampleSize: number;
  byTechnician: ServiceEfficiencyRow[];
  byCategory: ServiceEfficiencyRow[];
}

// ---------------------------------------------------------------------------------------
// First-time fix rate (BRD 18.1)
// ---------------------------------------------------------------------------------------

export interface FirstTimeFixRateReport {
  asOf: string;
  totalCompletedJobs: number;
  onSiteOnlyCompletedJobs: number;
  rate: number | null;
}

// ---------------------------------------------------------------------------------------
// Combined overview payload (initial page load)
// ---------------------------------------------------------------------------------------

export interface DashboardOverview {
  asOf: string;
  kanbanSummary: KanbanSummary;
  approvalAging: { breachedCount: number; oldestAgeHours: number | null };
  firstTimeFixRate: FirstTimeFixRateReport;
  serviceEfficiency: { overallAvgHours: number | null; sampleSize: number };
}

// ---------------------------------------------------------------------------------------
// WebSocket connection status - the-fool pre-mortem findings #1/#2: a "live" dashboard
// that goes silently stale after a dropped connection is worse than no live dashboard at
// all, so the UI always shows one of these rather than letting staleness look like calm.
// ---------------------------------------------------------------------------------------

export type ReportsConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

// the-fool finding #3: every report card shows exactly when its own data is from, using
// the backend's own `asOf` timestamp rather than implying instant-push freshness. Kept as
// a shared helper (not inlined per-card) so every card renders the same "as of HH:MM:SS"
// wording.
export function formatAsOf(asOf: string | undefined): string {
  if (!asOf) return '—';
  return `as of ${new Date(asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}
