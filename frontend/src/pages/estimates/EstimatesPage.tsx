import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import type { AxiosError } from 'axios';
import { ErrorNotice } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { StatusBadge } from '../../components/StatusBadge';
import { getJobCard } from '../../lib/jobCardsApi';
import type { JobCard } from '../../lib/jobCardsTypes';
import {
  createEstimate,
  getEstimatesByJobCard,
  recordResponse,
  reviseEstimate,
  sendEstimate,
} from '../../lib/estimatesApi';
import { CONTACT_METHODS } from '../../lib/estimatesTypes';
import type { ContactMethodValue, Estimate, EstimateLineItem } from '../../lib/estimatesTypes';

// An Estimate only makes sense once the Job Card has cleared its own SN check - matches
// EstimatesService.create()'s gate exactly. Shown here so "Create Estimate" only appears
// when the backend would actually accept it, not as a substitute for that check.
const CAN_CREATE_STATUSES = ['SN_VALIDATED'];
// An "active" estimate is one still in play - matches the DRAFT/SENT/APPROVED set
// EstimatesService.create() checks for the 409 "already exists" guard. Anything else
// (REJECTED, EXPIRED) is history, not a live decision surface.
const ACTIVE_STATUSES: Estimate['status'][] = ['DRAFT', 'SENT', 'APPROVED'];

