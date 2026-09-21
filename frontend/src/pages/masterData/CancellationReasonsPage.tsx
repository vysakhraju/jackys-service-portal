import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ActiveBadge, DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Checkbox, Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useAuth } from '../../lib/auth';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { createCancellationReason, deleteCancellationReason, listCancellationReasons, updateCancellationReason } from '../../lib/masterDataApi';
import type { CancellationReason, CreateCancellationReasonInput } from '../../lib/masterDataTypes';

type FormValues = {
  label: string;
  isActive: boolean;
};

// #303 - Cancellation Reasons admin page. Backend (POST/GET/PUT/DELETE
// /master-data/cancellation-reasons) has existed since the #301 Phase 1 backend work;
// this is the first frontend screen for it. Feeds the mobile Cancel screen's reason
// dropdown (npm run seed:cancellation-reasons still needs confirming on your DB per
// TODO_BACKLOG.md section 3 - this page is how you'd manage rows beyond that seed).
export function CancellationReasonsPage() {
  const queryClient = useQueryClient();
  const { has } = useMyCapabilities();
  const { user } = useAuth();
  const canManage = has('MASTER_DATA_CANCELLATION_REASON_MANAGE');
  const canDelete = user?.role.name === 'SUPER_ADMIN';

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CancellationReason | null>(null);
  const [mutationError, setMutationError] = useState<unknown>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['cancellation-reasons'],
    queryFn: () => listCancellationReasons(),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { label: '', isActive: true } });

  const createMutation = useMutation({
    mutationFn: (data: CreateCancellationReasonInput) => createCancellationReason(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cancellation-reasons'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateCancellationReasonInput> }) =>
      updateCancellationReason(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cancellation-reasons'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCancellationReason(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cancellation-reasons'] }),
  });

  function openCreate() {
    setEditing(null);
    setMutationError(null);
    reset({ label: '', isActive: true });
    setModalOpen(true);
  }

  function openEdit(row: CancellationReason) {
    setEditing(row);
    setMutationError(null);
    reset({ label: row.label, isActive: row.isActive });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function onSubmit(values: FormValues) {
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: values });
    } else {
      createMutation.mutate(values);
    }
  }

  const columns: Column<CancellationReason>[] = [
    { key: 'label', label: 'Reason', render: (r) => <span className="font-medium text-slate-900">{r.label}</span> },
    { key: 'status', label: 'Status', render: (r) => <ActiveBadge active={r.isActive} /> },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500">Reasons shown on the mobile app's appointment Cancel screen.</p>
        {canManage && (
          <button
            onClick={openCreate}
            className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            + New Reason
          </button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={data}
        isLoading={isLoading}
        error={error}
        emptyMessage="No cancellation reasons yet — create the first one."
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
                        if (confirm(`Delete cancellation reason "${row.label}"? This is a soft delete.`)) {
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

      <Modal open={modalOpen} onClose={closeModal} title={editing ? `Edit reason` : 'New Cancellation Reason'}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <ErrorNotice error={mutationError} />
          <Field label="Label" error={errors.label?.message}>
            <input
              className={inputClass}
              placeholder="Customer no longer needs the service"
              {...register('label', { required: 'Label is required' })}
            />
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
