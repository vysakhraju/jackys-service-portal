import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorNotice } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { useAuth } from '../../lib/auth';
import {
  getFinanceSummary,
  getGpByServiceCentre,
  getInterdepartmentRecharge,
  getProfitTrend,
  getUnpaidInvoices,
  type PeriodFilter,
} from '../../lib/reportsApi';
import {
  canViewFinanceReports,
  formatAedOrDash,
  formatAsOf,
  formatPctOrDash,
  type GpByServiceCentreRow,
  type InterdepartmentRechargeRow,
  type ProfitTrendPoint,
  type UnpaidInvoiceItem,
} from '../../lib/reportsTypes';

// BRD 18.2 Finance Dashboard, built alongside 18.3/18.4 in the same Frontend Phase 14 -
// see finance-reports.service.ts's own class doc for the five the-fool pre-mortem findings
// this page inherits and must not silently undo: no blended "Total Company Revenue"
// (OOW/IW-recharge/AMC always shown as separate streams); OOW cost is always "—", never
// ServicePriceList.warrantyLaborCost (an internal transfer-pricing rate, not a market
// estimate); every derived COGS/Gross Profit/GP Margin cascades "—", never a fabricated
// 0-cost margin; Interdepartment Recharge settlement reads "Pending"/"Posted to GL", never
// "Settled"; Unpaid Invoices splits B2B/B2C rather than blending them. formatAedOrDash()/
// formatPctOrDash() are the one place that "—" rule is enforced, so no widget below ever
// hand-rolls its own `?? 0` fallback.
export function FinanceReportsPage() {
  const { user } = useAuth();
  const canView = canViewFinanceReports(user?.role.name);

  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [trendGroupBy, setTrendGroupBy] = useState<'week' | 'month' | 'quarter'>('month');

  const filter: PeriodFilter = {
    periodStart: periodStart || undefined,
    periodEnd: periodEnd || undefined,
  };

  const summaryQuery = useQuery({
    queryKey: ['reports', 'finance', 'summary', filter],
    queryFn: () => getFinanceSummary(filter),
    enabled: canView,
  });
  const gpQuery = useQuery({
    queryKey: ['reports', 'finance', 'gp-by-service-centre', filter],
    queryFn: () => getGpByServiceCentre(filter),
    enabled: canView,
  });
  const rechargeQuery = useQuery({
    queryKey: ['reports', 'finance', 'interdepartment-recharge', filter],
    queryFn: () => getInterdepartmentRecharge(filter),
    enabled: canView,
  });
  const unpaidQuery = useQuery({
    queryKey: ['reports', 'finance', 'unpaid-invoices'],
    queryFn: getUnpaidInvoices,
    enabled: canView,
  });
  const trendQuery = useQuery({
    queryKey: ['reports', 'finance', 'profit-trend', trendGroupBy, filter],
    queryFn: () => getProfitTrend(trendGroupBy, filter),
    enabled: canView,
  });

  if (!canView) {
    return (
      <div className="px-8 py-6">
        <p className="max-w-2xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          The Finance dashboard is restricted to Accountant / Finance Manager / Service
          Head / Super Admin - every endpoint behind it is role-gated server-side too.
        </p>
      </div>
    );
  }

  const summary = summaryQuery.data;

  return (
    <div className="space-y-6 px-8 py-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Reports &amp; Dashboards</p>
        <h1 className="mt-0.5 text-xl font-semibold text-slate-900">BRD 18.2 Finance Dashboard</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Revenue, cost, and profit are always shown as three separate streams - OOW,
          IW/warranty recharge, and AMC - never blended into one company-wide figure, since
          nothing in this app can safely combine them without risking double-counting.
          Fields marked "—" have no computable data behind them (not a zero) - see each
          card's note for why.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-white p-4">
        <Field label="Period start" hint="Leave blank for all-time">
          <input type="date" className={`${inputClass} w-40`} value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </Field>
        <Field label="Period end" hint="Leave blank for all-time">
          <input type="date" className={`${inputClass} w-40`} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </Field>
        <p className="pb-2 text-xs text-slate-400">Applies to Summary, GP by Centre, and Interdepartment Recharge below.</p>
      </div>

      <ErrorNotice error={summaryQuery.error} />

      {summary && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <SummaryCard
              title="Revenue (separate streams)"
              rows={[
                ['OOW service revenue', formatAedOrDash(summary.revenueSummary.totalServiceRevenue)],
                ['OOW labour revenue', formatAedOrDash(summary.revenueSummary.totalLabourRevenue)],
                ['OOW spare parts revenue', formatAedOrDash(summary.revenueSummary.totalSparePartsRevenue)],
                ['AMC revenue', formatAedOrDash(summary.revenueSummary.totalAmcRevenue)],
              ]}
            />
            <SummaryCard
              title="Cost"
              rows={[
                ['Labour cost', formatAedOrDash(summary.costSummary.totalLabourCost)],
                ['Spare parts cost', formatAedOrDash(summary.costSummary.totalSparePartsCost)],
                ['AMC cost', formatAedOrDash(summary.costSummary.totalAmcCost)],
                ['Total COGS', formatAedOrDash(summary.costSummary.totalCOGS)],
              ]}
            />
            <SummaryCard
              title="Profit"
              rows={[
                ['Gross profit', formatAedOrDash(summary.profitSummary.grossProfit)],
                ['GP margin %', formatPctOrDash(summary.profitSummary.grossProfitMarginPct)],
              ]}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <SummaryCard title="OOW" rows={[['Total OOW revenue', formatAedOrDash(summary.oow.totalOowRevenue)]]} note={summary.oow.note} />
            <SummaryCard
              title="Warranty (IW) recovery"
              rows={[
                ['Total warranty cost', formatAedOrDash(summary.warranty.totalWarrantyCost)],
                ['Claimed from suppliers', formatAedOrDash(summary.warranty.amountClaimedFromSuppliers)],
                ['Received', formatAedOrDash(summary.warranty.amountReceived)],
                ['Recovery rate %', formatPctOrDash(summary.warranty.recoveryRatePct)],
              ]}
            />
            <SummaryCard
              title="AMC"
              rows={[
                ['AMC revenue', formatAedOrDash(summary.amc.totalAmcRevenue)],
                ['Active contracts', String(summary.amc.activeContractsCount)],
              ]}
              note={summary.amc.costTrackingNote}
            />
          </div>
        </div>
      )}

      <ReportSection title="GP by Service Centre" error={gpQuery.error} isLoading={gpQuery.isLoading}>
        <GpByServiceCentreTable rows={gpQuery.data} />
      </ReportSection>

      <ReportSection title="Interdepartment Recharge (AC-16)" error={rechargeQuery.error} isLoading={rechargeQuery.isLoading}>
        <InterdepartmentRechargeTable rows={rechargeQuery.data} />
      </ReportSection>

      <ReportSection title="Unpaid Invoices (OOW)" error={unpaidQuery.error} isLoading={unpaidQuery.isLoading}>
        {unpaidQuery.data && (
          <>
            <p className="mb-3 text-xs text-slate-400">{formatAsOf(unpaidQuery.data.asOf)} — {unpaidQuery.data.note}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <UnpaidInvoicesGroup label="B2B" items={unpaidQuery.data.b2b} />
              <UnpaidInvoicesGroup label="B2C" items={unpaidQuery.data.b2c} />
            </div>
          </>
        )}
      </ReportSection>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-800">Profit Trend</h2>
          <Field label="Group by">
            <select
              className={`${inputClass} w-32`}
              value={trendGroupBy}
              onChange={(e) => setTrendGroupBy(e.target.value as 'week' | 'month' | 'quarter')}
            >
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
            </select>
          </Field>
        </div>
        <ErrorNotice error={trendQuery.error} />
        <ProfitTrendTable rows={trendQuery.data} isLoading={trendQuery.isLoading} />
      </div>
    </div>
  );
}

