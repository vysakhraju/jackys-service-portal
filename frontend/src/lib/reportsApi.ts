import { api } from './api';
import type {
  ApprovalAgingReport,
  DashboardOverview,
  FirstTimeFixRateReport,
  KanbanBoard,
  KanbanSummary,
  ServiceEfficiencyReport,
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
