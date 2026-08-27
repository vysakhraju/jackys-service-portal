import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import type { AxiosError } from 'axios';
import { ErrorNotice } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../lib/auth';
import { getAppointment } from '../../lib/appointmentsApi';
import {
  approveCustomer,
  assignSection,
  cancelJobCard,
  createJobCard,
  getJobCardByAppointment,
  validateSn,
  warrantyOverride,
} from '../../lib/jobCardsApi';
import type { JobCard, JobCardSectionValue } from '../../lib/jobCardsTypes';

// Same "one Technical Team Leader (or above)" list as the backend's WARRANTY_OVERRIDE_ROLES
// in job-cards.controller.ts - shown here so the button only appears for someone who could
// actually use it, not as a substitute for the server's own @Roles() check.
const WARRANTY_OVERRIDE_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER'];

// Statuses past which this phase's screens stop - Workshop (Phase 6), QC (Phase 7) and
// Delivery (Phase 8) each pick up their own slice of the remaining lifecycle.
const TERMINAL_FOR_THIS_PHASE: JobCard['status'][] = [
  'WORKSHOP_ASSIGNED',
  'IN_PROGRESS',
  'SPARE_PENDING',
  'READY_FOR_QC',
  'QC_PASSED',
  'DELIVERED',
];

export function JobCardsPage() {
  const [searchParams] = useSearchParams();
  const prefill = searchParams.get('appointmentId') ?? '';
  const [appointmentIdInput, setAppointmentIdInput] = useState(prefill);
  const [activeAppointmentId, setActiveAppointmentId] = useState(prefill);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canWarrantyOverride = !!user && WARRANTY_OVERRIDE_ROLES.includes(user.role.name);

  const appointmentQuery = useQuery({
    queryKey: ['appointment', activeAppointmentId],
    queryFn: () => getAppointment(activeAppointmentId),
    enabled: !!activeAppointmentId,
    retry: false,
  });

  const jobCardQuery = useQuery({
    queryKey: ['job-card', 'by-appointment', activeAppointmentId],
    queryFn: () => getJobCardByAppointment(activeAppointmentId),
    enabled: !!activeAppointmentId,
    retry: false,
  });
  const jobCardNotFound = (jobCardQuery.error as AxiosError)?.response?.status === 404;

  function invalidateJobCard() {
    queryClient.invalidateQueries({ queryKey: ['job-card', 'by-appointment', activeAppointmentId] });
  }

  const createMutation = useMutation({
    mutationFn: () => createJobCard({ appointmentId: activeAppointmentId }),
    onSuccess: invalidateJobCard,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-8 py-8">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Job Cards</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          There's no list here - the backend has no "list all Job Cards" endpoint, only
          look-up by appointment. Paste the appointment id (from the Schedule tab, or the
          link on a completed appointment's detail view) to find or start its Job Card.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setActiveAppointmentId(appointmentIdInput.trim());
        }}
        className="flex items-end gap-2"
      >
        <div className="flex-1">
          <Field label="Appointment ID">
            <input
              className={inputClass}
              value={appointmentIdInput}
              onChange={(e) => setAppointmentIdInput(e.target.value)}
              placeholder="Paste the appointment's id"
            />
          </Field>
        </div>
        <button
          type="submit"
          disabled={!appointmentIdInput.trim()}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Find / Create
        </button>
      </form>

      {activeAppointmentId && (
        <div className="space-y-4">
          {appointmentQuery.isLoading && (
            <p className="text-sm text-slate-400">Looking up the appointment…</p>
          )}
          {appointmentQuery.error ? (
            <ErrorNotice error={appointmentQuery.error} />
          ) : appointmentQuery.data ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-medium text-slate-800">
                {appointmentQuery.data.appointmentNumber} · {appointmentQuery.data.customerName}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Appointment status: <StatusBadge status={appointmentQuery.data.status} />
              </p>
            </div>
          ) : null}

          {jobCardQuery.isLoading && <p className="text-sm text-slate-400">Looking up the Job Card…</p>}
          {jobCardQuery.error && !jobCardNotFound && <ErrorNotice error={jobCardQuery.error} />}

          {jobCardNotFound && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-600">
                No Job Card exists yet for this appointment. Creating one requires the
                appointment to have an invoice number on file and a fully-captured field
                visit (serial number, warranty check, fault/symptom) - the backend blocks
                creation otherwise (FR-05).
              </p>
              <ErrorNotice error={createMutation.error} />
              <button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
                className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Create Job Card
              </button>
            </div>
          )}

          {jobCardQuery.data && (
            <JobCardDetail
              jobCard={jobCardQuery.data}
              canWarrantyOverride={canWarrantyOverride}
              onChanged={invalidateJobCard}
            />
          )}
        </div>
      )}
    </div>
  );
}

