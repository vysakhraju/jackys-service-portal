import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ActiveBadge, DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Checkbox, Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useAuth } from '../../lib/auth';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { createApplianceModel, deleteApplianceModel, listApplianceModels, updateApplianceModel } from '../../lib/masterDataApi';
import { APPLIANCE_CATEGORIES, type ApplianceModel, type CreateApplianceModelInput } from '../../lib/masterDataTypes';

type FormValues = {
  brand: string;
  model: string;
  description: string;
  category: string;
  isActive: boolean;
};

const NO_CATEGORY = '';

// #304 - Appliance Models admin page. Backend (POST/GET/PUT/DELETE
// /master-data/appliance-models) has existed since Phase 1; the #301 work (2026-09-21)
// added the nullable `category` column this page now exposes. Category is left
// unset-able on purpose - existing models predate the field and the Fault & Symptom
// pickers already fall back to "show every category" for a model with none set, so
// leaving it blank here is a valid, supported state, not a validation gap.
export function ApplianceModelsPage() {
  const queryClient = useQueryClient();
  const { has } = useMyCapabilities();
  const { user } = useAuth();
  const canManage = has('MASTER_DATA_APPLIANCE_MODEL_MANAGE');
  const canDelete = user?.role.name === 'SUPER_ADMIN';

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ApplianceModel | null>(null);
  const [brandFilter, setBrandFilter] = useState('');
  const [mutationError, setMutationError] = useState<unknown>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['appliance-models', brandFilter],
    queryFn: () => listApplianceModels(brandFilter || undefined),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { brand: '', model: '', description: '', category: NO_CATEGORY, isActive: true },
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateApplianceModelInput) => createApplianceModel(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appliance-models'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateApplianceModelInput> }) => updateApplianceModel(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appliance-models'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteApplianceModel(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appliance-models'] }),
  });

  function openCreate() {
    setEditing(null);
    setMutationError(null);
    reset({ brand: '', model: '', description: '', category: NO_CATEGORY, isActive: true });
    setModalOpen(true);
  }

  function openEdit(row: ApplianceModel) {
    setEditing(row);
    setMutationError(null);
    reset({
      brand: row.brand,
      model: row.model,
      description: row.description ?? '',
      category: row.category ?? NO_CATEGORY,
      isActive: row.isActive,
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function onSubmit(values: FormValues) {
    const payload: CreateApplianceModelInput = {
      brand: values.brand,
      model: values.model,
      description: values.description || undefined,
      category: values.category ? (values.category as CreateApplianceModelInput['category']) : undefined,
      isActive: values.isActive,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const columns: Column<ApplianceModel>[] = [
    { key: 'brand', label: 'Brand', render: (r) => <span className="font-medium text-slate-900">{r.brand}</span> },
    { key: 'model', label: 'Model', render: (r) => r.model },
    {
      key: 'category',
      label: 'Category',
      render: (r) => (r.category ? r.category.replace(/_/g, ' ') : <span className="text-amber-600">Not set</span>),
    },
    { key: 'description', label: 'Description', render: (r) => r.description ?? '—' },
    { key: 'status', label: 'Status', render: (r) => <ActiveBadge active={r.isActive} /> },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500">
          Brand/model combinations used across appointments and job cards. Category links a model to the
          Fault &amp; Symptoms picker — leave unset if unknown, the picker falls back to showing every category.
        </p>
        {canManage && (
          <button
            onClick={openCreate}
            className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            + New Appliance Model
          </button>
        )}
      </div>

      <div className="mb-3 flex items-center gap-2">
        <label className="text-xs font-medium text-slate-500">Filter by brand</label>
        <input
          className={`${inputClass} w-48`}
          placeholder="e.g. LG"
          value={brandFilter}
          onChange={(e) => setBrandFilter(e.target.value)}
        />
      </div>

      <DataTable
        columns={columns}
        rows={data}
        isLoading={isLoading}
        error={error}
        emptyMessage="No appliance models yet — create the first one."
        rowActions={
          canManage || canDelete
            ? (row) => (
                <div className="flex justify-end gap-3">
                  {canManage && (
                    <button onClick={() => openEdit(row)} className="text-xs font-medium text-slate-600 hover:text-slate-900">
                      Edit
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => {
                        if (confirm(`Delete appliance model "${row.brand} ${row.model}"? This is a soft delete.`)) {
                          deleteMutation.mutate(row.id);
                        }
                      }}
                      className="text-xs font-medium text-red-500 hover:text-red-700"
                    >
                      Delete
                    </button>
                  )}
                </div>
              )
            : undefined
        }
      />

      <Modal open={modalOpen} onClose={closeModal} title={editing ? `Edit ${editing.brand} ${editing.model}` : 'New Appliance Model'}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <ErrorNotice error={mutationError} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Brand" error={errors.brand?.message}>
              <input className={inputClass} placeholder="LG" {...register('brand', { required: 'Brand is required' })} />
            </Field>
            <Field label="Model" error={errors.model?.message}>
              <input className={inputClass} placeholder="WM-2401" {...register('model', { required: 'Model is required' })} />
            </Field>
          </div>
          <Field label="Category" hint="Leave unset if unknown — the fault/symptom picker falls back to showing every category.">
            <select className={inputClass} {...register('category')}>
              <option value={NO_CATEGORY}>Not set</option>
              {APPLIANCE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Description">
            <textarea className={inputClass} rows={2} {...register('description')} />
          </Field>
          <Checkbox label="Active" {...register('isActive')} />

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeModal} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {editing ? 'Save changes' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
