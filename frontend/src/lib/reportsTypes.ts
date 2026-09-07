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

// =========================================================================================
// BRD 18.2/18.3/18.4 - Finance/Quality/Operational reports (Frontend Phase 14). Shapes
// mirror src/reports/{finance,quality,operational}-reports.service.ts exactly. Same
// "purely read-only, one gate per page" shape as 18.1 above - three separate role lists,
// though, not one: Finance is finance-department-flavoured (ACCOUNTANT/FINANCE_MANAGER
// join SERVICE_HEAD/SUPER_ADMIN), Quality and Operational both reuse REPORTS_VIEW_ROLES
// verbatim (same operational-leadership audience as the Live Board, copied from
// quality-reports.controller.ts/operational-reports.controller.ts).
//
// A number typed `number | null` below means the backend genuinely has no data to compute
// it from (see each service's own doc comment for why) - always render "—", never a
// fabricated 0. Dates arrive over HTTP as ISO strings, not `Date` instances - typed as
// `string` here to match the wire shape, same as KanbanCard.updatedAt above.
// =========================================================================================

export const FINANCE_REPORTS_VIEW_ROLES = ['ACCOUNTANT', 'FINANCE_MANAGER', 'SERVICE_HEAD', 'SUPER_ADMIN'];

export function canViewFinanceReports(roleName: string | undefined): boolean {
  return !!roleName && FINANCE_REPORTS_VIEW_ROLES.includes(roleName);
}

// ---------------------------------------------------------------------------------------
// Finance summary (BRD 18.2)
// ---------------------------------------------------------------------------------------

export interface RevenueSummary {
  totalServiceRevenue: number;
  totalLabourRevenue: number | null;
  totalSparePartsRevenue: number | null;
  totalAmcRevenue: number;
}

export interface CostSummary {
  totalLabourCost: number | null;
  totalSparePartsCost: number | null;
  totalAmcCost: number | null;
  totalCOGS: number | null;
}

export interface ProfitSummary {
  grossProfit: number | null;
  grossProfitMarginPct: number | null;
}

export interface OowSection {
  totalOowRevenue: number;
  totalLabourRevenueOow: null;
  totalLabourCostOow: null;
  labourProfitOow: null;
  totalSpareRevenueOow: null;
  totalSpareCostOow: null;
  spareProfitOow: null;
  totalOowProfit: null;
  oowMarginPct: null;
  note: string;
}

export interface WarrantySection {
  totalSpareCostIw: number;
  totalLabourCostIw: number;
  totalWarrantyCost: number;
  amountClaimedFromSuppliers: number;
  amountReceived: number;
  recoveryRatePct: number | null;
}

export interface AmcFinanceSection {
  totalAmcRevenue: number;
  totalAmcLabourCost: null;
  totalAmcSpareCost: null;
  amcGrossProfit: null;
  amcMarginPct: null;
  activeContractsCount: number;
  costTrackingNote: string;
}

export interface FinanceSummary {
  periodStart: string | null;
  periodEnd: string | null;
  periodBasis: Record<string, string>;
  revenueSummary: RevenueSummary;
  costSummary: CostSummary;
  profitSummary: ProfitSummary;
  oow: OowSection;
  warranty: WarrantySection;
  amc: AmcFinanceSection;
}

// ---------------------------------------------------------------------------------------
// GP by Service Centre / Interdepartment Recharge / Unpaid Invoices / Profit Trend (18.2)
// ---------------------------------------------------------------------------------------

export interface GpByServiceCentreRow {
  serviceCentreId: string;
  serviceCentreName: string;
  oowRevenue: number;
  iwRechargeRevenue: number;
  iwLabourCost: number;
  amcRevenue: number;
  grossProfit: null;
  gpMarginPct: null;
}

export interface InterdepartmentRechargeRow {
  salesChannelName: string;
  jobCount: number;
  sparePartsCostInternal: number;
  labourCostInternal: number;
  totalDebitNoteAmount: number;
  pendingCount: number;
  postedToGlCount: number;
}

export interface UnpaidInvoiceItem {
  jobCardId: string;
  jobCardNumber: string;
  customerName: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  amountDue: number;
  agingBucket: '0-2 days' | '3-7 days' | '8+ days';
}

export interface UnpaidInvoicesReport {
  asOf: string;
  b2b: UnpaidInvoiceItem[];
  b2c: UnpaidInvoiceItem[];
  note: string;
}

export interface ProfitTrendPoint {
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  oowRevenue: number;
  iwRechargeRevenue: number;
  amcRevenue: number;
  iwCost: number;
  iwGrossProfit: number;
  totalCOGS: null;
  totalGrossProfit: null;
  gpMarginPct: null;
}

// ---------------------------------------------------------------------------------------
// Quality / Product dashboard (BRD 18.3, AC-22/23/24) - same role list as the Live Board.
// ---------------------------------------------------------------------------------------

export interface ProductFailureRatioRow {
  periodLabel: string;
  model: string;
  brand: string;
  count: number;
}

export interface RepeatComplaintItem {
  serialNumber: string;
  totalJobCount: number;
  repeatWithin30Days: boolean;
  jobCardNumbers: string[];
  minGapDays: number | null;
}

export interface RwrAnalysisRow {
  model: string;
  reason: string;
  region: string;
  count: number;
}

// ---------------------------------------------------------------------------------------
// Operational reports (BRD 18.4) - same role list as the Live Board.
// ---------------------------------------------------------------------------------------

export interface TechnicianProductivityRow {
  technicianId: string;
  technicianName: string;
  jobsCompleted: number;
  avgHoursLoginToQc: number | null;
  onTimeArrivalPct: number | null;
}

export interface TechnicianProductivityReport {
  asOf: string;
  periodStart: string | null;
  periodEnd: string | null;
  rows: TechnicianProductivityRow[];
  note: string;
}

export interface SlaBreachItem {
  jobCardId: string;
  jobCardNumber: string;
  createdAt: string;
  qcApprovedAt: string;
  hoursElapsed: number;
  hoursOverThreshold: number;
}

export interface SlaBreachReport {
  asOf: string;
  thresholdHours: number;
  breachedCount: number;
  items: SlaBreachItem[];
}

export interface SpareConsumptionEntry {
  sparePartId: string;
  code: string;
  name: string;
  totalQuantity: number;
  totalValue: number;
}

export interface SpareConsumptionByGroup {
  key: string;
  totalQuantity: number;
  totalValue: number;
}

export interface SpareConsumptionReport {
  periodStart: string | null;
  periodEnd: string | null;
  topByQuantity: SpareConsumptionEntry[];
  topByValue: SpareConsumptionEntry[];
  byModel: SpareConsumptionByGroup[];
  byWarrantyStatus: SpareConsumptionByGroup[];
}

// Shared helper: renders a nullable AED amount consistently ("—" rather than "AED 0.00"
// for a genuinely-unknown figure, the same distinction every finance service's own doc
// comments insist on server-side - the UI must not quietly undo that by defaulting to 0).
export function formatAedOrDash(amount: number | null | undefined): string {
  return amount === null || amount === undefined ? '—' : `AED ${amount.toFixed(2)}`;
}

export function formatPctOrDash(pct: number | null | undefined): string {
  return pct === null || pct === undefined ? '—' : `${pct.toFixed(1)}%`;
}
