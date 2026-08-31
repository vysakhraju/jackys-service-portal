import type { DeliveryBlocker } from '../../lib/deliveryTypes';

// The 409 { message, blockers } shape POST /delivery and POST /delivery/:id/pod both throw
// (FR-12/AC-11, and the defensive re-check at POD time) - shared between the Ready and
// Deliveries tabs since both actions can hit it. Unlike Phase 6/7's QcApproveBlocker (which
// names spare-part reservations), this one names job cards + the invoice + amount owed, so
// it gets its own renderer rather than reusing QcPage's.
export function DeliveryBlockersNotice({
  blockers,
  onRecordPayment,
}: {
  blockers: DeliveryBlocker[];
  onRecordPayment: (jobCardId: string, invoiceId: string) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
      <p className="font-medium">
        Blocked - {blockers.length} out-of-warranty job{blockers.length === 1 ? ' is' : 's are'} unpaid:
      </p>
      <ul className="space-y-1.5">
        {blockers.map((b) => (
          <li key={b.jobCardId} className="flex items-center justify-between gap-2 rounded bg-white/60 px-2 py-1">
            <span>
              <span className="font-medium">{b.jobCardNumber}</span> - {b.invoiceStatus}, AED {b.amount.toFixed(2)} owed
            </span>
            <button
              type="button"
              onClick={() => onRecordPayment(b.jobCardId, b.invoiceId)}
              className="whitespace-nowrap rounded border border-red-300 px-2 py-0.5 font-medium text-red-700 hover:bg-red-100"
            >
              Record payment
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
