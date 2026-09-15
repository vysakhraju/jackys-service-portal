import { api } from './api';
import type { DashboardOverviewResponse } from './dashboardTypes';

export async function getDashboardOverview(): Promise<DashboardOverviewResponse> {
  const res = await api.get<DashboardOverviewResponse>('/dashboard/overview');
  return res.data;
}
