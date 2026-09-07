import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorNotice } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { useAuth } from '../../lib/auth';
import { getSlaBreach, getSpareConsumption, getTechnicianProductivity } from '../../lib/reportsApi';
import { canViewReports, formatAedOrDash, formatAsOf, formatPctOrDash } from '../../lib/reportsTypes';

const DEFAULT_SLA_HOURS = 48;

// BRD 18.4 Operational Reports. Same VIEW_ROLES as the Live Board (Service Head / Super
// Admin / Technical Team Leader) - see operational-reports.service.ts's own doc comment
// for the two documented gaps: "Customer rating" is omitted entirely from Technician
// Productivity (nothing captures it, and the BRD's own "(if captured)" already hedges it),
// and SLA Breach shows the actual hoursOverThreshold rather than a fabricated reason code
// (nothing records why a job ran long).
export function OperationalReportsPage() {
  const { user } = useAuth();
  const canView = canViewReports(user?.role.name);

  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [thresholdHours, setThresholdHours] = useState(String(DEFAULT_SLA_HOURS));

  const filter = { periodStart: periodStart || undefined, periodEnd: periodEnd || undefined };

  const productivityQuery = useQuery({
    queryKey: ['reports', 'operational', 'technician-productivity', filter],
    queryFn: () => getTechnicianProductivity(filter),
    enabled: canView,
  });

  const parsedThreshold = Number(thresholdHours);
  const effectiveThreshold = Number.isFinite(parsedThreshold) && parsedThreshold > 0 ? parsedThreshold : DEFAULT_SLA_HOURS;
  const slaQuery = useQuery({
    queryKey: ['reports', 'operational', 'sla-breach', effectiveThreshold],
    queryFn: () => getSlaBreach(effectiveThreshold),
    enabled: canView,
  });

  const consumptionQuery = useQuery({
    queryKey: ['reports', 'operational', 'spare-parts-consumption', filter],
    queryFn: () => getSpareConsumption(filter),
    enabled: canView,
  });

  if (!canView) {
    return (
      <div className="px-8 py-6">
        <p className="max-w-2xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Operational Reports are restricted to Service Head / Super Admin / Technical Team
          Leader - every endpoint behind it is role-gated server-side too.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 px-8 py-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Reports &amp; Dashboards</p>
        <h1 className="mt-0.5 text-xl font-semibold text-slate-900">BRD 18.4 Operational Reports</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Technician Productivity, SLA Breach, and Spare Parts Consumption - each pulled
          straight from Job Card / Technician Visit / Inventory Reservation data.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Technician Productivity</h2>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Field label="Period start" hint="Leave blank for all-time">
            <input type="date" className={`${inputClass} w-40`} value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </Field>
          <Field label="Period end" hint="Leave blank for all-time">
            <input type="date" className={`${inputClass} w-40`} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </Field>
        </div>
        <p className="mb-3 text-xs text-slate-400">
          Applies to Technician Productivity and Spare Parts Consumption below. Customer
          rating is omitted - nothing in this app captures it.
        </p>
        {productivityQuery.isLoading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <>
            <ErrorNotice error={productivityQuery.error} />
            {productivityQuery.data && (
              <>
                <p className="mb-2 text-xs text-slate-400">{formatAsOf(productivityQuery.data.asOf)} — {productivityQuery.data.note}</p>
                {productivityQuery.data.rows.length === 0 ? (
                  <p className="text-sm text-slate-400">No completed jobs in this period.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          {['Technician', 'Jobs Completed', 'Avg Hours Login→QC', 'On-Time Arrival %'].map((h) => (
                            <th key={h} className="px-3 py-2 text-left font-medium text-slate-500">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {productivityQuery.data.rows.map((row) => (
                          <tr key={row.technicianId} className="hover:bg-slate-50">
                            <td className="px-3 py-2 text-slate-700">{row.technicianName}</td>
                            <td className="px-3 py-2 tabular-nums text-slate-700">{row.jobsCompleted}</td>
                            <td className="px-3 py-2 tabular-nums text-slate-700">{row.avgHoursLoginToQc?.toFixed(1) ?? '—'}</td>
                            <td className="px-3 py-2 tabular-nums text-slate-700">{formatPctOrDash(row.onTimeArrivalPct)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-800">SLA Breach Report</h2>
          <Field label="Threshold (hours)">
            <input
              type="number"
              min={1}
              className={`${inputClass} w-24`}
              value={thresholdHours}
              onChange={(e) => setThresholdHours(e.target.value)}
            />
          </Field>
        </div>
        <p className="mb-3 text-xs text-slate-400">
          Job Card createdAt → qcApprovedAt vs. the threshold above (default 48h, the BRD's
          own example). No reason codes are tracked - hours over threshold is shown
          instead.
        </p>
        {slaQuery.isLoading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <>
            <ErrorNotice error={slaQuery.error} />
            {slaQuery.data && (
              <>
                <p className="mb-2 text-sm text-slate-700">
                  {formatAsOf(slaQuery.data.asOf)} — {slaQuery.data.breachedCount} breached past {slaQuery.data.thresholdHours}h
                </p>
                {slaQuery.data.items.length === 0 ? (
                  <p className="text-sm text-slate-400">No breaches at this threshold.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          {['Job Card', 'Created', 'QC Approved', 'Hours Elapsed', 'Hours Over'].map((h) => (
                            <th key={h} className="px-3 py-2 text-left font-medium text-slate-500">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {slaQuery.data.items.map((item) => (
                          <tr key={item.jobCardId} className="hover:bg-slate-50">
                            <td className="px-3 py-2 text-slate-700">{item.jobCardNumber}</td>
                            <td className="px-3 py-2 text-slate-500">{new Date(item.createdAt).toLocaleDateString()}</td>
                            <td className="px-3 py-2 text-slate-500">{new Date(item.qcApprovedAt).toLocaleDateString()}</td>
                            <td className="px-3 py-2 tabular-nums text-slate-700">{item.hoursElapsed.toFixed(1)}</td>
                            <td className="px-3 py-2 tabular-nums text-red-600">{item.hoursOverThreshold.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Spare Parts Consumption</h2>
        {consumptionQuery.isLoading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <>
            <ErrorNotice error={consumptionQuery.error} />
            {consumptionQuery.data && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <SpareEntryList title="Top 10 by Quantity" entries={consumptionQuery.data.topByQuantity} valueLabel="Qty" showQty />
                  <SpareEntryList title="Top 10 by Value" entries={consumptionQuery.data.topByValue} valueLabel="Value" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <SpareGroupList title="By Model" groups={consumptionQuery.data.byModel} />
                  <SpareGroupList title="By Warranty Status" groups={consumptionQuery.data.byWarrantyStatus} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SpareEntryList({
  title,
  entries,
  showQty,
}: {
  title: string;
  entries: { sparePartId: string; code: string; name: string; totalQuantity: number; totalValue: number }[];
  valueLabel: string;
  showQty?: boolean;
}) {
  return (
    <div className="rounded-md border border-slate-100 p-3">
      <p className="mb-2 text-sm font-medium text-slate-800">{title}</p>
      {entries.length === 0 ? (
        <p className="text-xs text-slate-400">No consumption in this period.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {entries.map((e) => (
            <li key={e.sparePartId} className="flex items-center justify-between py-1.5 text-xs">
              <span className="text-slate-700">
                {e.code} <span className="text-slate-400">{e.name}</span>
              </span>
              <span className="tabular-nums text-slate-500">{showQty ? e.totalQuantity : formatAedOrDash(e.totalValue)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SpareGroupList({ title, groups }: { title: string; groups: { key: string; totalQuantity: number; totalValue: number }[] }) {
  return (
    <div className="rounded-md border border-slate-100 p-3">
      <p className="mb-2 text-sm font-medium text-slate-800">{title}</p>
      {groups.length === 0 ? (
        <p className="text-xs text-slate-400">No consumption in this period.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {groups.map((g) => (
            <li key={g.key} className="flex items-center justify-between py-1.5 text-xs">
              <span className="text-slate-700">{g.key}</span>
              <span className="tabular-nums text-slate-500">
                {g.totalQuantity} qty · {formatAedOrDash(g.totalValue)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
