import { api } from './api';
import type {
  ApprovalAgingReport,
  DashboardOverview,
  FinanceSummary,
  FirstTimeFixRateReport,
  GpByServiceCentreRow,
  InterdepartmentRechargeRow,
  KanbanBoard,
  KanbanSummary,
  ProductFailureRatioRow,
  ProfitTrendPoint,
  RepeatComplaintItem,
  RwrAnalysisRow,
  ServiceEfficiencyReport,
  SlaBreachReport,
  SpareConsumptionReport,
  TechnicianProductivityReport,
  UnpaidInvoicesReport,
} from './reportsTypes';

export async function getDashboardOverview(): Promise<DashboardOverview> {
  const res = await api.get<DashboardOverview>('/reports/dashboard/overview');
  return res.data;
}

export async function getKanbanBoard(): Promise<KanbanBoard> {
  const res = await api.get<KanbanBoard>('/reports/dashboard/kanban');
  return res.data;
}

export async function getKanbanSummary(): Promise<KanbanSummary> {
  const res = await api.get<KanbanSummary>('/reports/dashboard/kanban/summary');
  return res.data;
}

export async function getApprovalAging(): Promise<ApprovalAgingReport> {
  const res = await api.get<ApprovalAgingReport>('/reports/dashboard/approval-aging');
  return res.data;
}

export async function getServiceEfficiency(): Promise<ServiceEfficiencyReport> {
  const res = await api.get<ServiceEfficiencyReport>('/reports/dashboard/service-efficiency');
  return res.data;
}

export async function getFirstTimeFixRate(): Promise<FirstTimeFixRateReport> {
  const res = await api.get<FirstTimeFixRateReport>('/reports/dashboard/first-time-fix-rate');
  return res.data;
}

// ---------------------------------------------------------------------------------------
// BRD 18.2 Finance reports
// ---------------------------------------------------------------------------------------

export interface PeriodFilter {
  periodStart?: string;
  periodEnd?: string;
}

export async function getFinanceSummary(filter: PeriodFilter = {}): Promise<FinanceSummary> {
  const res = await api.get<FinanceSummary>('/reports/finance/summary', { params: filter });
  return res.data;
}

export async function getGpByServiceCentre(filter: PeriodFilter = {}): Promise<GpByServiceCentreRow[]> {
  const res = await api.get<GpByServiceCentreRow[]>('/reports/finance/gp-by-service-centre', { params: filter });
  return res.data;
}

export async function getInterdepartmentRecharge(filter: PeriodFilter = {}): Promise<InterdepartmentRechargeRow[]> {
  const res = await api.get<InterdepartmentRechargeRow[]>('/reports/finance/interdepartment-recharge', { params: filter });
  return res.data;
}

export async function getUnpaidInvoices(): Promise<UnpaidInvoicesReport> {
  const res = await api.get<UnpaidInvoicesReport>('/reports/finance/unpaid-invoices');
  return res.data;
}

export async function getProfitTrend(
  groupBy: 'week' | 'month' | 'quarter',
  filter: PeriodFilter = {},
): Promise<ProfitTrendPoint[]> {
  const res = await api.get<ProfitTrendPoint[]>('/reports/finance/profit-trend', { params: { groupBy, ...filter } });
  return res.data;
}

// ---------------------------------------------------------------------------------------
// BRD 18.3 Quality / Product reports
// ---------------------------------------------------------------------------------------

export interface ProductFailureRatioFilter extends PeriodFilter {
  brand?: string;
  modelNumber?: string;
  faultCode?: string;
  groupBy?: 'month' | 'quarter' | 'year';
}

export async function getProductFailureRatio(filter: ProductFailureRatioFilter = {}): Promise<ProductFailureRatioRow[]> {
  const res = await api.get<ProductFailureRatioRow[]>('/reports/quality/product-failure-ratio', { params: filter });
  return res.data;
}

export async function getRepeatComplaints(): Promise<RepeatComplaintItem[]> {
  const res = await api.get<RepeatComplaintItem[]>('/reports/quality/repeat-complaints');
  return res.data;
}

export async function getRwrAnalysis(filter: PeriodFilter = {}): Promise<RwrAnalysisRow[]> {
  const res = await api.get<RwrAnalysisRow[]>('/reports/quality/rwr-analysis', { params: filter });
  return res.data;
}

// ---------------------------------------------------------------------------------------
// BRD 18.4 Operational reports
// ---------------------------------------------------------------------------------------

export async function getTechnicianProductivity(filter: PeriodFilter = {}): Promise<TechnicianProductivityReport> {
  const res = await api.get<TechnicianProductivityReport>('/reports/operational/technician-productivity', { params: filter });
  return res.data;
}

export async function getSlaBreach(thresholdHours?: number): Promise<SlaBreachReport> {
  const res = await api.get<SlaBreachReport>('/reports/operational/sla-breach', {
    params: thresholdHours ? { thresholdHours } : {},
  });
  return res.data;
}

export async function getSpareConsumption(filter: PeriodFilter = {}): Promise<SpareConsumptionReport> {
  const res = await api.get<SpareConsumptionReport>('/reports/operational/spare-parts-consumption', { params: filter });
  return res.data;
}
