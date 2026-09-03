import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { listGlPostings } from '../../lib/glLedgerApi';
import { GL_SOURCE_TYPES, GL_SOURCE_TYPE_LABELS, type GlPosting, type GlSourceTypeValue } from '../../lib/glLedgerTypes';

const PAGE_SIZE = 25;

// Read-only view over GET /gl-postings (see gl-ledger.controller.ts / glLedgerTypes.ts's
// doc comment - a deliberate internal-only journal log, system-generated only, no
// manual-entry endpoint exists so there's nothing to create/edit here). The backend has no
// pagination at all (GlLedgerService.findAll() returns every matching row) - the the-fool
// pre-mortem run before this screen was built flagged that rendering an unbounded, ever-
// growing table in one DataTable would eventually freeze the tab. The sourceType filter
// narrows the query server-side; pagination below is client-side only, over whatever that
// query already returned - it caps how many rows hit the DOM at once, it does not reduce
// what gets fetched. The "Showing X-Y of Z" line is deliberately explicit about that so
// nobody mistakes "page 1 of 40" for "there are only 40 postings".
export function GlPostingsPage() {
  const [sourceType, setSourceType] = useState<GlSourceTypeValue | ''>('');
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['gl-postings', sourceType],
    queryFn: () => listGlPostings(sourceType || undefined),
  });

  const postings = query.data ?? [];
  const totalAmount = useMemo(() => postings.reduce((sum, p) => sum + Number(p.amount), 0), [postings]);
  const pageCount = Math.max(1, Math.ceil(postings.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount);
  const pageRows = postings.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  function changeSourceType(value: string) {
    setSourceType(value as GlSourceTypeValue | '');
    setPage(1);
  }

  const columns: Column<GlPosting>[] = [
    {
      key: 'postedAt',
      label: 'Posted',
      render: (p) => <span className="text-xs text-slate-500">{new Date(p.postedAt).toLocaleString()}</span>,
    },
    {
      key: 'sourceType',
      label: 'Source',
      render: (p) => (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
          {GL_SOURCE_TYPE_LABELS[p.sourceType]}
        </span>
      ),
    },
    { key: 'description', label: 'Description', render: (p) => <span className="text-slate-700">{p.description}</span> },
    { key: 'debitAccount', label: 'Debit', render: (p) => <span className="font-mono text-xs text-slate-500">{p.debitAccount}</span> },
    { key: 'creditAccount', label: 'Credit', render: (p) => <span className="font-mono text-xs text-slate-500">{p.creditAccount}</span> },
    {
      key: 'amount',
      label: 'Amount',
      className: 'text-right',
      render: (p) => <span className="font-medium text-slate-800">AED {Number(p.amount).toFixed(2)}</span>,
    },
  ];

  return (
    <div className="max-w-5xl space-y-4">
      <p className="max-w-2xl text-sm text-slate-500">
        System-generated journal entries only - one row per posted Invoice payment, POSTED
        Debit Note, priced-and-posted Dismantling Record, or recorded Warranty Claim credit
        note. An honest internal-only stopgap (no chart of accounts, no external ERP
        integration yet), not a substitute for real accounting software.
      </p>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Source type">
          <select
            className={`${inputClass} w-56`}
            value={sourceType}
            onChange={(e) => changeSourceType(e.target.value)}
          >
            <option value="">All source types</option>
            {GL_SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>{GL_SOURCE_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </Field>
        {!query.isLoading && !query.error && (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {postings.length} posting{postings.length === 1 ? '' : 's'}
            </p>
            <p className="text-sm font-semibold text-slate-900">AED {totalAmount.toFixed(2)} total</p>
          </div>
        )}
      </div>

      {query.error ? <ErrorNotice error={query.error} /> : null}

      <DataTable
        columns={columns}
        rows={query.isLoading ? undefined : pageRows}
        isLoading={query.isLoading}
        error={null}
        emptyMessage="No GL postings match this filter yet."
      />

      {!query.isLoading && !query.error && postings.length > 0 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            Showing {(clampedPage - 1) * PAGE_SIZE + 1}-{Math.min(clampedPage * PAGE_SIZE, postings.length)} of{' '}
            {postings.length} (all fetched at once - this page just controls what renders)
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={clampedPage <= 1}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              ← Prev
            </button>
            <span>Page {clampedPage} of {pageCount}</span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={clampedPage >= pageCount}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