function JobCardDetail({
  jobCard,
  canWarrantyOverride,
  onChanged,
}: {
  jobCard: JobCard;
  canWarrantyOverride: boolean;
  onChanged: () => void;
}) {
  const validateSnMutation = useMutation({
    mutationFn: (matches: boolean) => validateSn(jobCard.id, { matches }),
    onSuccess: onChanged,
  });
  const approveCustomerMutation = useMutation({
    mutationFn: (notes: string) => approveCustomer(jobCard.id, { notes: notes || undefined }),
    onSuccess: onChanged,
  });
  const assignSectionMutation = useMutation({
    mutationFn: (section: JobCardSectionValue) => assignSection(jobCard.id, { section }),
    onSuccess: onChanged,
  });
  const overrideMutation = useMutation({
    mutationFn: (input: { newStatus: 'IW' | 'OOW'; reason: string }) => warrantyOverride(jobCard.id, input),
    onSuccess: onChanged,
  });
  const cancelMutation = useMutation({
    mutationFn: (reason: string) => cancelJobCard(jobCard.id, { reason }),
    onSuccess: onChanged,
  });

  const canValidateSn = jobCard.status === 'OPEN';
  const canAssignSection = jobCard.status === 'SN_VALIDATED';
  const blockedByCustomerApproval = jobCard.warrantyStatus === 'OOW' && !jobCard.customerApproved;
  const canOverride =
    canWarrantyOverride && jobCard.status !== 'RWR' && jobCard.status !== 'CANCELLED';
  const canCancel = !['CANCELLED', 'READY_FOR_QC', 'QC_PASSED', 'DELIVERED'].includes(jobCard.status);
  const pastThisPhase = TERMINAL_FOR_THIS_PHASE.includes(jobCard.status);

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-slate-900">{jobCard.jobCardNumber}</p>
          <p className="text-xs text-slate-400">
            {jobCard.brand ?? 'Unknown brand'} · S/N {jobCard.serialNumber}
          </p>
        </div>
        <StatusBadge status={jobCard.status} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <DetailRow label="Section">{jobCard.section?.replaceAll('_', ' ') ?? '—'}</DetailRow>
        <DetailRow label="Fault / symptom">{jobCard.faultCode} / {jobCard.symptomCode}</DetailRow>
        <DetailRow label="Warranty status">
          <StatusBadge status={jobCard.warrantyStatus} />
          {jobCard.warrantyOverridden && (
            <span className="ml-2 text-xs text-slate-400">
              overridden from <StatusBadge status={jobCard.originalWarrantyStatus} /> ({jobCard.overrideCount}x)
            </span>
          )}
        </DetailRow>
        <DetailRow label="S/N validated against invoice">
          {jobCard.snValidatedAgainstInvoice ? 'Yes' : 'Not yet'}
        </DetailRow>
        <DetailRow label="Customer approved (OOW)">{jobCard.customerApproved ? 'Yes' : 'Not yet'}</DetailRow>
        {jobCard.cancellationReason && (
          <DetailRow label="Cancellation reason">{jobCard.cancellationReason}</DetailRow>
        )}
      </div>

      {pastThisPhase && (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
          This job has moved past what this phase's screens cover ({jobCard.status.replaceAll('_', ' ')}) -
          Workshop, QC, and Delivery each get their own screens in later phases.
        </p>
      )}

      {canValidateSn && (
        <ActionCard title="Step 1 · Validate serial number against the physical invoice">
          <ErrorNotice error={validateSnMutation.error} />
          <div className="flex gap-2">
            <button
              onClick={() => validateSnMutation.mutate(true)}
              disabled={validateSnMutation.isPending}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Matches
            </button>
            <button
              onClick={() => validateSnMutation.mutate(false)}
              disabled={validateSnMutation.isPending}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Doesn't match
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            A mismatch stays OPEN (no status change) rather than blocking outright - the
            backend only advances to SN_VALIDATED when this is confirmed as a match.
          </p>
        </ActionCard>
      )}

      {jobCard.warrantyStatus === 'OOW' && jobCard.status !== 'CANCELLED' && (
        <ApproveCustomerCard jobCard={jobCard} mutation={approveCustomerMutation} />
      )}

      {canAssignSection && (
        <ActionCard title="Step 2 · Assign section - the point work actually starts">
          <ErrorNotice error={assignSectionMutation.error} />
          {blockedByCustomerApproval && (
            <p className="mb-2 text-xs text-amber-700">
              This is an out-of-warranty job with no customer approval on file yet - the
              backend will reject a section assignment until "Record customer approval"
              above is done (FR-06).
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => assignSectionMutation.mutate('ON_SITE_REPAIR')}
              disabled={assignSectionMutation.isPending || blockedByCustomerApproval}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              On-site repair
            </button>
            <button
              onClick={() => assignSectionMutation.mutate('WORKSHOP')}
              disabled={assignSectionMutation.isPending || blockedByCustomerApproval}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Workshop
            </button>
          </div>
        </ActionCard>
      )}

      {canOverride && <WarrantyOverrideCard jobCard={jobCard} mutation={overrideMutation} />}

      {canCancel && <CancelCard mutation={cancelMutation} />}
    </div>
  );
}