function SummaryCard({ title, rows, note }: { title: string; rows: [string, string][]; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{title}</p>
      <dl className="mt-2 space-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between text-sm">
            <dt className="text-slate-500">{label}</dt>
            <dd className="font-medium tabular-nums text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="mt-2 text-xs text-slate-400">{note}</p>}
    </div>
  );
}

function ReportSection({
  title,
  isLoading,
  error,
  children,
}: {
  title: string;
  isLoading: boolean;
  error: unknown;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">{title}</h2>
      {isLoading ? <p className="text-sm text-slate-400">Loading…</p> : <ErrorNotice error={error} />}
      {!isLoading && !error && children}
    </div>
  );
}

function GpByServiceCentreTable({ rows }: { rows: GpByServiceCentreRow[] | undefined }) {
  if (!rows || rows.length === 0) return <p className="text-sm text-slate-400">Nothing in this period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {['Service Centre', 'OOW Revenue', 'IW Recharge Revenue', 'IW Labour Cost', 'AMC Revenue', 'Gross Profit', 'GP Margin %'].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium text-slate-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.serviceCentreId} className="hover:bg-slate-50">
              <td className="px-3 py-2 text-slate-700">{row.serviceCentreName}</td>
              <td className="px-3 py-2 tabular-nums text-slate-700">{formatAedOrDash(row.oowRevenue)}</td>
              <td className="px-3 py-2 tabular-nums text-slate-700">{formatAedOrDash(row.iwRechargeRevenue)}</td>
              <td className="px-3 py-2 tabular-nums text-slate-700">{formatAedOrDash(row.iwLabourCost)}</td>
              <td className="px-3 py-2 tabular-nums text-slate-700">{formatAedOrDash(row.amcRevenue)}</td>
              <td className="px-3 py-2 tabular-nums text-slate-400">{formatAedOrDash(row.grossProfit)}</td>
              <td className="px-3 py-2 tabular-nums text-slate-400">{formatPctOrDash(row.gpMarginPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InterdepartmentRechargeTable({ rows }: { rows: InterdepartmentRechargeRow[] | undefined }) {
  if (!rows || rows.length === 0) return <p className="text-sm text-slate-400">Nothing in this period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {['Sales Channel', 'Jobs', 'Spares Cost', 'Labour Cost', 'Debit Note Total', 'Pending', 'Posted to GL'].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium text-slate-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.salesChannelName} className="hover:bg-slate-50">
              <td className="px-3 py-2 text-slate-700">{row.salesChannelName}</td>
              <td className="px-3 py-2 tabular-nums text-slate-700">{row.jobCount}</td>
              <td className="px-3 py-2 tabular-nums text-slate-700">{formatAedOrDash(row.sparePartsCostInternal)}</td>
              <td className="px-3 py-2 tabular-nums text-slate-700">{formatAedOrDash(row.labourCostInternal)}</td>
              <td className="px-3 py-2 tabular-nums text-slate-700">{formatAedOrDash(row.totalDebitNoteAmount)}</td>
              <td className="px-3 py-2 tabular-nums text-amber-600">{row.pendingCount}</td>
              <td className="px-3 py-2 tabular-nums text-emerald-600">{row.postedToGlCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UnpaidInvoicesGroup({ label, items }: { label: string; items: UnpaidInvoiceItem[] }) {
  const total = items.reduce((sum, i) => sum + Number(i.amountDue), 0);
  return (
    <div className="rounded-md border border-slate-100 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-800">{label}</p>
        <p className="text-sm font-medium tabular-nums text-slate-600">{formatAedOrDash(total)}</p>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">Nothing unpaid.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 border-t border-slate-100">
          {items.map((inv) => (
            <li key={inv.invoiceId} className="flex items-center justify-between py-1.5 text-xs">
              <span className="text-slate-700">
                {inv.invoiceNumber} <span className="text-slate-400">({inv.customerName})</span>
              </span>
              <span className="flex items-center gap-2">
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    inv.agingBucket === '8+ days' ? 'bg-red-50 text-red-700' : inv.agingBucket === '3-7 days' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {inv.agingBucket}
                </span>
                <span className="tabular-nums text-slate-500">{formatAedOrDash(inv.amountDue)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProfitTrendTable({ rows, isLoading }: { rows: ProfitTrendPoint[] | undefined; isLoading: boolean }) {
  if (isLoading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (!rows || rows.length === 0) return <p className="text-sm text-slate-400">Nothing in this period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {['Period', 'OOW Revenue', 'IW Recharge Revenue', 'AMC Revenue', 'IW Cost', 'IW Gross Profit', 'Total GP Margin %'].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium text-slate-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.periodLabel} className="hover:bg-slate-50">
              <td className="px-3 py-2 text-slate-700">{row.periodLabel}</td>
              <td className="px-3 py-2 tabular-nums text-slate-700">{formatAedOrDash(row.oowRevenue)}</td>
              <td className="px-3 py-2 tabular-nums text-slate-700">{formatAedOrDash(row.iwRechargeRevenue)}</td>
              <td className="px-3 py-2 tabular-nums text-slate-700">{formatAedOrDash(row.amcRevenue)}</td>
              <td className="px-3 py-2 tabular-nums text-slate-700">{formatAedOrDash(row.iwCost)}</td>
              <td className="px-3 py-2 tabular-nums text-slate-700">{formatAedOrDash(row.iwGrossProfit)}</td>
              <td className="px-3 py-2 tabular-nums text-slate-400">{formatPctOrDash(row.gpMarginPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
