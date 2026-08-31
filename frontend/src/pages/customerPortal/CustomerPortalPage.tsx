import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { getPortalInvoice, getPortalSummary, trackJob } from '../../lib/customerPortalApi';
import type { PortalInvoiceView } from '../../lib/customerPortalTypes';

type Tab = 'status' | 'invoice' | 'summary';
const TABS: { key: Tab; label: string }[] = [
  { key: 'status', label: 'Status' },
  { key: 'invoice', label: 'What You Owe' },
  { key: 'summary', label: 'Download Summary' },
];

// Deliberately outside AppLayout/ProtectedRoute (see App.tsx) - no sidebar, no login
// requirement, no staff branding. What a customer sees after tapping their tracking link
// (SMS/WhatsApp/email, or handed to them at drop-off) - see JobCardsPage's own "Customer
// tracking link" copy block for where staff get this URL. Uses lib/publicApi.ts exclusively
// (via customerPortalApi), same reasoning as EstimatePublicPage (Phase 5): never the staff
// `api` client, so nothing here can leak a staff bearer token or bounce to /login.
//
// One page, three sections sharing one token - the-fool pre-mortem for this phase
// considered three separate routes (one per backend endpoint) and rejected it: all three
// endpoints key off the SAME publicToken, so a customer only ever gets one link, and
// splitting it into three URLs just means deciding which one to send them and orphaning
// the other two. Status loads eagerly (it's the header); "What You Owe" and "Download
// Summary" fetch lazily, only once their tab is actually opened.
export function CustomerPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [tab, setTab] = useState<Tab>('status');

  const trackQuery = useQuery({
    queryKey: ['portal-track', token],
    queryFn: () => trackJob(token!),
    enabled: !!token,
    retry: false,
  });

  const trackStatus = (trackQuery.error as AxiosError)?.response?.status;

  return (
    <div className="flex min-h-screen justify-center bg-slate-50 px-4 py-10 print:bg-white print:py-0">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:shadow-none">
        <p className="mb-4 text-xs font-medium uppercase tracking-wide text-slate-400">
          Jacky's Service Portal — Track Your Repair
        </p>

        {trackQuery.isLoading && <p className="text-sm text-slate-500">Loading your repair status…</p>}

        {trackQuery.error && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {trackStatus === 404
              ? "We couldn't find that tracking link. Please check the link and try again."
              : 'Something went wrong loading your repair status. Please try again shortly.'}
          </div>
        )}

        {trackQuery.data && (
          <>
            <div className="border-b border-slate-100 pb-4">
              <p className="text-sm text-slate-600">
                Job Card <span className="font-medium text-slate-900">{trackQuery.data.jobCardNumber}</span>
                {trackQuery.data.brand ? ` · ${trackQuery.data.brand}` : ''}
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{friendlyStatus(trackQuery.data.status)}</p>
            </div>

            <nav className="mt-4 flex gap-1 print:hidden">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    tab === t.key ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>

            <div className="mt-4">
              {tab === 'status' && <StatusTab data={trackQuery.data} />}
              {tab === 'invoice' && <InvoiceTab token={token!} />}
              {tab === 'summary' && <SummaryTab token={token!} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function friendlyStatus(status: string): string {
  const MAP: Record<string, string> = {
    OPEN: 'Received',
    SN_VALIDATED: 'Received',
    SECTION_ASSIGNED: 'In progress',
    WORKSHOP_ASSIGNED: 'In progress',
    IN_PROGRESS: 'Being repaired',
    SPARE_PENDING: 'Waiting on a spare part',
    READY_FOR_QC: 'Final checks',
    QC_PASSED: 'Ready for handover',
    DELIVERED: 'Delivered',
    RWR: 'Awaiting your decision',
    CANCELLED: 'Cancelled',
  };
  return MAP[status] ?? status.replaceAll('_', ' ');
}

function StatusTab({
  data,
}: {
  data: { warrantyStatus: 'IW' | 'OOW'; customerApproved: boolean; qcApprovedAt: string | null; createdAt: string; delivery: { deliveryNumber: string; status: string; dispatchedAt: string | null; deliveredAt: string | null } | null };
}) {
  return (
    <div className="space-y-2 text-sm text-slate-600">
      <Row label="Coverage">{data.warrantyStatus === 'IW' ? 'Under warranty' : 'Out of warranty'}</Row>
      <Row label="Received">{new Date(data.createdAt).toLocaleDateString()}</Row>
      {data.qcApprovedAt && <Row label="Passed final checks">{new Date(data.qcApprovedAt).toLocaleDateString()}</Row>}
      {data.delivery && (
        <>
          <Row label="Delivery">
            {data.delivery.deliveryNumber} — {friendlyStatus(data.delivery.status)}
          </Row>
          {data.delivery.deliveredAt && <Row label="Delivered on">{new Date(data.delivery.deliveredAt).toLocaleString()}</Row>}
        </>
      )}
    </div>
  );
}

function InvoiceTab({ token }: { token: string }) {
  const query = useQuery({ queryKey: ['portal-invoice', token], queryFn: () => getPortalInvoice(token), retry: false });

  if (query.isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (query.error) return <p className="text-sm text-amber-700">Something went wrong loading this. Please try again shortly.</p>;
  if (!query.data) return null;

  return <InvoiceView invoice={query.data} />;
}

function InvoiceView({ invoice }: { invoice: PortalInvoiceView }) {
  if (!invoice.applicable) {
    return <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{invoice.message}</p>;
  }
  if (!invoice.invoiceCreated) {
    return <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">{invoice.message}</p>;
  }
  return (
    <div className="space-y-2 text-sm text-slate-600">
      <Row label="Invoice">{invoice.invoiceNumber}</Row>
      <Row label="Subtotal">AED {invoice.subtotal.toFixed(2)}</Row>
      <Row label="VAT">AED {invoice.vatAmount.toFixed(2)}</Row>
      <Row label="Total">
        <span className="font-medium text-slate-900">AED {invoice.totalAmount.toFixed(2)}</span>
      </Row>
      <Row label="Paid so far">AED {invoice.amountPaid.toFixed(2)}</Row>
      <Row label="Amount due">
        <span className="font-medium text-slate-900">AED {invoice.amountDue.toFixed(2)}</span>
      </Row>
      {/* Deliberately not a "Pay Now" button - FR-14 is manual-payment-only, no online
          gateway. This is the single most important line on this tab: a customer looking
          at a real amount owed will look for a way to pay it, so we tell them how, right
          here, instead of leaving them to guess or contact support confused. */}
      {invoice.amountDue > 0 ? (
        <p className="mt-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
          To pay, please contact your service centre or visit in person — we accept Cash, Card,
          or Bank Transfer. Online payment isn't available.
        </p>
      ) : (
        <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          Fully paid — thank you.
        </p>
      )}
    </div>
  );
}

function SummaryTab({ token }: { token: string }) {
  const query = useQuery({ queryKey: ['portal-summary', token], queryFn: () => getPortalSummary(token), retry: false });

  if (query.isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (query.error) return <p className="text-sm text-amber-700">Something went wrong loading this. Please try again shortly.</p>;
  if (!query.data) return null;
  const s = query.data;

  return (
    <div className="space-y-4">
      <div className="space-y-2 text-sm text-slate-600">
        <Row label="Fault / symptom">
          {s.faultCode} / {s.symptomCode}
        </Row>
        <Row label="Coverage">{s.warrantyStatus === 'IW' ? 'Under warranty' : 'Out of warranty'}</Row>
        {s.delivery && <Row label="Delivery">{s.delivery.deliveryNumber} — {friendlyStatus(s.delivery.status)}</Row>}
      </div>

      {s.estimate && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Estimate</p>
          <ul className="space-y-1 border-t border-slate-100 pt-2 text-sm text-slate-700">
            {s.estimate.lineItems.map((li, i) => (
              <li key={i} className="flex justify-between">
                <span>
                  {li.description} × {li.quantity}
                </span>
                <span>{(li.quantity * li.unitPrice).toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Invoice</p>
        <InvoiceView invoice={s.invoice} />
      </div>

      <button
        onClick={() => window.print()}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 print:hidden"
      >
        Print / Save as PDF
      </button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-400">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
