import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ActiveBadge, DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Checkbox, Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { createFaultSymptom, listFaultSymptoms } from '../../lib/masterDataApi';
import { APPLIANCE_CATEGORIES, type CreateFaultSymptomInput, type FaultSymptom } from '../../lib/masterDataTypes';

type FormValues = {
  faultCode: string;
  faultDescription: string;
  symptomCode: string;
  symptomDescription: string;
  category: string;
  requiresWorkshop: boolean;
  isActive: boolean;
};

export function FaultSymptomsPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [mutationError, setMutationError] = useState<unknown>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['fault-symptoms', categoryFilter],
    queryFn: () => listFaultSymptoms(categoryFilter || undefined),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      faultCode: '',
      faultDescription: '',
      symptomCode: '',
      symptomDescription: '',
      category: APPLIANCE_CATEGORIES[0],
      requiresWorkshop: false,
      isActive: true,
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateFaultSymptomInput) => createFaultSymptom(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fault-symptoms'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  function openCreate() {
    setMutationError(null);
    reset();
    setModalOpen(true);
  }

  function onSubmit(values: FormValues) {
    createMutation.mutate({ ...values, category: values.category as CreateFaultSymptomInput['category'] });
  }

  const columns: Column<FaultSymptom>[] = [
    { key: 'faultCode', label: 'Fault code', render: (r) => <span className="font-medium text-slate-900">{r.faultCode}</span> },
    { key: 'faultDescription', label: 'Fault', render: (r) => r.faultDescription },
    { key: 'symptomCode', label: 'Symptom code', render: (r) => r.symptomCode },
    { key: 'symptomDescription', label: 'Symptom', render: (r) => r.symptomDescription },
    { key: 'category', label: 'Category', render: (r) => r.category.replace(/_/g, ' ') },
    { key: 'requiresWorkshop', label: 'Workshop?', render: (r) => (r.requiresWorkshop ? 'Yes' : 'No') },
    { key: 'status', label: 'Status', render: (r) => <ActiveBadge active={r.isActive} /> },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500">
          Fault and symptom codes used across job cards. Create-only in the backend — there's
          no edit or delete endpoint yet, so double-check before saving.
        </p>
        <button
          onClick={openCreate}
          className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          + New Fault/Symptom
        </button>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <label className="text-xs font-medium text-slate-500">Filter by category</label>
        <select className={`${inputClass} w-auto`} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All categories</option>
          {APPLIANCE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      <DataTable columns={columns} rows={data} isLoading={isLoading} error={error} emptyMessage="No fault/symptom codes yet." />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Fault / Symptom">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <ErrorNotice error={mutationError} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Fault code" error={errors.faultCode?.message}>
              <input className={inputClass} placeholder="F001" {...register('faultCode', { required: 'Required' })} />
            </Field>
            <Field label="Symptom code" error={errors.symptomCode?.message}>
              <input className={inputClass} placeholder="S001" {...register('symptomCode', { required: 'Required' })} />
            </Field>
          </div>
          <Field label="Fault description" error={errors.faultDescription?.message}>
            <input className={inputClass} placeholder="Not draining" {...register('faultDescription', { required: 'Required' })} />
          </Field>
          <Field label="Symptom description" error={errors.symptomDescription?.message}>
            <input
              className={inputClass}
              placeholder="Water remains in drum"
              {...register('symptomDescription', { required: 'Required' })}
            />
          </Field>
          <Field label="Appliance category">
            <select className={inputClass} {...register('category', { required: true })}>
              {APPLIANCE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Checkbox label="Requires workshop" {...register('requiresWorkshop')} />
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
