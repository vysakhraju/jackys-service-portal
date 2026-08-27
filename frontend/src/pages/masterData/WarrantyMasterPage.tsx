import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ErrorNotice } from '../../components/DataTable';
import { Checkbox, Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { checkWarranty, createWarrantyMaster } from '../../lib/masterDataApi';

type CreateFormValues = {
  serialNumberRange: string;
  brand: string;
  model: string;
  warrantyPeriodMonths: number;
  supplier: string;
  effectiveFrom: string;
  effectiveTo: string;
  isActive: boolean;
};

export function WarrantyMasterPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [mutationError, setMutationError] = useState<unknown>(null);
  const [createdOk, setCreatedOk] = useState(false);

  const [serialNumber, setSerialNumber] = useState('');
  const [brandFilter, setBrandFilter] = useState('');

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateFormValues>({
    defaultValues: {
      serialNumberRange: '',
      brand: '',
      model: '',
      warrantyPeriodMonths: 12,
      supplier: '',
      effectiveFrom: '',
      effectiveTo: '',
      isActive: true,
    },
  });

  const createMutation = useMutation({
    mutationFn: (values: CreateFormValues) =>
      createWarrantyMaster({
        ...values,
        effectiveFrom: values.effectiveFrom || undefined,
        effectiveTo: values.effectiveTo || undefined,
      }),
    onSuccess: () => {
      setModalOpen(false);
      setCreatedOk(true);
      setTimeout(() => setCreatedOk(false), 4000);
    },
    onError: (err) => setMutationError(err),
  });

  const checkMutation = useMutation({
    mutationFn: () => checkWarranty(serialNumber, brandFilter || undefined),
  });

  function openCreate() {
    setMutationError(null);
    reset();
    setModalOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500">
          Serial-number-range-based warranty rules. The backend has no "list all" endpoint
          here — only create and "check warranty by serial number" (the same lookup a
          technician's S/N validation step uses), so that's what this screen offers.
        </p>
        <button
          onClick={openCreate}
          className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          + New Warranty Rule
        </button>
      </div>

      {createdOk && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Warranty rule created.
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Check warranty by serial number</h2>
        <p className="mt-1 text-xs text-slate-400">
          Mirrors the check technician field visits use to validate S/N + warranty before a job card opens.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Serial number">
            <input className={`${inputClass} w-56`} value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
          </Field>
          <Field label="Brand (optional)">
            <input className={`${inputClass} w-40`} value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} />
          </Field>
          <button
            onClick={() => serialNumber && checkMutation.mutate()}
            disabled={!serialNumber || checkMutation.isPending}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Check
          </button>
        </div>

        {checkMutation.isError && (
          <div className="mt-3">
            <ErrorNotice error={checkMutation.error} />
          </div>
        )}

        {checkMutation.isSuccess && (
          <pre className="mt-3 overflow-x-auto rounded-md bg-slate-50 p-3 text-xs text-slate-700">
            {JSON.stringify(checkMutation.data, null, 2)}
          </pre>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Warranty Master Rule">
        <form onSubmit={handleSubmit((values) => createMutation.mutate(values))} className="space-y-4">
          <ErrorNotice error={mutationError} />
          <Field label="Serial number range" error={errors.serialNumberRange?.message} hint="Inclusive range, e.g. SN100000-SN199999">
            <input className={inputClass} {...register('serialNumberRange', { required: 'Required' })} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Brand" error={errors.brand?.message}>
              <input className={inputClass} placeholder="Samsung" {...register('brand', { required: 'Required' })} />
            </Field>
            <Field label="Model" error={errors.model?.message}>
              <input className={inputClass} placeholder="WA80J5710" {...register('model', { required: 'Required' })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Warranty period (months)">
              <input type="number" className={inputClass} {...register('warrantyPeriodMonths', { valueAsNumber: true })} />
            </Field>
            <Field label="Supplier" error={errors.supplier?.message}>
              <input className={inputClass} placeholder="Samsung Gulf" {...register('supplier', { required: 'Required' })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Effective from">
              <input type="date" className={inputClass} {...register('effectiveFrom')} />
            </Field>
            <Field label="Effective to">
              <input type="date" className={inputClass} {...register('effectiveTo')} />
            </Field>
          </div>
          <Checkbox label="Active" {...register('isActive')} />

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || createMutation.isPending}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