export function EstimatesPage() {
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

  const estimatesQuery = useQuery({
    queryKey: ['estimates', 'by-job-card', activeJobCardId],
    queryFn: () => getEstimatesByJobCard(activeJobCardId),
    enabled: !!activeJobCardId,
    retry: false,
  });

  function onChanged() {
    queryClient.invalidateQueries({ queryKey: ['estimates', 'by-job-card', activeJobCardId] });
  }

  const estimates = estimatesQuery.data ?? [];
  // Backend returns newest first, and guarantees at most one DRAFT/SENT/APPROVED row at a
  // time (create()'s 409 guard) - so the first match here is always THE live one, never a
  // stale one an EXPIRED/REJECTED row could be mistaken for.
  const activeEstimate = estimates.find((e) => ACTIVE_STATUSES.includes(e.status));

  const createMutation = useMutation({
    mutationFn: (lineItems: EstimateLineItem[]) =>
      createEstimate({ jobCardId: activeJobCardId, lineItems }),
    onSuccess: onChanged,
  });

  const jobCard = jobCardQuery.data;
  // Gate "Create" on there being no active estimate already (not on the list being empty -
  // an EXPIRED or REJECTED-with-no-revise-yet job card still needs a fresh Create option,
  // otherwise it's a dead end. the-fool pre-mortem, finding #1).
  const canCreate =
    !!jobCard &&
    jobCard.warrantyStatus === 'OOW' &&
    CAN_CREATE_STATUSES.includes(jobCard.status) &&
    !activeEstimate;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-8 py-8">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Estimates</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Same "no list-all, paste the id" pattern as Job Cards - there's no
          list-all-estimates endpoint either. Paste the Job Card's id (from the Job Cards
          tab, or its "Use the Estimate flow →" link) to see its estimate history.
        </p>
      </div>

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
          {jobCardQuery.isLoading && <p className="text-sm text-slate-400">Looking up the Job Card…</p>}
          {jobCardQuery.error ? (
            <ErrorNotice error={jobCardQuery.error} />
          ) : jobCard ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-medium text-slate-800">
                {jobCard.jobCardNumber} · {jobCard.brand ?? 'Unknown brand'}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Job Card status: <StatusBadge status={jobCard.status} /> · Warranty:{' '}
                <StatusBadge status={jobCard.warrantyStatus} />
              </p>
              {jobCard.warrantyStatus !== 'OOW' && (
                <p className="mt-2 text-xs text-amber-700">
                  This job is in-warranty - warranty covers it, so there's nothing to
                  estimate or invoice. Estimates only apply to out-of-warranty jobs.
                </p>
              )}
            </div>
          ) : null}

          {estimatesQuery.isLoading && <p className="text-sm text-slate-400">Loading estimate history…</p>}
          {estimatesQuery.error && <ErrorNotice error={estimatesQuery.error} />}

          {jobCard && jobCard.warrantyStatus === 'OOW' && (
            <>
              {canCreate && <CreateEstimateCard mutation={createMutation} />}
              {!canCreate && !activeEstimate && jobCard.status !== 'SN_VALIDATED' && estimates.length === 0 && (
                <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                  An Estimate can only be created once this Job Card is SN_VALIDATED
                  (current status: {jobCard.status.replaceAll('_', ' ')}).
                </p>
              )}

              {estimates.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Estimate history ({estimates.length}) - newest first
                  </p>
                  {estimates.map((estimate) =>
                    estimate.id === activeEstimate?.id ? (
                      <ActiveEstimateCard
                        key={estimate.id}
                        estimate={estimate}
                        jobCard={jobCard}
                        onChanged={onChanged}
                      />
                    ) : (
                      <HistoricalEstimateRow key={estimate.id} estimate={estimate} />
                    ),
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CreateEstimateCard({ mutation }: { mutation: UseMutationResult<Estimate, unknown, EstimateLineItem[]> }) {
  const { register, control, handleSubmit, watch, reset } = useForm<{ lineItems: EstimateLineItem[] }>({
    defaultValues: { lineItems: [{ description: '', quantity: 1, unitPrice: 0 }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lineItems' });
  const watchedItems = watch('lineItems');
  const subtotalPreview = useMemo(
    () => watchedItems.reduce((sum, li) => sum + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0), 0),
    [watchedItems],
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="mb-1 text-sm font-medium text-slate-800">Create Estimate</p>
      <p className="mb-3 text-xs text-slate-400">
        VAT is applied server-side at the service centre's rate - the total below is a
        subtotal preview only.
      </p>
      <ErrorNotice error={mutation.error} />
      <form
        onSubmit={handleSubmit((values) => {
          mutation.mutate(
            values.lineItems.map((li) => ({
              description: li.description,
              quantity: Number(li.quantity),
              unitPrice: Number(li.unitPrice),
            })),
            { onSuccess: () => reset() },
          );
        })}
        className="space-y-3"
      >
        {fields.map((field, index) => (
          <div key={field.id} className="flex items-end gap-2">
            <div className="flex-1">
              <Field label={index === 0 ? 'Description' : ''}>
                <input
                  className={inputClass}
                  {...register(`lineItems.${index}.description`, { required: true })}
                  placeholder="e.g. Drum Motor Assembly (Part)"
                />
              </Field>
            </div>
            <div className="w-20">
              <Field label={index === 0 ? 'Qty' : ''}>
                <input
                  type="number"
                  step="1"
                  min="1"
                  className={inputClass}
                  {...register(`lineItems.${index}.quantity`, { required: true, valueAsNumber: true, min: 1 })}
                />
              </Field>
            </div>
            <div className="w-28">
              <Field label={index === 0 ? 'Unit price' : ''}>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className={inputClass}
                  {...register(`lineItems.${index}.unitPrice`, { required: true, valueAsNumber: true, min: 0 })}
                />
              </Field>
            </div>
            <button
              type="button"
              onClick={() => remove(index)}
              disabled={fields.length === 1}
              className="mb-0.5 rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-30"
            >
              Remove
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => append({ description: '', quantity: 1, unitPrice: 0 })}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            + Add line item
          </button>
          <p className="text-sm text-slate-500">
            Subtotal preview: <span className="font-medium text-slate-800">{subtotalPreview.toFixed(2)}</span>
          </p>
        </div>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Create Estimate (DRAFT)
        </button>
      </form>
    </div>
  );
}

function ActiveEstimateCard({
  estimate,
  jobCard,
  onChanged,
}: {
  estimate: Estimate;
  jobCard: JobCard;
  onChanged: () => void;
}) {
  const sendMutation = useMutation({ mutationFn: () => sendEstimate(estimate.id), onSuccess: onChanged });
  const respondMutation = useMutation({
    mutationFn: (data: Parameters<typeof recordResponse>[1]) => recordResponse(estimate.id, data),
    onSuccess: onChanged,
    onError: (error) => {
      // A 409 here means someone else (most likely the customer, via the link) already
      // responded in the moment between this page loading and this submit landing -
      // refetch so the form is replaced by the real, current decision instead of sitting
      // there looking like a no-op failure. (the-fool pre-mortem, finding #4)
      if ((error as AxiosError).response?.status === 409) onChanged();
    },
  });
  const reviseMutation = useMutation({
    mutationFn: (lineItems: EstimateLineItem[] | undefined) => reviseEstimate(estimate.id, { lineItems }),
    onSuccess: onChanged,
  });

  const publicLink = estimate.accessToken
    ? `${window.location.origin}/estimate/${estimate.accessToken}`
    : null;

  return (
    <div className="space-y-4 rounded-lg border border-slate-300 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-slate-900">AED {estimate.totalAmount.toFixed(2)} total</p>
          <p className="text-xs text-slate-400">
            Subtotal {estimate.subtotal.toFixed(2)} + VAT {estimate.vatAmount.toFixed(2)}
          </p>
        </div>
        <StatusBadge status={estimate.status} />
      </div>

      <ul className="space-y-1 text-sm text-slate-600">
        {estimate.lineItems.map((li, i) => (
          <li key={i} className="flex justify-between">
            <span>
              {li.description} × {li.quantity}
            </span>
            <span>{(li.quantity * li.unitPrice).toFixed(2)}</span>
          </li>
        ))}
      </ul>

      {estimate.status === 'DRAFT' && (
        <ActionCard title="Send to customer">
          <ErrorNotice error={sendMutation.error} />
          <p className="mb-2 text-xs text-slate-400">
            Generates a 7-day shareable link and attempts WhatsApp/Email/SMS notification.
          </p>
          <button
            onClick={() => sendMutation.mutate()}
            disabled={sendMutation.isPending}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Send Estimate
          </button>
        </ActionCard>
      )}

      {estimate.status === 'SENT' && (
        <>
          <ActionCard title="Customer link">
            <p className="text-xs text-slate-500">
              Attempted: {estimate.channelsAttempted.join(', ') || 'none'} · Delivered:{' '}
              {estimate.channelsDelivered.join(', ') || 'none'}. Expires{' '}
              {estimate.tokenExpiresAt ? new Date(estimate.tokenExpiresAt).toLocaleString() : '—'}.
            </p>
            {publicLink && (
              <div className="mt-2 flex items-center gap-2">
                <input readOnly value={publicLink} className={`${inputClass} font-mono text-xs`} />
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(publicLink)}
                  className="shrink-0 rounded-md border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Copy
                </button>
              </div>
            )}
          </ActionCard>

          <RecordResponseCard jobCard={jobCard} mutation={respondMutation} />
        </>
      )}

      {estimate.status === 'REJECTED' && (
        <ActionCard title="Revise (FR-08: RWR is not a dead end)">
          <ErrorNotice error={reviseMutation.error} />
          <p className="mb-2 text-xs text-slate-400">
            Creates a new DRAFT linked to this one - leave line items blank to reuse the
            same ones, or edit below.
          </p>
          <ReviseForm previousLineItems={estimate.lineItems} mutation={reviseMutation} />
        </ActionCard>
      )}

      {estimate.status === 'APPROVED' && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          Approved{' '}
          {estimate.respondedAt ? `on ${new Date(estimate.respondedAt).toLocaleString()}` : ''} via{' '}
          {estimate.respondedVia === 'CUSTOMER_LINK' ? 'the customer link' : 'staff-recorded call'}. The
          Job Card's customer-approval flag has been set - Section Assignment is unblocked.
        </p>
      )}
    </div>
  );
}

function RecordResponseCard({
  jobCard,
  mutation,
}: {
  jobCard: JobCard;
  mutation: UseMutationResult<
    Estimate,
    unknown,
    { approved: boolean; contactMethod: ContactMethodValue; contactValue: string; notes: string }
  >;
}) {
  const phone = jobCard.appointment?.customerPhone;
  const email = jobCard.appointment?.customerEmail;
  const { register, handleSubmit, setValue, watch, reset } = useForm<{
    approved: 'true' | 'false';
    contactMethod: ContactMethodValue;
    contactValue: string;
    notes: string;
  }>({
    defaultValues: { approved: 'true', contactMethod: 'PHONE_CALL', contactValue: phone ?? '', notes: '' },
  });
  const contactValue = watch('contactValue');

  return (
    <ActionCard title="Record customer decision (phone/WhatsApp/email call)">
      <p className="mb-2 text-xs text-slate-400">
        Most customers never click the link - use this to record a decision reached by
        contacting them directly. The value below must match exactly what's on file, or
        the backend rejects it (anti-consent-laundering check) - use the buttons to fill
        it in exactly rather than retyping it.
      </p>
      <ErrorNotice error={mutation.error} />
      <form
        onSubmit={handleSubmit((values) => {
          mutation.mutate(
            {
              approved: values.approved === 'true',
              contactMethod: values.contactMethod,
              contactValue: values.contactValue,
              notes: values.notes,
            },
            { onSuccess: () => reset() },
          );
        })}
        className="space-y-2"
      >
        <div className="flex gap-2 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" value="true" {...register('approved')} /> Approved
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" value="false" {...register('approved')} /> Rejected
          </label>
        </div>

        <Field label="Contact method">
          <select className={inputClass} {...register('contactMethod')}>
            {CONTACT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Contact value (must match what's on file)"
          hint={
            phone || email
              ? 'Use one of the on-file values below instead of retyping it.'
              : 'No phone or email on file for this appointment - this will fail.'
          }
        >
          <input className={inputClass} {...register('contactValue', { required: true })} />
        </Field>
        <div className="flex gap-2">
          {phone && (
            <button
              type="button"
              onClick={() => setValue('contactValue', phone)}
              className={`rounded-md border px-2 py-1 text-xs ${contactValue === phone ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
            >
              Use phone on file: {phone}
            </button>
          )}
          {email && (
            <button
              type="button"
              onClick={() => setValue('contactValue', email)}
              className={`rounded-md border px-2 py-1 text-xs ${contactValue === email ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
            >
              Use email on file: {email}
            </button>
          )}
        </div>

        <Field label="Notes" hint="Minimum 10 characters - written to the audit trail.">
          <textarea className={inputClass} rows={2} {...register('notes', { required: true, minLength: 10 })} />
        </Field>

        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Record Decision
        </button>
      </form>
    </ActionCard>
  );
}

function ReviseForm({
  previousLineItems,
  mutation,
}: {
  previousLineItems: EstimateLineItem[];
  mutation: UseMutationResult<Estimate, unknown, EstimateLineItem[] | undefined>;
}) {
  const [reuse, setReuse] = useState(true);
  const { register, control, handleSubmit } = useForm<{ lineItems: EstimateLineItem[] }>({
    defaultValues: { lineItems: previousLineItems },
  });
  const { fields } = useFieldArray({ control, name: 'lineItems' });

  return (
    <form
      onSubmit={handleSubmit((values) => {
        mutation.mutate(reuse ? undefined : values.lineItems);
      })}
      className="space-y-2"
    >
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={reuse} onChange={(e) => setReuse(e.target.checked)} />
        Reuse the same line items unchanged
      </label>
      {!reuse &&
        fields.map((field, index) => (
          <div key={field.id} className="flex gap-2">
            <input className={`${inputClass} flex-1`} {...register(`lineItems.${index}.description`)} />
            <input
              type="number"
              className={`${inputClass} w-16`}
              {...register(`lineItems.${index}.quantity`, { valueAsNumber: true })}
            />
            <input
              type="number"
              step="0.01"
              className={`${inputClass} w-24`}
              {...register(`lineItems.${index}.unitPrice`, { valueAsNumber: true })}
            />
          </div>
        ))}
      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        Create Revised Estimate
      </button>
    </form>
  );
}

function HistoricalEstimateRow({ estimate }: { estimate: Estimate }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50/60 px-3 py-2 text-sm">
      <div>
        <span className="text-slate-500">AED {estimate.totalAmount.toFixed(2)}</span>
        {estimate.previousEstimateId && (
          <span className="ml-2 text-xs text-slate-400">revision of a prior estimate</span>
        )}
      </div>
      <StatusBadge status={estimate.status} />
    </div>
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
