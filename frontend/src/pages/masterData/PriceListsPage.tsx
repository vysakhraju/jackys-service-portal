import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ActiveBadge, DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Checkbox, Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { createPriceList, getPriceList } from '../../lib/masterDataApi';
import { SERVICE_ACTIVITY_TYPES, type CreatePriceListInput, type ServicePriceList } from '../../lib/masterDataTypes';

type FormValues = {
  activityType: string;
  modelId: string;
  priceB2B: number;
  priceB2C: number;
  warrantyLaborCost: number;
  interdepartmentLaborCost: number;
  currency: string;
  isActive: boolean;
};

export function PriceListsPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [activityType, setActivityType] = useState<string>(SERVICE_ACTIVITY_TYPES[0]);
  const [modelIdFilter, setModelIdFilter] = useState('');
  const [mutationError, setMutationError] = useState<unknown>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['price-lists', activityType, modelIdFilter],
    queryFn: () => getPriceList(activityType, modelIdFilter || undefined),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      activityType: SERVICE_ACTIVITY_TYPES[0],
      modelId: '',
      priceB2B: 0,
      priceB2C: 0,
      warrantyLaborCost: 0,
      interdepartmentLaborCost: 0,
      currency: 'AED',
      isActive: true,
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: CreatePriceListInput) => createPriceList(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-lists'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  function openCreate() {
    setMutationError(null);
    reset();
    setModalOpen(true);
  }

  const columns: Column<ServicePriceList>[] = [
    { key: 'activityType', label: 'Activity', render: (r) => <span className="font-medium text-slate-900">{r.activityType}</span> },
    { key: 'modelId', label: 'Model ID', render: (r) => r.modelId ?? 'All models' },
    { key: 'priceB2B', label: 'B2B', render: (r) => Number(r.priceB2B).toFixed(2) },
    { key: 'priceB2C', label: 'B2C', render: (r) => Number(r.priceB2C).toFixed(2) },
    { key: 'warrantyLabor', label: 'Warranty labor', render: (r) => Number(r.warrantyLaborCost).toFixed(2) },
    { key: 'interdeptLabor', label: 'Interdept labor', render: (r) => Number(r.interdepartmentLaborCost).toFixed(2) },
    { key: 'currency', label: 'Currency', render: (r) => r.currency ?? '—' },
    { key: 'status', label: 'Status', render: (r) => <ActiveBadge active={r.isActive} /> },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500">
          Pricing by service activity type. The backend only exposes "list by activity type" —
          pick one below to see its price rows.
        </p>
        <button
          onClick={openCreate}
          className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          + New Price Row
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium text-slate-500">Activity type</label>
        <select className={`${inputClass} w-auto`} value={activityType} onChange={(e) => setActivityType(e.target.value)}>
          {SERVICE_ACTIVITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <label className="ml-2 text-xs font-medium text-slate-500">Model ID (optional)</label>
        <input
          className={`${inputClass} w-auto`}
          placeholder="e.g. WA80J5710"
          value={modelIdFilter}
          onChange={(e) => setModelIdFilter(e.target.value)}
        />
      </div>

      <DataTable
        columns={columns}
        rows={data}
        isLoading={isLoading}
        error={error}
        emptyMessage={`No price rows for ${activityType.replace(/_/g, ' ')} yet.`}
      />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Price List Row">
        <form
          onSubmit={handleSubmit((values) =>
            createMutation.mutate({ ...values, activityType: values.activityType as CreatePriceListInput['activityType'] }),
          )}
          className="space-y-4"
        >
          <ErrorNotice error={mutationError} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Activity type">
              <select className={inputClass} {...register('activityType', { required: true })}>
                {SERVICE_ACTIVITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Model ID" hint="Leave blank for a price that applies to all models">
              <input className={inputClass} {...register('modelId')} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="B2B price" error={errors.priceB2B?.message}>
              <input type="number" step="0.01" className={inputClass} {...register('priceB2B', { valueAsNumber: true })} />
            </Field>
            <Field label="B2C price">
              <input type="number" step="0.01" className={inputClass} {...register('priceB2C', { valueAsNumber: true })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Warranty labor cost">
              <input type="number" step="0.01" className={inputClass} {...register('warrantyLaborCost', { valueAsNumber: true })} />
            </Field>
            <Field label="Interdepartment labor cost">
              <input
                type="number"
                step="0.01"
                className={inputClass}
                {...register('interdepartmentLaborCost', { valueAsNumber: true })}
              />
            </Field>
          </div>
          <Field label="Currency">
            <input className={inputClass} placeholder="AED" {...register('currency')} />
          </Field>
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
