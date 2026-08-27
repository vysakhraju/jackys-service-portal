import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ActiveBadge, DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Checkbox, Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { createComponentYield, listYieldByCategory, listYieldByModel } from '../../lib/masterDataApi';
import { RECOVERY_CATEGORIES, type ComponentYieldMatrix, type CreateComponentYieldInput } from '../../lib/masterDataTypes';

type FormValues = {
  modelId: string;
  originalBomItemCode: string;
  itemName: string;
  category: string;
  defaultRecoveryEvaluation: number;
  convertedSparePartCode: string;
  isActive: boolean;
};

export function ComponentYieldPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<'category' | 'model'>('category');
  const [category, setCategory] = useState<string>(RECOVERY_CATEGORIES[0]);
  const [modelId, setModelId] = useState('');
  const [modelIdSearched, setModelIdSearched] = useState('');
  const [mutationError, setMutationError] = useState<unknown>(null);

  const categoryQuery = useQuery({
    queryKey: ['component-yield', 'category', category],
    queryFn: () => listYieldByCategory(category as ComponentYieldMatrix['category']),
    enabled: mode === 'category',
  });

  const modelQuery = useQuery({
    queryKey: ['component-yield', 'model', modelIdSearched],
    queryFn: () => listYieldByModel(modelIdSearched),
    enabled: mode === 'model' && modelIdSearched.length > 0,
  });

  const active = mode === 'category' ? categoryQuery : modelQuery;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      modelId: '',
      originalBomItemCode: '',
      itemName: '',
      category: RECOVERY_CATEGORIES[0],
      defaultRecoveryEvaluation: 0,
      convertedSparePartCode: '',
      isActive: true,
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateComponentYieldInput) => createComponentYield(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['component-yield'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  function openCreate() {
    setMutationError(null);
    reset();
    setModalOpen(true);
  }

  const columns: Column<ComponentYieldMatrix>[] = [
    { key: 'modelId', label: 'Model ID', render: (r) => r.modelId },
    { key: 'originalBomItemCode', label: 'BOM item code', render: (r) => r.originalBomItemCode },
    { key: 'itemName', label: 'Item', render: (r) => <span className="font-medium text-slate-900">{r.itemName}</span> },
    { key: 'category', label: 'Recovery category', render: (r) => r.category.replace(/_/g, ' ') },
    { key: 'recoveryEval', label: 'Recovery value', render: (r) => Number(r.defaultRecoveryEvaluation).toFixed(2) },
    { key: 'convertedCode', label: 'Converted spare code', render: (r) => r.convertedSparePartCode ?? '—' },
    { key: 'status', label: 'Status', render: (r) => <ActiveBadge active={r.isActive} /> },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500">
          Dismantling BOM-to-spare conversion rules. The backend only exposes "list by model"
          or "list by recovery category" — no unfiltered list — so pick a lens below.
        </p>
        <button
          onClick={openCreate}
          className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          + New Yield Rule
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-slate-300">
          <button
            onClick={() => setMode('category')}
            className={`px-3 py-1.5 text-xs font-medium ${mode === 'category' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}
          >
            By category
          </button>
          <button
            onClick={() => setMode('model')}
            className={`px-3 py-1.5 text-xs font-medium ${mode === 'model' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}
          >
            By model
          </button>
        </div>

        {mode === 'category' ? (
          <select className={`${inputClass} w-auto`} value={category} onChange={(e) => setCategory(e.target.value)}>
            {RECOVERY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input
              className={`${inputClass} w-auto`}
              placeholder="Model ID, e.g. WA80J5710"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
            />
            <button
              onClick={() => setModelIdSearched(modelId)}
              disabled={!modelId}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
            >
              Search
            </button>
          </>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={active.data}
        isLoading={active.isLoading}
        error={active.error}
        emptyMessage={mode === 'model' && !modelIdSearched ? 'Enter a model ID and search.' : 'No matching yield rules yet.'}
      />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Component Yield Rule">
        <form
          onSubmit={handleSubmit((values) =>
            createMutation.mutate({ ...values, category: values.category as CreateComponentYieldInput['category'] }),
          )}
          className="space-y-4"
        >
          <ErrorNotice error={mutationError} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Model ID" error={errors.modelId?.message}>
              <input className={inputClass} placeholder="WA80J5710" {...register('modelId', { required: 'Required' })} />
            </Field>
            <Field label="Original BOM item code" error={errors.originalBomItemCode?.message}>
              <input className={inputClass} placeholder="BOM-4471" {...register('originalBomItemCode', { required: 'Required' })} />
            </Field>
          </div>
          <Field label="Item name" error={errors.itemName?.message}>
            <input className={inputClass} placeholder="Drum Motor Assembly" {...register('itemName', { required: 'Required' })} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Recovery category">
              <select className={inputClass} {...register('category', { required: true })}>
                {RECOVERY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Default recovery value">
              <input type="number" step="0.01" className={inputClass} {...register('defaultRecoveryEvaluation', { valueAsNumber: true })} />
            </Field>
          </div>
          <Field label="Converted spare part code" hint="Only relevant when category is Recoverable Spare">
            <input className={inputClass} {...register('convertedSparePartCode')} />
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
