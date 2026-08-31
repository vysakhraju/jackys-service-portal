import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Modal } from '../../components/Modal';
import { ErrorNotice } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { StatusBadge } from '../../components/StatusBadge';
import { getInvoiceByJobCard, getInvoice, recordPayment } from '../../lib/invoicingApi';
import type { PaymentMethodValue } from '../../lib/invoicingTypes';

// Shared by both the Ready-for-Delivery tab (a blocked batch-create, or an on-demand
// "Invoice" check on an OOW row) and the Deliveries tab (a blocked POD capture) - the same
// { message, blockers } 409 shape and the same GET-job-card-invoice / record-payment flow
// applies in both places, so this lives in its own file instead of being duplicated.
//
// Opening this modal is itself the "on-demand" trigger the-fool pre-mortem settled on: it
// only calls GET /invoicing/job-card/:jobCardId (which can lazily create a DRAFT invoice
// as a side effect) when the user has explicitly asked to see/pay an invoice - never eagerly
// on a list just rendering. When the caller already knows the invoiceId (from a 409's
// blockers array), pass it directly to skip that lookup and go straight to GET /invoicing/:id.
export function RecordPaymentModal({
  open,
  onClose,
  jobCardId,
  invoiceId,
  onPaid,
}: {
  open: boolean;
  onClose: () => void;
  jobCardId: string;
  invoiceId?: string;
  onPaid?: () => void;
}) {
  const invoiceQuery = useQuery({
    queryKey: invoiceId ? ['invoice', invoiceId] : ['invoice', 'job-card', jobCardId],
    queryFn: () => (invoiceId ? getInvoice(invoiceId) : getInvoiceByJobCard(jobCardId)),
    enabled: open,
  });

  return (
    <Modal open={open} onClose={onClose} title="Invoice & payment">
      {invoiceQuery.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {invoiceQuery.error && <ErrorNotice error={invoiceQuery.error} />}
      {invoiceQuery.data && (
        <PaymentForm
          invoiceId={invoiceQuery.data.id}
          invoiceNumber={invoiceQuery.data.invoiceNumber}
          status={invoiceQuery.data.status}
          amount={invoiceQuery.data.amount}
          onPaid={() => {
            onPaid?.();
          }}
        />
      )}
    </Modal>
  );
}

function PaymentForm({
  invoiceId,
  invoiceNumber,
  status,
  amount,
  onPaid,
}: {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  amount: number;
  onPaid: () => void;
}) {
  const queryClient = useQueryClient();
  const [justPaid, setJustPaid] = useState(false);
  const { register, handleSubmit } = useForm<{ method: PaymentMethodValue; amountReceived: number; reference: string }>({
    defaultValues: { method: 'CASH', amountReceived: amount, reference: '' },
  });
  const mutation = useMutation({
    mutationFn: (data: { method: PaymentMethodValue; amountReceived: number; reference?: string }) =>
      recordPayment(invoiceId, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['ready-for-delivery'] });
      setJustPaid(updated.status === 'PAID');
      onPaid();
    },
  });

  const settled = status === 'PAID' || status === 'CANCELLED';

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
        <div className="flex items-center justify-between">
          <p className="font-medium text-slate-800">{invoiceNumber}</p>
          <StatusBadge status={status} />
        </div>
        <p className="mt-0.5 text-xs text-slate-500">AED {amount.toFixed(2)} total</p>
      </div>

      {settled ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {status === 'PAID' ? 'Already fully paid.' : 'This invoice is cancelled.'}
        </p>
      ) : justPaid ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          Payment recorded - invoice is now PAID.
        </p>
      ) : (
        <>
          <ErrorNotice error={mutation.error} />
          <p className="text-xs text-slate-400">
            Cash/Card/Bank Transfer record immediately. B2B Credit is only accepted if this
            job's appointment is a B2B customer - the server rejects it otherwise (FR-14).
          </p>
          <form
            onSubmit={handleSubmit((values) =>
              mutation.mutate({
                method: values.method,
                amountReceived: Number(values.amountReceived),
                reference: values.reference || undefined,
              }),
            )}
            className="space-y-2"
          >
            <Field label="Payment method">
              <select className={inputClass} {...register('method', { required: true })}>
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="BANK_TRANSFER">Bank Transfer</option>
                <option value="B2B_CREDIT">B2B Credit</option>
              </select>
            </Field>
            <Field label="Amount received (AED)" hint="Partial payments are allowed - the invoice stays PARTIALLY_PAID until fully covered.">
              <input
                type="number"
                min="0.01"
                step="0.01"
                className={inputClass}
                {...register('amountReceived', { required: true, valueAsNumber: true, min: 0.01 })}
              />
            </Field>
            <Field label="Reference (optional)">
              <input className={inputClass} {...register('reference')} placeholder="e.g. card slip / transfer ref" />
            </Field>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Record Payment
            </button>
          </form>
        </>
      )}
    </div>
  );
}
