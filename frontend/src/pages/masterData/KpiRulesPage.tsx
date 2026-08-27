import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ActiveBadge, DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Checkbox, Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { createKpiRule, listKpiRules } from '../../lib/masterDataApi';
import type { CreateKpiRuleInput, TechnicianKpiRule } from '../../lib/masterDataTypes';

type FormValues = {
  kpiName: string;
  weightage: number;
  target: number;
  incentivePoints: number;
  description: string;
  isActive: boolean;
};

export function KpiRulesPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [mutationError, setMutationError] = useState<unknown>(null);

  const { data, isLoading, error } = useQuery({ queryKey: ['kpi-rules'], queryFn: listKpiRules });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { kpiName: '', weightage: 0, target: 0, incentivePoints: 0, description: '', isActive: true },
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateKpiRuleInput) => createKpiRule(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kpi-rules'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  function openCreate() {
    setMutationError(null);
    reset();
    setModalOpen(true);
  }

  const columns: Column<TechnicianKpiRule>[] = [
    { key: 'kpiName', label: 'KPI', render: (r) => <span className="font-medium text-slate-900">{r.kpiName}</span> },
    { key: 'weightage', label: 'Weight %', render: (r) => Number(r.weightage).toFixed(2) },
    { key: 'target', label: 'Target', render: (r) => Number(r.target).toFixed(2) },
    { key: 'incentivePoints', label: 'Incentive points', render: (r) => r.incentivePoints },
    { key: 'description', label: 'Description', render: (r) => r.description ?? '—' },
    { key: 'status', label: 'Status', render: (r) => <ActiveBadge active={r.isActive} /> },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500">
          Technician KPI definitions used for scoring and incentives. Weightages across all
          active KPIs are expected to add up to 100%.
        </p>
        <button
          onClick={openCreate}
          className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          + New KPI Rule
        </button>
      </div>

      <DataTable columns={columns} rows={data} isLoading={isLoading} error={error} emptyMessage="No KPI rules yet." />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Technician KPI Rule">
        <form onSubmit={handleSubmit((values) => createMutation.mutate(values))} className="space-y-4">
          <ErrorNotice error={mutationError} />
          <Field label="KPI name" error={errors.kpiName?.message}>
            <input className={inputClass} placeholder="First Time Fix Rate" {...register('kpiName', { required: 'Required' })} />
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Weightage %" hint="Share of overall score">
              <input type="number" step="0.01" className={inputClass} {...register('weightage', { valueAsNumber: true })} />
            </Field>
            <Field label="Target">
              <input type="number" step="0.01" className={inputClass} {...register('target', { valueAsNumber: true })} />
            </Field>
            <Field label="Incentive points">
              <input type="number" className={inputClass} {...register('incentivePoints', { valueAsNumber: true })} />
            </Field>
          </div>
          <Field label="Description">
            <textarea className={inputClass} rows={2} {...register('description')} />
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
