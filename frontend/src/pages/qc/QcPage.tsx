import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { ErrorNotice } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../lib/auth';
import { getJobCard, qcApprove, qcReject } from '../../lib/jobCardsApi';
import type { JobCard, QcApproveBlocker } from '../../lib/jobCardsTypes';

// The role FLOOR only - who can even attempt qc/approve or qc/reject, mirroring
// job-cards.controller.ts's QC_GATE_ROLES exactly. It is deliberately NOT the real gate:
// the backend separately requires an admin-assigned QC_APPROVAL grant
// (PermissionsService.requireActiveGrant), which this screen has no way to check ahead of
// time (GET /permissions/users/:userId is admin-only - the-fool pre-mortem finding #1).
// A role-floor member without the grant sees the backend's own 403 message instead.
const QC_GATE_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER', 'CCE', 'QC_OFFICER'];

export function QcPage() {
  const [searchParams] = useSearchParams();
  const prefill = searchParams.get('jobCardId') ?? '';
  const [jobCardIdInput, setJobCardIdInput] = useState(prefill);
  const [activeJobCardId, setActiveJobCardId] = useState(prefill);
  const queryClient = useQueryClient();

  const jobCardQuery = useQuery({
    queryKey: ['job-card', activeJobCardId],
    queryFn: () => getJobCard(activeJobCardId),
    enabled: !!activeJobCardId,
    retry: false,
  });

  function onChanged() {
    queryClient.invalidateQueries({ queryKey: ['job-card', activeJobCardId] });
  }

  return (
    <div className="max-w-3xl space-y-6">
      <p className="max-w-2xl text-sm text-slate-500">
        Same "no list-all, paste the id" pattern as Workshop and Job Cards - there's no QC
        queue endpoint. Paste the Job Card's id (or use "Go to QC →" from its Workshop
        screen entry, once READY_FOR_QC) to approve or reject it.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setActiveJobCardId(jobCardIdInput.trim());
        }}
        className="flex items-end gap-2"
      >
        <div className="flex-1">
          <Field label="Job Card ID">
            <input
              className={inputClass}
              value={jobCardIdInput}
              onChange={(e) => setJobCardIdInput(e.target.value)}
              placeholder="Paste the job card's id"
            />
          </Field>
        </div>
        <button
          type="submit"
          disabled={!jobCardIdInput.trim()}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Find
        </button>
      </form>

      {activeJobCardId && (
        <div className="space-y-4">
          {jobCardQuery.isLoading && <p className="text-sm text-slate-400">Loading job card…</p>}
          {jobCardQuery.error && <ErrorNotice error={jobCardQuery.error} />}
          {jobCardQuery.data && <QcDetail jobCard={jobCardQuery.data} onChanged={onChanged} />}
        </div>
      )}
    </div>
  );
}

function QcDetail({ jobCard, onChanged }: { jobCard: JobCard; onChanged: () => void }) {
  const { user } = useAuth();
  const isQcGateRole = !!user && QC_GATE_ROLES.includes(user.role.name);

  const isReadyForQc = jobCard.status === 'READY_FOR_QC';
  // Mirrors WorkshopPage's own phase-boundary framing: everything before READY_FOR_QC
  // belongs on the Workshop screen, everything QC_PASSED/DELIVERED/CANCELLED/RWR is past
  // this screen entirely.
  const notYetReady = ['OPEN', 'SN_VALIDATED', 'SECTION_ASSIGNED', 'RWR', 'WORKSHOP_ASSIGNED', 'IN_PROGRESS', 'SPARE_PENDING'].includes(
    jobCard.status,
  );
  const pastQc = ['QC_PASSED', 'DELIVERED', 'CANCELLED'].includes(jobCard.status);

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-slate-900">{jobCard.jobCardNumber}</p>
          <p className="text-xs text-slate-400">
            {jobCard.brand ?? 'Unknown brand'} · S/N {jobCard.serialNumber}
            {jobCard.qcRejectionCount > 0 && (
              <span className="ml-1 text-amber-600">· rejected {jobCard.qcRejectionCount}x before</span>
            )}
          </p>
        </div>
        <StatusBadge status={jobCard.status} />
      </div>

      {notYetReady && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          This job is {jobCard.status.replaceAll('_', ' ')} - not yet READY_FOR_QC. Go to the{' '}
          <Link to={`/workshop-inventory/workshop?jobCardId=${jobCard.id}`} className="font-medium underline">
            Workshop screen
          </Link>{' '}
          to move it forward.
        </p>
      )}

      {pastQc && (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
          This job is {jobCard.status.replaceAll('_', ' ')} - past what this screen covers.{' '}
          {jobCard.status === 'QC_PASSED' && (
            <Link to="/delivery/ready" className="font-medium underline">
              Go to Delivery →
            </Link>
          )}
        </p>
      )}

      {isReadyForQc && !isQcGateRole && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Your role ({user?.role.displayName}) isn't one the backend allows to attempt QC approval/rejection at all
          - ask an admin.
        </p>
      )}

      {isReadyForQc && isQcGateRole && <QcActions jobCard={jobCard} onChanged={onChanged} />}
    </div>
  );
}

