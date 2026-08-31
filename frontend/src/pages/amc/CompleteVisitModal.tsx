import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Modal } from '../../components/Modal';
import { ErrorNotice } from '../../components/DataTable';
import { Field, Checkbox, inputClass } from '../../components/Field';
import { completeAmcVisit } from '../../lib/amcApi';
import type { CompleteAmcVisitInput } from '../../lib/amcTypes';

type FormValues = {
  checklistNotes: string;
  customerSignatureBase64: string;
  extraChargeDescription: string;
  extraChargeAmount: number | '';
  extraChargeApprovedByCustomer: boolean;
};

const EMPTY: FormValues = {
  checklistNotes: '',
  customerSignatureBase64: '',
  extraChargeDescription: '',
  extraChargeAmount: '',
  extraChargeApprovedByCustomer: false,
};

// Completing a PM visit is deliberately its own dedicated flow (POST
// /amc/visits/:appointmentId/complete), not the generic Appointments "Complete" action
// (PUT /appointments/:id/complete) - see SchedulePage's own comment and
// appointments.service.ts's own guard. This form matches CompleteAmcVisitDto exactly, and
// blocks submitting an extra charge without ticking the approval box client-side too,
// before ever hitting the server's own 400 (AMC is pre-paid; nothing extra is billed
// without the customer explicitly approving it on the spot).
export function CompleteVisitModal({
  open,
  onClose,
  appointmentId,
  appointmentNumber,
  onCompleted,
}: {
  open: boolean;
  onClose: () => void;
  appointmentId: string | null;
  appointmentNumber?: string;
  onCompleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, watch, reset } = useForm<FormValues>({ defaultValues: EMPTY });
  const extraChargeAmount = watch('extraChargeAmount');
  const extraChargeApproved = watch('extraChargeApprovedByCustomer');

  const mutation = useMutation({
    mutationFn: (data: CompleteAmcVisitInput) => completeAmcVisit(appointmentId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['amc-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['amc-contracts'] });
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      reset(EMPTY);
      onCompleted?.();
      onClose();
    },
  });

  const hasChargeWithoutApproval = !!extraChargeAmount && Number(extraChargeAmount) > 0 && !extraChargeApproved;

  function onSubmit(values: FormValues) {
    if (hasChargeWithoutApproval) return; // guarded client-side, matching the backend's own 400 reason
    mutation.mutate({
      checklistNotes: values.checklistNotes || undefined,
      customerSignatureBase64: values.customerSignatureBase64 || undefined,
      extraChargeDescription: values.extraChargeDescription || undefined,
      extraChargeAmount: values.extraChargeAmount === '' ? undefined : Number(values.extraChargeAmount),
      extraChargeApprovedByCustomer: values.extraChargeApprovedByCustomer || undefined,
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={`Complete PM visit${appointmentNumber ? ` — ${appointmentNumber}` : ''}`}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <ErrorNotice error={mutation.error} />
        <Field label="Checklist notes (optional)">
          <textarea className={inputClass} rows={3} {...register('checklistNotes')} />
        </Field>
        <Field label="Customer signature (optional)" hint="Base64 capture - no signature-pad component in this app yet, same known limitation as Delivery's POD (Phase 8)">
          <input className={inputClass} placeholder="paste base64, or leave blank" {...register('customerSignatureBase64')} />
        </Field>
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-amber-700">
            Extra charge (only if the customer explicitly approved one on the spot)
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Description">
              <input className={inputClass} {...register('extraChargeDescription')} />
            </Field>
            <Field label="Amount (AED)">
              <input type="number" min="0.01" step="0.01" className={inputClass} {...register('extraChargeAmount', { valueAsNumber: true })} />
            </Field>
          </div>
          <div className="mt-2">
            <Checkbox label="Customer approved this extra charge" {...register('extraChargeApprovedByCustomer')} />
          </div>
          {hasChargeWithoutApproval && (
            <p className="mt-2 text-xs text-red-600">
              An extra charge amount requires the approval box above - AMC coverage is pre-paid, nothing extra is billed without it.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending || hasChargeWithoutApproval}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Complete visit
          </button>
        </div>
      </form>
    </Modal>
  );
}