function ApproveCustomerCard({
  jobCard,
  mutation,
}: {
  jobCard: JobCard;
  mutation: UseMutationResult<JobCard, unknown, string>;
}) {
  const { register, handleSubmit, reset } = useForm<{ notes: string }>({ defaultValues: { notes: '' } });
  return (
    <ActionCard title="Record customer approval (FR-06 stopgap, out-of-warranty jobs)">
      <p className="mb-2 text-xs text-slate-400">
        Manual flag until the real shareable-link/Estimate approval flow ships. Currently:{' '}
        {jobCard.customerApproved ? 'approved' : 'not yet approved'}
        {jobCard.customerApprovalNotes ? ` — "${jobCard.customerApprovalNotes}"` : ''}.
      </p>
      <ErrorNotice error={mutation.error} />
      <form
        onSubmit={handleSubmit((values) => {
          mutation.mutate(values.notes, { onSuccess: () => reset() });
        })}
        className="flex items-end gap-2"
      >
        <div className="flex-1">
          <Field label="Notes (optional)">
            <input className={inputClass} {...register('notes')} placeholder="How approval was obtained" />
          </Field>
        </div>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {jobCard.customerApproved ? 'Update' : 'Approve'}
        </button>
      </form>
    </ActionCard>
  );
}

function WarrantyOverrideCard({
  jobCard,
  mutation,
}: {
  jobCard: JobCard;
  mutation: UseMutationResult<JobCard, unknown, { newStatus: 'IW' | 'OOW'; reason: string }>;
}) {
  const otherStatus = jobCard.warrantyStatus === 'IW' ? 'OOW' : 'IW';
  const { register, handleSubmit, reset } = useForm<{ reason: string }>({ defaultValues: { reason: '' } });
  return (
    <ActionCard title="Warranty Override (FR-17/AC-18 · Technical Team Leader or above)">
      <ErrorNotice error={mutation.error} />
      <form
        onSubmit={handleSubmit((values) => {
          mutation.mutate({ newStatus: otherStatus, reason: values.reason }, { onSuccess: () => reset() });
        })}
        className="space-y-2"
      >
        <Field label={`Reason for overriding to ${otherStatus === 'IW' ? 'In Warranty' : 'Out of Warranty'}`} hint="Minimum 5 characters - written to the audit trail.">
          <textarea className={inputClass} rows={2} {...register('reason', { required: true, minLength: 5 })} />
        </Field>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >
          Override to {otherStatus === 'IW' ? 'In Warranty' : 'Out of Warranty'}
        </button>
      </form>
    </ActionCard>
  );
}

function CancelCard({ mutation }: { mutation: UseMutationResult<JobCard, unknown, string> }) {
  const { register, handleSubmit, reset } = useForm<{ reason: string }>({ defaultValues: { reason: '' } });
  return (
    <ActionCard title="Cancel this Job Card">
      <ErrorNotice error={mutation.error} />
      <form
        onSubmit={handleSubmit((values) => {
          mutation.mutate(values.reason, { onSuccess: () => reset() });
        })}
        className="space-y-2"
      >
        <Field label="Reason" hint="Minimum 3 characters.">
          <textarea className={inputClass} rows={2} {...register('reason', { required: true, minLength: 3 })} />
        </Field>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          Cancel Job Card
        </button>
      </form>
    </ActionCard>
  );
}

function ActionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-slate-100 pt-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">{title}</p>
      {children}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-0.5 text-slate-700">{children}</div>
    </div>
  );
}
