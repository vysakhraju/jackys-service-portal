import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { getInvoice, getPayments, listInvoices } from '../../lib/invoicingApi';
import type { Invoice, InvoiceStatusValue } from '../../lib/invoicingTypes';
import type { CustomerTypeValue } from '../../lib/appointmentsTypes';
import { RecordPaymentModal } from '../delivery/RecordPaymentModal';

const STATUS_FILTERS: { label: string; value: InvoiceStatusValue | '' }[] = [
  { label: 'All', value: '' },
  { label: 'Draft', value: 'DRAFT' },
  { label: 'Partially Paid', value: 'PARTIALLY_PAID' },
  { label: 'Paid', value: 'PAID' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

const CUSTOMER_TYPE_FILTERS: { label: string; value: CustomerTypeValue | '' }[] = [
  { label: 'All customers', value: '' },
  { label: 'B2C', value: 'B2C' },
  { label: 'B2B', value: 'B2B' },
  { label: 'B2B Sales Channel', value: 'B2B_SALES_CHANNEL' },
];

// The general browse/audit list - GET /invoicing (Frontend Phase 9's new list endpoint).
// This is the only screen that shows every invoice regardless of status or customer type;
// the B2B Aging Report tab is deliberately narrower (unpaid B2B Credit only, per AC-16).
export function InvoicesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = searchParams.get('invoiceId') ?? '';
  const [statusFilter, setStatusFilter] = useState<InvoiceStatusValue | ''>('');
  const [customerTypeFilter, setCustomerTypeFilter] = useState<CustomerTypeValue | ''>('');

  const listQuery = useQuery({
    queryKey: ['invoices', statusFilter, customerTypeFilter],
    queryFn: () => listInvoices({ status: statusFilter || undefined, customerType: customerTypeFilter || undefined }),
  });

  function select(id: string) {
    setSearchParams({ invoiceId: id });
  }

  const columns: Column<Invoice>[] = [
    { key: 'invoiceNumber', label: 'Invoice #', render: (i) => <span className="font-medium text-slate-800">{i.invoiceNumber}</span> },
    { key: 'status', label: 'Status', render: (i) => <StatusBadge status={i.status} /> },
    { key: 'amount', label: 'Amount', render: (i) => `AED ${Number(i.amount).toFixed(2)}` },
    { key: 'dueDate', label: 'Due', render: (i) => (i.dueDate ? new Date(i.dueDate).toLocaleDateString() : '—') },
    { key: 'createdAt', label: 'Created', render: (i) => new Date(i.createdAt).toLocaleDateString() },
  ];

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                statusFilter === f.value ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={customerTypeFilter}
          onChange={(e) => setCustomerTypeFilter(e.target.value as CustomerTypeValue | '')}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700"
        >
          {CUSTOMER_TYPE_FILTERS.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      <DataTable
        columns={columns}
        rows={listQuery.data}
        isLoading={listQuery.isLoading}
        error={listQuery.error}
        emptyMessage="No invoices match this filter."
        rowActions={(i) => (
          <button onClick={() => select(i.id)} className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            View
          </button>
        )}
      />

      {activeId && <InvoiceDetail id={activeId} />}
    </div>
  );
}

export function InvoiceDetail({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const [payOpen, setPayOpen] = useState(false);

  const invoiceQuery = useQuery({ queryKey: ['invoice', id], queryFn: () => getInvoice(id) });
  const paymentsQuery = useQuery({ queryKey: ['payments', id], queryFn: () => getPayments(id) });

  function onChanged() {
    queryClient.invalidateQueries({ queryKey: ['invoice', id] });
    queryClient.invalidateQueries({ queryKey: ['payments', id] });
    queryClient.invalidateQueries({ queryKey: ['invoices'] });
    queryClient.invalidateQueries({ queryKey: ['aging-report'] });
  }

  if (invoiceQuery.isLoading) return <p className="text-sm text-slate-400">Loading invoice…</p>;
  if (invoiceQuery.error) return <ErrorNotice error={invoiceQuery.error} />;
  if (!invoiceQuery.data) return null;
  const invoice = invoiceQuery.data;

  const amountPaid = paymentsQuery.data ? Math.round(paymentsQuery.data.reduce((s, p) => s + Number(p.amount), 0) * 100) / 100 : 0;
  const amountDue = Math.round((Number(invoice.amount) - amountPaid) * 100) / 100;
  const settled = invoice.status === 'PAID' || invoice.status === 'CANCELLED';

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-slate-900">{invoice.invoiceNumber}</p>
          <p className="text-xs text-slate-400">
            AED {Number(invoice.amount).toFixed(2)} total (Subtotal {Number(invoice.subtotal).toFixed(2)} + VAT{' '}
            {Number(invoice.vatAmount).toFixed(2)} @ {Number(invoice.vatRate)}%)
          </p>
        </div>
        <StatusBadge status={invoice.status} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <p className="text-slate-500">
          Paid so far <span className="font-medium text-slate-800">AED {amountPaid.toFixed(2)}</span>
        </p>
        <p className="text-slate-500">
          Remaining <span className="font-medium text-slate-800">AED {Math.max(0, amountDue).toFixed(2)}</span>
        </p>
        <p className="text-slate-500">
          Due date {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : '—'}
        </p>
        <p className="text-slate-500">
          <Link to={`/workshop-inventory/workshop?jobCardId=${invoice.jobCardId}`} className="text-slate-600 underline">
            View Job Card →
          </Link>
        </p>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
          Payment history ({paymentsQuery.data?.length ?? '…'})
        </p>
        {paymentsQuery.isLoading && <p className="text-xs text-slate-400">Loading…</p>}
        {paymentsQuery.error && <ErrorNotice error={paymentsQuery.error} />}
        {paymentsQuery.data && paymentsQuery.data.length === 0 && (
          <p className="text-xs text-slate-400">No payments recorded yet.</p>
        )}
        {paymentsQuery.data && paymentsQuery.data.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {paymentsQuery.data.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                <span className="text-slate-700">
                  {p.method.replaceAll('_', ' ')} · AED {Number(p.amount).toFixed(2)}
                  {p.reference && <span className="text-slate-400"> · {p.reference}</span>}
                </span>
                <span className="text-slate-400">{new Date(p.recordedAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!settled && (
        <button
          onClick={() => setPayOpen(true)}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          Record Payment
        </button>
      )}

      <RecordPaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        jobCardId={invoice.jobCardId}
        invoiceId={invoice.id}
        onPaid={onChanged}
      />
    </div>
  );
}
