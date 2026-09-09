// One-page, start-to-end view of a single Job Card's lifecycle - Appointment scheduled
// through Delivered - inspired directly by the "redtra" competitor video the user
// referenced: a single screen with a green-highlighted progress stepper, rather than
// having to hop between the Appointments/Job Cards/Workshop/QC/Delivery screens to
// piece the same story together. Deliberately ADDITIVE: every existing screen and menu
// item stays exactly as it is (per the user's explicit "let all the separate menus stays
// as is" instruction) - this is a new page layered on top, reading from the new
// job-card-journey backend module, which itself writes nothing.
//
// Same "no list-all, paste an id" convention this codebase already uses everywhere else
// (Job Cards/Estimates/Workshop/QC all work this way) - except here the search box also
// accepts a JC number, an APT number, a DLV number, or a customer name/phone, and shows
// a pick list, since this page is explicitly the answer to "I don't have the exact job
// card id handy, I just know the customer's name" (the traceability half of the user's
// ask).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorNotice } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../lib/auth';
import { getJobCardJourney, searchJobCardJourney } from '../../lib/jobCardJourneyApi';
import type { JobCardEditLock, JobCardJourney, JourneyStep, JourneyStepState } from '../../lib/jobCardJourneyTypes';

export function JobCardJourneyPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const prefillId = searchParams.get('jobCardId') ?? '';
  const [queryInput, setQueryInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [activeJobCardId, setActiveJobCardId] = useState(prefillId);

  const searchQuery = useQuery({
    queryKey: ['job-card-journey', 'search', activeQuery],
    queryFn: () => searchJobCardJourney(activeQuery),
    enabled: !!activeQuery,
  });

  function selectJobCard(id: string) {
    setActiveJobCardId(id);
    setActiveQuery('');
    setQueryInput('');
    setSearchParams({ jobCardId: id });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-8 py-8">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Job Card Journey</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          The whole lifecycle of one job - appointment through delivery - on one screen.
          Search by Job Card number, Appointment number, Delivery number, or customer name
          / phone, or paste a Job Card id directly if you already have it.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setActiveQuery(queryInput.trim());
        }}
        className="flex items-end gap-2"
      >
        <div className="flex-1">
          <Field label="Search">
            <input
              className={inputClass}
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="JC-0120, APT-0031, DLV-0017, or a customer name / phone"
            />
          </Field>
        </div>
        <button
          type="submit"
          disabled={!queryInput.trim()}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Search
        </button>
      </form>

      {activeQuery && (
        <div className="space-y-2">
          {searchQuery.isLoading && <p className="text-sm text-slate-400">Searching…</p>}
          {searchQuery.error && <ErrorNotice error={searchQuery.error} />}
          {searchQuery.data && searchQuery.data.length === 0 && (
            <p className="text-sm text-slate-400">No matches for "{activeQuery}".</p>
          )}
          {searchQuery.data && searchQuery.data.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {searchQuery.data.map((r) => (
                <li key={r.jobCardId}>
                  <button
                    onClick={() => selectJobCard(r.jobCardId)}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-slate-50"
                  >
                    <span>
                      <span className="font-medium text-slate-900">{r.jobCardNumber}</span>
                      <span className="ml-2 text-slate-500">
                        {r.appointmentNumber} · {r.customerName} · {r.customerPhone}
                      </span>
                      {r.deliveryNumber && <span className="ml-2 text-slate-400">{r.deliveryNumber}</span>}
                    </span>
                    <StatusBadge status={r.jobCardStatus} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activeJobCardId && <JourneyDetail jobCardId={activeJobCardId} />}
    </div>
  );
}

function JourneyDetail({ jobCardId }: { jobCardId: string }) {
  const journeyQuery = useQuery({
    queryKey: ['job-card-journey', jobCardId],
    queryFn: () => getJobCardJourney(jobCardId),
  });

  if (journeyQuery.isLoading) return <p className="text-sm text-slate-400">Loading the journey…</p>;
  if (journeyQuery.error) return <ErrorNotice error={journeyQuery.error} />;
  if (!journeyQuery.data) return null;

  return <JourneyView journey={journeyQuery.data} />;
}

function JourneyView({ journey }: { journey: JobCardJourney }) {
  const { jobCard, appointment, visit, taskPauses, spareRequest, estimates, invoice, delivery, steps, editLock } =
    journey;
  const openPause = taskPauses.find((p) => p.resumedAt === null);

  return (
    <div className="space-y-6">
      <EditLockBanner editLock={editLock} />

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-slate-900">{jobCard.jobCardNumber}</p>
            <p className="text-xs text-slate-400">
              {appointment.appointmentNumber} · {appointment.customerName} · {appointment.customerPhone}
              {delivery?.deliveryNumber && ` · ${delivery.deliveryNumber}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {jobCard.lane && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                Lane {jobCard.lane}
              </span>
            )}
            <StatusBadge status={jobCard.status} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            to={`/job-cards?appointmentId=${jobCard.appointmentId}`}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Job Card screen →
          </Link>
          {jobCard.section === 'WORKSHOP' && (
            <Link
              to={`/workshop-inventory/workshop?jobCardId=${jobCard.id}`}
              className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Workshop screen →
            </Link>
          )}
          {['READY_FOR_QC', 'QC_PASSED'].includes(jobCard.status) && (
            <Link
              to={`/qc-permissions/qc?jobCardId=${jobCard.id}`}
              className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              QC screen →
            </Link>
          )}
          {jobCard.status === 'QC_PASSED' && !delivery && (
            <Link
              to="/delivery/ready"
              className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Ready for Delivery →
            </Link>
          )}
          {delivery && (
            <Link
              to="/delivery/deliveries"
              className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Deliveries screen →
            </Link>
          )}
          {invoice && (
            <Link
              to="/finance/invoices"
              className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Invoices screen →
            </Link>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">Progress</p>
        <JourneyStepper steps={steps} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <InfoCard title="Appointment & customer">
          <DetailRow label="Scheduled for">{new Date(appointment.scheduledAt).toLocaleString()}</DetailRow>
          <DetailRow label="Channel">{appointment.channel.replaceAll('_', ' ')}</DetailRow>
          <DetailRow label="Address">{appointment.customerAddress ?? '—'}</DetailRow>
          <DetailRow label="Brand / model">
            {appointment.brand ?? '—'} {appointment.modelNumber ?? ''}
          </DetailRow>
        </InfoCard>

        <InfoCard title="Technician visit">
          {visit ? (
            <>
              <DetailRow label="Started">{new Date(visit.startedAt).toLocaleString()}</DetailRow>
              <DetailRow label="Serial number">{visit.serialNumber ?? '—'}</DetailRow>
              <DetailRow label="Fault / symptom">
                {visit.faultCode ?? '—'} / {visit.symptomCode ?? '—'}
              </DetailRow>
              <DetailRow label="Warranty (as captured)">
                {visit.warrantyStatus ? <StatusBadge status={visit.warrantyStatus} /> : '—'}
              </DetailRow>
            </>
          ) : (
            <p className="text-sm text-slate-400">No visit on file yet.</p>
          )}
        </InfoCard>

        <InfoCard title="Spare parts">
          {spareRequest ? (
            <>
              <DetailRow label="Status">
                <StatusBadge status={spareRequest.status} />
              </DetailRow>
              <DetailRow label="Requested / reserved">
                {spareRequest.quantityRequested} / {spareRequest.quantityReserved}
              </DetailRow>
            </>
          ) : (
            <p className="text-sm text-slate-400">No spare part request on this job.</p>
          )}
          {openPause && (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
              Task timer currently paused - {openPause.reason.replaceAll('_', ' ')}
              {openPause.notes && ` ("${openPause.notes}")`}
            </p>
          )}
        </InfoCard>

        <InfoCard title="QC">
          <DetailRow label="Rejections so far">{jobCard.qcRejectionCount}</DetailRow>
          {jobCard.lastQcRejectionReason && (
            <DetailRow label="Last rejection reason">{jobCard.lastQcRejectionReason}</DetailRow>
          )}
          {jobCard.qcApprovedAt && (
            <DetailRow label="Approved">{new Date(jobCard.qcApprovedAt).toLocaleString()}</DetailRow>
          )}
        </InfoCard>

        <InfoCard title="Estimates">
          {estimates.length === 0 ? (
            <p className="text-sm text-slate-400">No estimates on this job.</p>
          ) : (
            <ul className="space-y-1.5">
              {estimates.map((e) => (
                <li key={e.id} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{e.totalAmount.toFixed(2)}</span>
                  <StatusBadge status={e.status} />
                </li>
              ))}
            </ul>
          )}
        </InfoCard>

        <InfoCard title="Delivery & invoicing">
          {delivery ? (
            <>
              <DetailRow label="Delivery">
                {delivery.deliveryNumber} · <StatusBadge status={delivery.status} />
              </DetailRow>
              {delivery.dispatchedAt && (
                <DetailRow label="Dispatched">{new Date(delivery.dispatchedAt).toLocaleString()}</DetailRow>
              )}
              {delivery.deliveredAt && (
                <DetailRow label="Delivered">{new Date(delivery.deliveredAt).toLocaleString()}</DetailRow>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-400">No delivery started yet.</p>
          )}
          {invoice && (
            <DetailRow label="Invoice">
              {invoice.invoiceNumber} · {invoice.amount.toFixed(2)} · <StatusBadge status={invoice.status} />
            </DetailRow>
          )}
        </InfoCard>
      </div>
    </div>
  );
}

// Bullets with green highlight as the job progresses, per the user's explicit request -
// 'done'/'current' render filled/emphasized, 'pending' stays outline, 'skipped' and
// 'cancelled' get their own muted/red treatment so a truncated (cancelled) journey never
// reads as if the rest just hasn't happened yet.
const STEP_DOT: Record<JourneyStepState, string> = {
  done: 'bg-emerald-600 text-white',
  current: 'border-2 border-emerald-600 text-emerald-700',
  pending: 'border border-slate-300 text-slate-300',
  skipped: 'border border-slate-200 text-slate-300',
  cancelled: 'bg-red-600 text-white',
};
const STEP_LABEL: Record<JourneyStepState, string> = {
  done: 'text-slate-700',
  current: 'font-semibold text-emerald-700',
  pending: 'text-slate-400',
  skipped: 'text-slate-300 line-through',
  cancelled: 'font-semibold text-red-700',
};

/**
 * Late-stage edit-lock banner - 2026-09-09, backed by job-card-edit-lock.util.ts on the
 * backend. Display-only: nothing here enforces anything, it just tells whoever's looking
 * whether they personally can still amend an Estimate/Invoice (or a future generic edit
 * screen) on this Job Card, or need a Super Admin/Service Head/Team Leader/Accountant/
 * Finance Manager. Renders nothing when the Job Card isn't late-stage at all.
 */
function EditLockBanner({ editLock }: { editLock: JobCardEditLock }) {
  const { user } = useAuth();
  if (!editLock.locked) return null;

  const currentUserCanEdit = !!user && editLock.allowedRoles.includes(user.role.name);

  return (
    <div
      role="status"
      className={`rounded-lg border p-3 text-sm ${
        currentUserCanEdit
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-slate-300 bg-slate-100 text-slate-600'
      }`}
    >
      <p className="font-medium">{currentUserCanEdit ? 'Late-stage job card' : 'Read-only — late-stage job card'}</p>
      <p className="mt-0.5">{editLock.reason}</p>
    </div>
  );
}

function JourneyStepper({ steps }: { steps: JourneyStep[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((step, i) => (
        <li key={step.key} className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${STEP_DOT[step.state]}`}
            >
              {step.state === 'done' ? '✓' : step.state === 'cancelled' ? '✕' : ''}
            </span>
            {i < steps.length - 1 && <span className="mt-0.5 h-4 w-px bg-slate-200" />}
          </div>
          <div className="pb-1">
            <p className={`text-sm ${STEP_LABEL[step.state]}`}>
              {step.label}
              {step.at && <span className="ml-2 text-xs font-normal text-slate-400">{new Date(step.at).toLocaleString()}</span>}
            </p>
            {step.detail && <p className="text-xs text-slate-400">{step.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-right text-slate-700">{children}</span>
    </div>
  );
}
