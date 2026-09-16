// Mirrors src/dashboard/dashboard.service.ts's response shapes on the backend. Each widget
// key is present only if the caller holds that widget's DASHBOARD_WIDGET_* capability - see
// that file's own doc comment. A key simply being absent (not null, not an empty shape) is
// how the frontend knows not to render that widget at all.

export interface JobsByStatusWidget {
  columns: { key: string; label: string; count: number }[];
  totalActiveJobs: number;
}

export interface WorkshopQueueWidget {
  technicians: { id: string; name: string; activeCount: number; capacity: number; overCapacity: boolean }[];
  totalActive: number;
  unassignedCount: number;
}

export interface SlaBreachWidget {
  asOf: string;
  thresholdHours: number;
  breachedCount: number;
  topItems: { jobCardId: string; jobCardNumber: string; hoursOverThreshold: number }[];
}

export interface SpareConsumptionWidget {
  topByQuantity: { sparePartId: string; code: string; name: string; totalQuantity: number }[];
  topByValue: { sparePartId: string; code: string; name: string; totalValue: number }[];
}

export interface AmcStatusWidget {
  activeCount: number;
  expiringSoonCount: number;
  expiringSoonWithinDays: number;
  upsellCandidatesCount: number;
}

export interface DeliveryInvoicingWidget {
  readyForDeliveryCount: number;
  b2bOutstandingAmount: number;
}

export interface FinanceSummaryWidget {
  totalServiceRevenue: number;
  totalAmcRevenue: number;
  activeAmcContracts: number;
}

export interface DashboardOverviewResponse {
  widgets: {
    jobsByStatus?: JobsByStatusWidget;
    workshopQueue?: WorkshopQueueWidget;
    slaBreach?: SlaBreachWidget;
    spareConsumption?: SpareConsumptionWidget;
    amcStatus?: AmcStatusWidget;
    deliveryInvoicing?: DeliveryInvoicingWidget;
    financeSummary?: FinanceSummaryWidget;
  };
}
