import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ActiveBadge, DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Checkbox, Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useAuth } from '../../lib/auth';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { createBillingChannel, deleteBillingChannel, listBillingChannels, updateBillingChannel } from '../../lib/masterDataApi';
import type { BillingChannel, CreateBillingChannelInput } from '../../lib/masterDataTypes';

type FormValues = {
  name: string;
  isActive: boolean;
};

// Master-Data/New-Appointment billing modification (requested 2026-09-21) Phase 2, req. 4 -
// Billing Channel admin page. Same CRUD shape as CitiesPage.tsx (its own exact template).
// Backs the New Appointment popup's Billing Channel dropdown (req. 4) and Phase 4's future
// Debit Note/Invoice routing - deliberately NOT the same thing as the existing intake
// Channel field (AppointmentChannel), see the entity's own doc comment for why they're
// named differently.
export function BillingChannelsPage() {
  const queryClient = useQueryClient();
  const { has } = useMyCapabilities();
  const { user } = useAuth();
  const canManage = has('MASTER_DATA_BILLING_CHANNEL_MANAGE');
  const canDelete = user?.role.name === 'SUPER_ADMIN';

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BillingChannel | null>(null);
  const [mutationError, setMutationError] = useState<unknown>(null);

  const { data, isLoading, error } = useQuery({ queryKey: ['billing-channels'], queryFn: () => listBillingChannels() });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { name: '', isActive: true } });

  const createMutation = useMutation({
    mutationFn: (data: CreateBillingChannelInput) => createBillingChannel(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-channels'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateBillingChannelInput> }) => updateBillingChannel(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-channels'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBillingChannel(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['billing-channels'] }),
  });

  function openCreate() {
    setEditing(null);
    setMutationError(null);
    reset({ name: '', isActive: true });
    setModalOpen(true);
  }

  function openEdit(row: BillingChannel) {
    setEditing(row);
    setMutationError(null);
    reset({ name: row.name, isActive: row.isActive });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function onSubmit(values: FormValues) {
    const payload: CreateBillingChannelInput = {
      name: values.name,
      isActive: values.isActive,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const columns: Column<BillingChannel>[] = [
    { key: 'name', label: 'Name', render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
    { key: 'status', label: 'Status', render: (r) => <ActiveBadge active={r.isActive} /> },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Billing channels for interdepartment routing — used by the New Appointment popup and Finance billing, separate from
          the intake Channel field. Rates are set per Category/Job Type in Price List, not here — add a Billing Channel row in
          Price List for each channel that needs to bill a category at its own rate.
        </p>
        {canManage && (
          <button
            onClick={openCreate}
            className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            + New Billing Channel
          </button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={data}
        isLoading={isLoading}
        error={error}
        emptyMessage="No billing channels yet — create the first one."
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
                        if (confirm(`Delete billing channel "${row.name}"? This is a soft delete.`)) {
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

      <Modal open={modalOpen} onClose={closeModal} title={editing ? `Edit ${editing.name}` : 'New Billing Channel'}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <ErrorNotice error={mutationError} />
          <Field label="Name" error={errors.name?.message}>
            <input className={inputClass} placeholder="Corporate Interdepartment" {...register('name', { required: 'Name is required' })} />
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
