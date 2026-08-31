import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ErrorNotice } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { getB2bAging } from '../../lib/invoicingApi';

// AC-16: 0-30/31-60/61-90/90+ days-past-due breakdown of unpaid B2B Credit balances.
// Deliberately narrower than the Invoices tab - only DRAFT/PARTIALLY_PAID invoices whose
// Job Card belongs to a B2B appointment (see InvoicingService.getB2bAgingReport's own doc
// comment for why "B2B" rather than "already tagged B2B_CREDIT"). Clicking a row deep-links
// into the Invoices tab's detail view (same InvoiceDetail component, same Record Payment
// flow) rather than duplicating a payment form here.
export function AgingReportPage() {
  const query = useQuery({ queryKey: ['aging-report'], queryFn: getB2bAging });

  if (query.isLoading) return <p className="text-sm text-slate-400">Loading aging report…</p>;
  if (query.error) return <ErrorNotice error={query.error} />;
  if (!query.data) return null;

  const { buckets, totalOutstanding } = query.data;

  return (
    <div className="max-w-4xl space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Total outstanding, B2B Credit</p>
        <p className="mt-1 text-2xl font-semibold text-slate-900">AED {totalOutstanding.toFixed(2)}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {buckets.map((bucket) => (
          <div key={bucket.label} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-800">{bucket.label}</p>
              <p className="text-sm font-medium text-slate-600">AED {bucket.totalOutstanding.toFixed(2)}</p>
            </div>
            {bucket.invoices.length === 0 ? (
              <p className="mt-2 text-xs text-slate-400">Nothing in this bucket.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100 border-t border-slate-100">
                {bucket.invoices.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between py-1.5 text-xs">
                    <span className="flex items-center gap-2 text-slate-700">
                      {inv.invoiceNumber}
                      <StatusBadge status={inv.status} />
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-slate-500">AED {Number(inv.amount).toFixed(2)}</span>
                      <Link to={`/finance/invoices?invoiceId=${inv.id}`} className="text-slate-500 underline">
                        View →
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
