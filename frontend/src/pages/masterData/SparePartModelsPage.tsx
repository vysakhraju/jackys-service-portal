import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { createSparePartModel, listSparePartModels } from '../../lib/masterDataApi';
import type { CreateSparePartModelInput, SparePartModel } from '../../lib/masterDataTypes';

type FormValues = { modelId: string; brand: string; modelName: string };

export function SparePartModelsPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [mutationError, setMutationError] = useState<unknown>(null);

  const { data, isLoading, error } = useQuery({ queryKey: ['spare-part-models'], queryFn: listSparePartModels });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { modelId: '', brand: '', modelName: '' } });

  const createMutation = useMutation({
    mutationFn: (data: CreateSparePartModelInput) => createSparePartModel(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spare-part-models'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  function openCreate() {
    setMutationError(null);
    reset();
    setModalOpen(true);
  }

  const columns: Column<SparePartModel>[] = [
    { key: 'modelId', label: 'Model ID', render: (r) => <span className="font-medium text-slate-900">{r.modelId}</span> },
    { key: 'brand', label: 'Brand', render: (r) => r.brand },
    { key: 'modelName', label: 'Model name', render: (r) => r.modelName },
    { key: 'linkedParts', label: 'Linked spare parts', render: (r) => r.spareParts?.length ?? 0 },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500">
          Appliance models. These are what spare parts, price lists and component yield rows
          get linked to by model ID.
        </p>
        <button
          onClick={openCreate}
          className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          + New Model
        </button>
      </div>

      <DataTable columns={columns} rows={data} isLoading={isLoading} error={error} emptyMessage="No appliance models yet." />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Spare Part Model">
        <form onSubmit={handleSubmit((values) => createMutation.mutate(values))} className="space-y-4">
          <ErrorNotice error={mutationError} />
          <Field label="Model ID" error={errors.modelId?.message} hint="Used elsewhere as the modelId foreign key">
            <input className={inputClass} placeholder="WA80J5710" {...register('modelId', { required: 'Required' })} />
          </Field>
          <Field label="Brand" error={errors.brand?.message}>
            <input className={inputClass} placeholder="Samsung" {...register('brand', { required: 'Required' })} />
          </Field>
          <Field label="Model name" error={errors.modelName?.message}>
            <input className={inputClass} placeholder="Front Load Washer 8kg" {...register('modelName', { required: 'Required' })} />
          </Field>

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
