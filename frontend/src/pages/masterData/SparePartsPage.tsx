import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ActiveBadge, DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Checkbox, Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { createSparePart, linkSparePartToModel, listSpareParts, listSparePartModels } from '../../lib/masterDataApi';
import type { CreateSparePartInput, SparePart } from '../../lib/masterDataTypes';

type FormValues = {
  code: string;
  name: string;
  category: string;
  brand: string;
  description: string;
  unitCost: number;
  unitPriceB2B: number;
  unitPriceB2C: number;
  minStockLevel: number;
  vanStockLevel: number;
  isActive: boolean;
};

export function SparePartsPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState<SparePart | null>(null);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [mutationError, setMutationError] = useState<unknown>(null);
  const [linkError, setLinkError] = useState<unknown>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['spare-parts', categoryFilter, brandFilter],
    queryFn: () => listSpareParts({ category: categoryFilter || undefined, brand: brandFilter || undefined }),
  });

  const { data: models } = useQuery({ queryKey: ['spare-part-models'], queryFn: listSparePartModels });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      code: '',
      name: '',
      category: '',
      brand: '',
      description: '',
      unitCost: 0,
      unitPriceB2B: 0,
      unitPriceB2C: 0,
      minStockLevel: 0,
      vanStockLevel: 0,
      isActive: true,
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateSparePartInput) => createSparePart(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spare-parts'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  const linkMutation = useMutation({
    mutationFn: ({ id, modelId }: { id: string; modelId: string }) => linkSparePartToModel(id, modelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spare-parts'] });
      setLinkTarget(null);
    },
    onError: (err) => setLinkError(err),
  });

  function openCreate() {
    setMutationError(null);
    reset();
    setModalOpen(true);
  }

  function onSubmit(values: FormValues) {
    createMutation.mutate(values);
  }

  const columns: Column<SparePart>[] = [
    { key: 'code', label: 'Code', render: (r) => <span className="font-medium text-slate-900">{r.code}</span> },
    { key: 'name', label: 'Name', render: (r) => r.name },
    { key: 'category', label: 'Category', render: (r) => r.category },
    { key: 'brand', label: 'Brand', render: (r) => r.brand ?? '—' },
    { key: 'unitCost', label: 'Unit cost', render: (r) => Number(r.unitCost).toFixed(2) },
    { key: 'b2b', label: 'B2B price', render: (r) => Number(r.unitPriceB2B).toFixed(2) },
    { key: 'b2c', label: 'B2C price', render: (r) => Number(r.unitPriceB2C).toFixed(2) },
    { key: 'minStock', label: 'Min stock', render: (r) => r.minStockLevel },
    { key: 'status', label: 'Status', render: (r) => <ActiveBadge active={r.isActive} /> },
    {
      key: 'models',
      label: 'Linked models',
      render: (r) => (r.models && r.models.length > 0 ? r.models.map((m) => m.modelId).join(', ') : '—'),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500">
          Spare parts catalog with B2B/B2C pricing and stock thresholds. Link a part to an
          appliance model before GRN will accept stock for it (AC-17).
        </p>
        <button
          onClick={openCreate}
          className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          + New Spare Part
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className={`${inputClass} w-auto`}
          placeholder="Filter by category"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        />
        <input
          className={`${inputClass} w-auto`}
          placeholder="Filter by brand"
          value={brandFilter}
          onChange={(e) => setBrandFilter(e.target.value)}
        />
      </div>

      <DataTable
        columns={columns}
        rows={data}
        isLoading={isLoading}
        error={error}
        emptyMessage="No spare parts yet."
        rowActions={(row) => (
          <button
            onClick={() => {
              setLinkError(null);
              setSelectedModelId('');
              setLinkTarget(row);
            }}
            className="text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            Link to model
          </button>
        )}
      />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Spare Part">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <ErrorNotice error={mutationError} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Code" error={errors.code?.message}>
              <input className={inputClass} placeholder="SP-1001" {...register('code', { required: 'Required' })} />
            </Field>
            <Field label="Category" error={errors.category?.message}>
              <input className={inputClass} placeholder="MOTOR" {...register('category', { required: 'Required' })} />
            </Field>
          </div>
          <Field label="Name" error={errors.name?.message}>
            <input className={inputClass} placeholder="Drain Pump" {...register('name', { required: 'Required' })} />
          </Field>
          <Field label="Brand">
            <input className={inputClass} {...register('brand')} />
          </Field>
          <Field label="Description">
            <textarea className={inputClass} rows={2} {...register('description')} />
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Unit cost">
              <input type="number" step="0.01" className={inputClass} {...register('unitCost', { valueAsNumber: true })} />
            </Field>
            <Field label="B2B price">
              <input type="number" step="0.01" className={inputClass} {...register('unitPriceB2B', { valueAsNumber: true })} />
            </Field>
            <Field label="B2C price">
              <input type="number" step="0.01" className={inputClass} {...register('unitPriceB2C', { valueAsNumber: true })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Min stock level">
              <input type="number" className={inputClass} {...register('minStockLevel', { valueAsNumber: true })} />
            </Field>
            <Field label="Van stock level">
              <input type="number" className={inputClass} {...register('vanStockLevel', { valueAsNumber: true })} />
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

      <Modal open={!!linkTarget} onClose={() => setLinkTarget(null)} title={`Link "${linkTarget?.code}" to a model`}>
        <div className="space-y-4">
          <ErrorNotice error={linkError} />
          <Field label="Appliance model" hint="Create one under Spare Part Models first if the list is empty.">
            <select className={inputClass} value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)}>
              <option value="">Select a model…</option>
              {(models ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.brand} — {m.modelName} ({m.modelId})
                </option>
              ))}
            </select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setLinkTarget(null)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
              Cancel
            </button>
            <button
              type="button"
              disabled={!selectedModelId || linkMutation.isPending}
              onClick={() => linkTarget && linkMutation.mutate({ id: linkTarget.id, modelId: selectedModelId })}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Link
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