function QcActions({ jobCard, onChanged }: { jobCard: JobCard; onChanged: () => void }) {
  const approveMutation = useMutation({ mutationFn: () => qcApprove(jobCard.id), onSuccess: onChanged });
  const rejectMutation = useMutation({
    mutationFn: (reason: string) => qcReject(jobCard.id, { reason }),
    onSuccess: onChanged,
  });
  const { register, handleSubmit, reset } = useForm<{ reason: string }>({ defaultValues: { reason: '' } });
  const [justRejected, setJustRejected] = useState(false);

  // The-fool pre-mortem finding #2: a stock shortfall 409s as { message, blockers }, and
  // the shared ErrorNotice only reads .message - so that shape needs its own rendering,
  // not just ErrorNotice, or the blockers array is silently dropped.
  const blockers = (approveMutation.error as AxiosError<{ message?: string; blockers?: QcApproveBlocker[] }> | null)
    ?.response?.data?.blockers;

  return (
    <div className="space-y-4 border-t border-slate-100 pt-4">
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Approve</p>
        {approveMutation.error && !blockers?.length && <ErrorNotice error={approveMutation.error} />}
        {!!blockers?.length && (
          <div className="mb-3 space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <p className="font-medium">
              Blocked - stock isn't there to consume for {blockers.length} reservation{blockers.length === 1 ? '' : 's'}:
            </p>
            <ul className="list-disc space-y-0.5 pl-4">
              {blockers.map((b) => (
                <li key={b.reservationId}>
                  Spare part {b.sparePartId.slice(0, 8)}… - reserved {b.quantityReserved} of {b.quantityRequested} requested
                </li>
              ))}
            </ul>
            <Link to={`/workshop-inventory/workshop?jobCardId=${jobCard.id}`} className="font-medium underline">
              Go to the Workshop screen to top up or resolve →
            </Link>
          </div>
        )}
        <p className="mb-2 text-xs text-slate-400">
          Requires the QC_APPROVAL permission (admin-assignable to any user, on the Permissions tab). On success,
          reserved stock is consumed from Main Store into Damage Location.
        </p>
        <button
          onClick={() => approveMutation.mutate()}
          disabled={approveMutation.isPending}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Approve → QC Passed
        </button>
      </div>

      <div className="border-t border-slate-100 pt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Reject</p>
        {justRejected ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Rejected - the job is back to IN_PROGRESS. Go to the{' '}
            <Link to={`/workshop-inventory/workshop?jobCardId=${jobCard.id}`} className="font-medium underline">
              Workshop screen
            </Link>{' '}
            to act on it next.
          </p>
        ) : (
          <>
            <ErrorNotice error={rejectMutation.error} />
            <p className="mb-2 text-xs text-slate-400">
              Sends the job back to IN_PROGRESS and requires a reason (5-500 characters) for the audit trail. Same
              QC_APPROVAL permission gate as Approve.
            </p>
            <form
              onSubmit={handleSubmit((values) =>
                rejectMutation.mutate(values.reason, {
                  onSuccess: () => {
                    reset();
                    setJustRejected(true);
                  },
                }),
              )}
              className="flex items-end gap-2"
            >
              <div className="flex-1">
                <Field label="Rejection reason">
                  <input className={inputClass} {...register('reason', { required: true, minLength: 5, maxLength: 500 })} />
                </Field>
              </div>
              <button
                type="submit"
                disabled={rejectMutation.isPending}
                className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Reject
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
