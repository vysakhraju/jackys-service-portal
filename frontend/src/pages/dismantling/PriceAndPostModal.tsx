import { useEffect } from 'react';
import type { AxiosError } from 'axios';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Field, Checkbox, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { priceAndPostDismantlingRecord } from '../../lib/dismantlingApi';
import type { DismantlingRecord } from '../../lib/dismantlingTypes';

type RowValues = { originalBomItemCode: string; selected: boolean; recoveryUnitPrice: number | ''; quantityToConvert: number | '' };
type FormValues = { rows: RowValues[]; confirmForfeit: boolean };

function rowsFor(record: DismantlingRecord): RowValues[] {
  return record.harvestedComponents
    .filter((c) => c.eligibleForConversion && !c.selectedForConversion)
    .map((c) => ({ originalBomItemCode: c.originalBomItemCode, selected: false, recoveryUnitPrice: '', quantityToConvert: c.quantity }));
}

// the-fool pre-mortem findings #2 and #3 (Frontend Phase 11) both live in this form:
//
// #2 - Price & Post is the only pricing pass a record ever gets (harvest is one-shot,
// and once this posts the record moves to terminal POSTED with no way back). A manager
// converting only some of the eligible components could easily assume the rest can be
// priced "later" - they can't; the remainder's recovery value is permanently forfeited.
// The banner below is unmissable, and submitting a partial selection requires an
// explicit confirmation checkbox rather than just a plain submit button.
//
// #3 - two people with price-and-post access opening the same record (plausible on a
// small team rotating through all three AC-31 actor roles) can race: the second submit
// hits the backend's re-check-inside-the-lock and gets back a 409 Conflict. The generic
// ErrorNotice component would show that as an undifferentiated red box; this form
// catches 409 specifically and explains what happened, and - critically - never calls
// reset() on error, so the manager's typed-in prices aren't lost.
export function PriceAndPostModal({
  open,
  onClose,
  record,
  onPosted,
}: {
  open: boolean;
  onClose: () => void;
  record: DismantlingRecord | null;
  onPosted: () => void;
}) {
  const { register, handleSubmit, watch, reset } = useForm<FormValues>({
    defaultValues: { rows: record ? rowsFor(record) : [], confirmForfeit: false },
  });

  useEffect(() => {
    if (open && record) reset({ rows: rowsFor(record), confirmForfeit: false });
  }, [open, record, reset]);

  const watchedRows = watch('rows') ?? [];
  const confirmForfeit = watch('confirmForfeit');

  // Deliberately not useMemo'd: react-hook-form's watch() can reuse/mutate array
  // instances across renders, which made a reference-keyed useMemo here miss updates
  // (selectedRows stayed stale after a checkbox toggle). The array is tiny, so a plain
  // recompute every render is simpler and correct.
  const selectedRows = watchedRows.filter((r) => r.selected);
  const selectedCount = selectedRows.length;
  const totalEligible = watchedRows.length;
  const isPartial = selectedCount > 0 && selectedCount < totalEligible;

  const previewTotal = selectedRows.reduce((sum, r) => {
    const price = Number(r.recoveryUnitPrice) || 0;
    const qty = Number(r.quantityToConvert) || 0;
    return sum + price * qty;
  }, 0);

  const hasInvalidSelectedRow = selectedRows.some((r) => {
    const price = Number(r.recoveryUnitPrice);
    const qty = Number(r.quantityToConvert);
    return !(price > 0) || !(qty >= 1);
  });

  const canSubmit = selectedCount > 0 && !hasInvalidSelectedRow && (!isPartial || confirmForfeit);

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      priceAndPostDismantlingRecord(record!.id, {
        conversions: values.rows
          .filter((r) => r.selected)
          .map((r) => ({
            originalBomItemCode: r.originalBomItemCode,
            recoveryUnitPrice: Number(r.recoveryUnitPrice),
            quantityToConvert: Number(r.quantityToConvert),
          })),
      }),
    onSuccess: () => {
      onPosted();
      onClose();
    },
    // Deliberately no reset() here in either branch - see finding #3 above.
  });

  if (!record) return null;

  const conflict = (mutation.error as AxiosError)?.response?.status === 409;

  return (
    <Modal open={open} onClose={onClose} title={`Price & post — ${record.recordNumber}`}>
      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        {mutation.error &&
          (conflict ? (
            <div className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This record was updated by someone else since you opened it — close this dialog, reload the record, and
              try again. Your entries below haven't been cleared.
            </div>
          ) : (
            <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {(() => {
                const message = (mutation.error as AxiosError<{ message?: string | string[] }>)?.response?.data?.message;
                return Array.isArray(message) ? message.join(', ') : message || 'Something went wrong.';
              })()}
            </div>
          ))}

        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          This is the <b>only</b> pricing pass this record will ever get — posting moves it to POSTED,
          permanently. Any component you don't select, or convert at less than its full harvested quantity, is
          forfeited for good; there's no way to come back and price the rest later.
        </div>

        {totalEligible === 0 && <p className="text-sm text-slate-500">No components on this record are eligible for conversion.</p>}

        {watchedRows.map((row, index) => {
          const component = record.harvestedComponents.find((c) => c.originalBomItemCode === row.originalBomItemCode);
          return (
            <div key={row.originalBomItemCode} className="space-y-2 rounded-md border border-slate-200 p-3">
              <Checkbox
                label={`${row.originalBomItemCode}${component?.itemName ? ` — ${component.itemName}` : ''} (harvested qty ${component?.quantity ?? '?'})`}
                {...register(`rows.${index}.selected`)}
              />
              {watchedRows[index].selected && (
                <div className="grid grid-cols-2 gap-4 pl-6">
                  <Field label="Recovery unit price (AED)">
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      className={inputClass}
                      {...register(`rows.${index}.recoveryUnitPrice`, { valueAsNumber: true })}
                    />
                  </Field>
                  <Field label="Quantity to convert" hint={`Up to ${component?.quantity ?? '?'} (defaults to full harvested quantity)`}>
                    <input
                      type="number"
                      min="1"
                      max={component?.quantity}
                      step="1"
                      className={inputClass}
                      {...register(`rows.${index}.quantityToConvert`, { valueAsNumber: true })}
                    />
                  </Field>
                </div>
              )}
            </div>
          );
        })}

        {isPartial && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
            <Checkbox
              label={`I understand the ${totalEligible - selectedCount} component(s) I haven't selected will be permanently forfeited — they can never be converted after this posts.`}
              {...register('confirmForfeit')}
            />
          </div>
        )}

        {selectedCount > 0 && (
          <p className="text-sm text-slate-600">
            Total recovered value preview: <span className="font-medium text-slate-900">AED {previewTotal.toFixed(2)}</span>
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending || !canSubmit}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Post recovery
          </button>
        </div>
      </form>
    </Modal>
  );
}
