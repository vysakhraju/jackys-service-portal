import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ErrorNotice } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { StatusBadge } from '../../components/StatusBadge';
import { generateAmcBillingInvoice, getAmcBillingInvoicesForContract, recordAmcBillingPayment } from '../../lib/amcApi';
import type { PaymentMethodValue } from '../../lib/invoicingTypes';

// Deliberately NOT RecordPaymentModal (Phase 8/9) - that component is built around
// Invoice's partial-payment model (payment history, a "remaining balance" default via
// react-hook-form's `values` option) and has no meaning here: AmcBillingInvoice settlement
// is full-amount-only in one call, with no job-card linkage at all. Reusing it as-is would
// show a payment-history section and a remaining-balance concept that don't exist for AMC
// billing (the-fool pre-mortem finding, confirmed via reading AmcBillingInvoice's own class
// doc comment).
export function AmcBillingSection({ contractId, canBill }: { contractId: string; canBill: boolean }) {
  const queryClient = useQueryClient();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [periodLabel, setPeriodLabel] = useState('');
  const [payingId, setPayingId] = useState<string | null>(null);

  const invoicesQuery = useQuery({
    queryKey: ['amc-billing-invoices', contractId],
    queryFn: () => getAmcBillingInvoicesForContract(contractId),
  });

  const generateMutation = useMutation({
    mutationFn: (label: string) => generateAmcBillingInvoice(contractId, label),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['amc-billing-invoices', contractId] });
      setGenerateOpen(false);
      setPeriodLabel('');
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Billing invoices</p>
        {canBill && (
          <button
            type="button"
            onClick={() => setGenerateOpen((o) => !o)}
            className="text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            {generateOpen ? 'Cancel' : '+ Generate invoice'}
          </button>
        )}
      </div>

      {generateOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (periodLabel.trim()) generateMutation.mutate(periodLabel.trim());
          }}
          className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-3"
        >
          <ErrorNotice error={generateMutation.error} />
          <Field label="Period label" hint='e.g. "Full Term", "Q1 2026", "H2 2026" - free text, your call'>
            <input className={`${inputClass} w-48`} value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} />
          </Field>
          <button
            type="submit"
            disabled={!periodLabel.trim() || generateMutation.isPending}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Generate
          </button>
        </form>
      )}

      {invoicesQuery.isLoading && <p className="text-xs text-slate-400">Loading…</p>}
      {invoicesQuery.error && <ErrorNotice error={invoicesQuery.error} />}
      {invoicesQuery.data && invoicesQuery.data.length === 0 && (
        <p className="text-xs text-slate-400">No billing invoices generated yet.</p>
      )}
      {invoicesQuery.data && invoicesQuery.data.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
          {invoicesQuery.data.map((inv) => (
            <li key={inv.id} className="px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-slate-800">{inv.invoiceNumber}</span>{' '}
                  <span className="text-slate-500">· {inv.periodLabel} · AED {Number(inv.amount).toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={inv.status} />
                  {canBill && inv.status === 'DRAFT' && (
                    <button
                      type="button"
                      onClick={() => setPayingId(payingId === inv.id ? null : inv.id)}
                      className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      {payingId === inv.id ? 'Close' : 'Record payment'}
                    </button>
                  )}
                </div>
              </div>
              {payingId === inv.id && (
                <BillingPaymentForm
                  invoiceId={inv.id}
                  onPaid={() => {
                    setPayingId(null);
                    queryClient.invalidateQueries({ queryKey: ['amc-billing-invoices', contractId] });
                  }}
                />
              )}
              {inv.status === 'PAID' && (
                <p className="mt-1 text-xs text-slate-400">
                  Paid via {inv.paymentMethod?.replaceAll('_', ' ')}
                  {inv.paymentReference ? ` · ${inv.paymentReference}` : ''} on{' '}
                  {inv.paidAt ? new Date(inv.paidAt).toLocaleDateString() : '—'}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BillingPaymentForm({ invoiceId, onPaid }: { invoiceId: string; onPaid: () => void }) {
  const { register, handleSubmit } = useForm<{ method: PaymentMethodValue; reference: string }>({
    defaultValues: { method: 'CASH', reference: '' },
  });
  const mutation = useMutation({
    mutationFn: (data: { method: PaymentMethodValue; reference?: string }) =>
      recordAmcBillingPayment(invoiceId, data.method, data.reference),
    onSuccess: onPaid,
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate({ method: values.method, reference: values.reference || undefined }))}
      className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2"
    >
      <ErrorNotice error={mutation.error} />
      <p className="w-full text-xs text-slate-400">
        Full-amount-only - unlike Invoicing's Payment model (Phase 8/9), an AMC installment has no partial-payment concept.
      </p>
      <Field label="Method">
        <select className={`${inputClass} w-40`} {...register('method', { required: true })}>
          <option value="CASH">Cash</option>
          <option value="CARD">Card</option>
          <option value="BANK_TRANSFER">Bank Transfer</option>
          <option value="B2B_CREDIT">B2B Credit</option>
        </select>
      </Field>
      <Field label="Reference (optional)">
        <input className={`${inputClass} w-40`} {...register('reference')} />
      </Field>
      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        Mark paid
      </button>
    </form>
  );
}
