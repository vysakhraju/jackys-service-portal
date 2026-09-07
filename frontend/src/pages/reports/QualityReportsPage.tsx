import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorNotice } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { useAuth } from '../../lib/auth';
import { getProductFailureRatio, getRepeatComplaints, getRwrAnalysis } from '../../lib/reportsApi';
import { canViewReports } from '../../lib/reportsTypes';

// BRD 18.3 Quality / Product Team Dashboard (AC-22/23/24). Same VIEW_ROLES as the Live
// Board (Service Head / Super Admin / Technical Team Leader) - see
// quality-reports.service.ts's own doc comment for the two documented gaps this page must
// not silently paper over: "Region" uses ServiceCentre.city (falling back to country, never
// a fabricated region taxonomy), and "Reason" on RWR Analysis is the Estimate's raw free
// text ("Not specified" when absent), never mapped onto invented reason codes.
export function QualityReportsPage() {
  const { user } = useAuth();
  const canView = canViewReports(user?.role.name);

  const [brand, setBrand] = useState('');
  const [modelNumber, setModelNumber] = useState('');
  const [faultCode, setFaultCode] = useState('');
  const [groupBy, setGroupBy] = useState<'month' | 'quarter' | 'year'>('month');
  const [rwrPeriodStart, setRwrPeriodStart] = useState('');
  const [rwrPeriodEnd, setRwrPeriodEnd] = useState('');

  const failureFilter = {
    brand: brand || undefined,
    modelNumber: modelNumber || undefined,
    faultCode: faultCode || undefined,
    groupBy,
  };
  const failureQuery = useQuery({
    queryKey: ['reports', 'quality', 'product-failure-ratio', failureFilter],
    queryFn: () => getProductFailureRatio(failureFilter),
    enabled: canView,
  });

  const repeatQuery = useQuery({
    queryKey: ['reports', 'quality', 'repeat-complaints'],
    queryFn: getRepeatComplaints,
    enabled: canView,
  });

  const rwrFilter = { periodStart: rwrPeriodStart || undefined, periodEnd: rwrPeriodEnd || undefined };
  const rwrQuery = useQuery({
    queryKey: ['reports', 'quality', 'rwr-analysis', rwrFilter],
    queryFn: () => getRwrAnalysis(rwrFilter),
    enabled: canView,
  });

  if (!canView) {
    return (
      <div className="px-8 py-6">
        <p className="max-w-2xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          The Quality/Product dashboard is restricted to Service Head / Super Admin /
          Technical Team Leader - every endpoint behind it is role-gated server-side too.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 px-8 py-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Reports &amp; Dashboards</p>
        <h1 className="mt-0.5 text-xl font-semibold text-slate-900">BRD 18.3 Quality / Product Dashboard</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Product Failure Ratio (AC-22), Repeat Complaints (AC-23), and RWR Analysis
          (AC-24) - all three grouped straight from Job Card / Estimate data, no cost or
          revenue ambiguity involved.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Product Failure Ratio (AC-22)</h2>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Field label="Brand">
            <input className={`${inputClass} w-36`} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Any" />
          </Field>
          <Field label="Model number">
            <input className={`${inputClass} w-36`} value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} placeholder="Any" />
          </Field>
          <Field label="Fault code">
            <input className={`${inputClass} w-32`} value={faultCode} onChange={(e) => setFaultCode(e.target.value)} placeholder="Any" />
          </Field>
          <Field label="Group by">
            <select className={`${inputClass} w-28`} value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'month' | 'quarter' | 'year')}>
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
              <option value="year">Year</option>
            </select>
          </Field>
        </div>
        {failureQuery.isLoading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <>
            <ErrorNotice error={failureQuery.error} />
            {failureQuery.data && failureQuery.data.length === 0 ? (
              <p className="text-sm text-slate-400">No failures matching these filters.</p>
            ) : failureQuery.data ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      {['Period', 'Brand', 'Model', 'Count'].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-slate-500">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {failureQuery.data.map((row, i) => (
                      <tr key={`${row.periodLabel}-${row.brand}-${row.model}-${i}`} className="hover:bg-slate-50">
                        <td className="px-3 py-2 text-slate-700">{row.periodLabel}</td>
                        <td className="px-3 py-2 text-slate-700">{row.brand}</td>
                        <td className="px-3 py-2 text-slate-700">{row.model}</td>
                        <td className="px-3 py-2 tabular-nums text-slate-700">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Repeat Complaints (AC-23)</h2>
        <p className="mb-3 text-xs text-slate-400">
          Same serial number with more than one Job Card, flagged when two of them fall
          within a 30-day window - engineering escalation candidates.
        </p>
        {repeatQuery.isLoading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <>
            <ErrorNotice error={repeatQuery.error} />
            {repeatQuery.data && repeatQuery.data.length === 0 ? (
              <p className="text-sm text-slate-400">No repeat complaints on record.</p>
            ) : repeatQuery.data ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      {['Serial Number', 'Total Jobs', 'Within 30 Days', 'Min Gap (days)', 'Job Cards'].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-slate-500">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {repeatQuery.data.map((row) => (
                      <tr key={row.serialNumber} className="hover:bg-slate-50">
                        <td className="px-3 py-2 text-slate-700">{row.serialNumber}</td>
                        <td className="px-3 py-2 tabular-nums text-slate-700">{row.totalJobCount}</td>
                        <td className="px-3 py-2">
                          {row.repeatWithin30Days ? (
                            <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Yes</span>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">No</span>
                          )}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-slate-700">{row.minGapDays ?? '—'}</td>
                        <td className="px-3 py-2 text-slate-500">{row.jobCardNumbers.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">RWR Analysis (AC-24)</h2>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Field label="Period start" hint="Leave blank for all-time">
            <input type="date" className={`${inputClass} w-40`} value={rwrPeriodStart} onChange={(e) => setRwrPeriodStart(e.target.value)} />
          </Field>
          <Field label="Period end" hint="Leave blank for all-time">
            <input type="date" className={`${inputClass} w-40`} value={rwrPeriodEnd} onChange={(e) => setRwrPeriodEnd(e.target.value)} />
          </Field>
        </div>
        <p className="mb-3 text-xs text-slate-400">
          Rejected Estimate counts by model/reason/region. Reason is free text ("Not
          specified" when absent) - no structured reason-code field exists.
        </p>
        {rwrQuery.isLoading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <>
            <ErrorNotice error={rwrQuery.error} />
            {rwrQuery.data && rwrQuery.data.length === 0 ? (
              <p className="text-sm text-slate-400">No rejected estimates in this period.</p>
            ) : rwrQuery.data ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      {['Model', 'Reason', 'Region', 'Count'].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-slate-500">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rwrQuery.data.map((row, i) => (
                      <tr key={`${row.model}-${row.reason}-${row.region}-${i}`} className="hover:bg-slate-50">
                        <td className="px-3 py-2 text-slate-700">{row.model}</td>
                        <td className="px-3 py-2 text-slate-700">{row.reason}</td>
                        <td className="px-3 py-2 text-slate-700">{row.region}</td>
                        <td className="px-3 py-2 tabular-nums text-slate-700">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
