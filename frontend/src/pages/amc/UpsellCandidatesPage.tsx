import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { DataTable, type Column } from '../../components/DataTable';
import { getAmcUpsellCandidates } from '../../lib/amcApi';
import type { UpsellCandidate } from '../../lib/amcTypes';

// Post-MVP bonus: out-of-warranty customers who just proved they'll pay for a repair (an
// APPROVED Estimate) and aren't already on an ACTIVE AMC contract - heuristic phone-number
// match only (no CRM/customer master exists to match on more precisely), per
// AmcService.getRwrUpsellCandidates()'s own doc comment. the-fool pre-mortem finding #4:
// each row now links straight into a pre-filled Create Contract form instead of being a
// read-only dead end a Sales/CCE user would have to re-type from scratch.
export function UpsellCandidatesPage() {
  const query = useQuery({ queryKey: ['amc-upsell-candidates'], queryFn: getAmcUpsellCandidates });

  const columns: Column<UpsellCandidate & { id: string }>[] = [
    { key: 'jobCardNumber', label: 'Job Card', render: (c) => <span className="font-medium text-slate-900">{c.jobCardNumber}</span> },
    { key: 'customer', label: 'Customer', render: (c) => (
      <div>
        <div className="text-slate-900">{c.customerName}</div>
        <div className="text-xs text-slate-400">{c.customerPhone}</div>
      </div>
    ) },
    { key: 'amount', label: 'Repair amount', render: (c) => `AED ${Number(c.estimateAmount).toFixed(2)}` },
  ];

  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-sm text-slate-500">
        A heuristic phone-number match, not a precise CRM lookup - a customer with a repair
        just approved, who isn't already on an ACTIVE AMC contract.
      </p>
      <DataTable
        columns={columns}
        rows={query.data?.map((c) => ({ ...c, id: c.jobCardId }))}
        isLoading={query.isLoading}
        error={query.error}
        emptyMessage="No upsell candidates right now."
        rowActions={(c) => (
          <Link
            to={`/amc/contracts?prefillName=${encodeURIComponent(c.customerName)}&prefillPhone=${encodeURIComponent(c.customerPhone)}`}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Create AMC Contract →
          </Link>
        )}
      />
    </div>
  );
}
