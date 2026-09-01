import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { ErrorNotice } from '../../components/DataTable';
import { listYieldByModel } from '../../lib/masterDataApi';
import { harvestDismantlingComponents } from '../../lib/dismantlingApi';
import { HARVESTED_COMPONENT_CONDITIONS, type DismantlingRecord, type HarvestComponentItemInput } from '../../lib/dismantlingTypes';

type FormValues = { components: HarvestComponentItemInput[] };

function emptyLine(): HarvestComponentItemInput {
  return { originalBomItemCode: '', testedCondition: 'GOOD_WORKING', quantity: 1 };
}

// the-fool pre-mortem finding #1 (Frontend Phase 11): a blind free-text BOM item code
// field is dangerous here specifically - ComponentYieldMatrix lookup at harvest time is
// an exact string match, a typo silently and permanently drops eligibleForConversion to
// false (no error, nothing to catch it), and harvest is one-shot - there's no re-harvest
// endpoint to fix it later. Rather than build a full picker component (nothing like that
// exists anywhere else in this app), a <datalist> sourced from the record's own
// ComponentYieldMatrix rows (already fetched via the existing listYieldByModel wrapper
// from Frontend Phase 2) gives real suggestions while keeping the same free-text input
// everywhere else in the app uses - plus a live inline warning if the typed/chosen code
// doesn't match anything in the matrix, so a typo is caught before submit instead of
// discovered at price-and-post weeks later.
export function HarvestModal({
  open,
  onClose,
  record,
  onHarvested,
}: {
  open: boolean;
  onClose: () => void;
  record: DismantlingRecord | null;
  onHarvested: () => void;
}) {
  const { register, control, handleSubmit, watch, reset } = useForm<FormValues>({
    defaultValues: { components: [emptyLine()] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'components' });
  const watchedComponents = watch('components');

  useEffect(() => {
    if (open) reset({ components: [emptyLine()] });
  }, [open, reset]);

  const yieldQuery = useQuery({
    queryKey: ['component-yield-by-model', record?.modelId],
    queryFn: () => listYieldByModel(record!.modelId),
    enabled: open && !!record,
  });

  const mutation = useMutation({
    mutationFn: (data: FormValues) => harvestDismantlingComponents(record!.id, data),
    onSuccess: () => {
      onHarvested();
      onClose();
    },
  });

  if (!record) return null;

  const knownCodes = new Set((yieldQuery.data ?? []).map((y) => y.originalBomItemCode));
  const hasMatrixData = !!yieldQuery.data && yieldQuery.data.length > 0;

  return (
    <Modal open={open} onClose={onClose} title={`Log harvested components — ${record.recordNumber}`}>
      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <ErrorNotice error={mutation.error} />
        <p className="text-xs text-slate-500">
          One-shot — this record moves to COMPONENTS_LOGGED once submitted and there's no
          way to log more components afterward. Codes below are suggested from model{' '}
          <b>{record.modelId}</b>'s known yield matrix; anything else is still logged, but
          won't be eligible for conversion later.
        </p>
        <datalist id="dismantling-known-codes">
          {(yieldQuery.data ?? []).map((y) => (
            <option key={y.id} value={y.originalBomItemCode}>{`${y.itemName} (${y.category})`}</option>
          ))}
        </datalist>
        {fields.map((field, index) => {
          const code = watchedComponents?.[index]?.originalBomItemCode?.trim();
          const notInMatrix = hasMatrixData && !!code && !knownCodes.has(code);
          return (
            <div key={field.id} className="space-y-1 rounded-md border border-slate-200 p-3">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label={index === 0 ? 'BOM item code' : ''} hint={index === 0 ? 'Type or pick a known code for this model' : undefined}>
                    <input
                      className={inputClass}
                      list="dismantling-known-codes"
                      placeholder="COMP-COMPRESSOR-01"
                      {...register(`components.${index}.originalBomItemCode`, { required: true })}
                    />
                  </Field>
                </div>
                <div className="w-40">
                  <Field label={index === 0 ? 'Condition' : ''}>
                    <select className={inputClass} {...register(`components.${index}.testedCondition`, { required: true })}>
                      {HARVESTED_COMPONENT_CONDITIONS.map((c) => (
                        <option key={c} value={c}>
                          {c.replaceAll('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="w-20">
                  <Field label={index === 0 ? 'Qty' : ''}>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      className={inputClass}
                      {...register(`components.${index}.quantity`, { required: true, valueAsNumber: true, min: 1 })}
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
              {notInMatrix && (
                <p className="text-xs text-amber-700">
                  ⚠ "{code}" isn't in {record.modelId}'s known yield matrix — it'll be logged, but won't be eligible
                  for conversion at price-and-post. Double-check for a typo before submitting.
                </p>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => append(emptyLine())}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          + Add component
        </button>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Log harvest
          </button>
        </div>
      </form>
    </Modal>
  );
}
