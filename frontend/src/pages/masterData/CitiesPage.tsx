import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ActiveBadge, DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Checkbox, Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useAuth } from '../../lib/auth';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { createCity, deleteCity, listCities, updateCity } from '../../lib/masterDataApi';
import type { City, CreateCityInput } from '../../lib/masterDataTypes';

type FormValues = {
  name: string;
  isActive: boolean;
};

// #302 - Cities admin page. Backend (POST/GET/PUT/DELETE /master-data/cities) has existed
// since the #301 Phase 1 backend work; this is the first frontend screen for it. Feeds
// every screen that has a City dropdown today (Service Centre city field is still free
// text, not wired to this master - out of scope here, flagged in TODO_BACKLOG.md).
export function CitiesPage() {
  const queryClient = useQueryClient();
  const { has } = useMyCapabilities();
  const { user } = useAuth();
  const canManage = has('MASTER_DATA_CITY_MANAGE');
  const canDelete = user?.role.name === 'SUPER_ADMIN';

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<City | null>(null);
  const [mutationError, setMutationError] = useState<unknown>(null);

  const { data, isLoading, error } = useQuery({ queryKey: ['cities'], queryFn: () => listCities() });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { name: '', isActive: true } });

  const createMutation = useMutation({
    mutationFn: (data: CreateCityInput) => createCity(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cities'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateCityInput> }) => updateCity(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cities'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCity(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cities'] }),
  });

  function openCreate() {
    setEditing(null);
    setMutationError(null);
    reset({ name: '', isActive: true });
    setModalOpen(true);
  }

  function openEdit(row: City) {
    setEditing(row);
    setMutationError(null);
    reset({ name: row.name, isActive: row.isActive });
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

  const columns: Column<City>[] = [
    { key: 'name', label: 'Name', render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
    { key: 'status', label: 'Status', render: (r) => <ActiveBadge active={r.isActive} /> },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500">Cities used across appointment/customer address fields.</p>
        {canManage && (
          <button
            onClick={openCreate}
            className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            + New City
          </button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={data}
        isLoading={isLoading}
        error={error}
        emptyMessage="No cities yet — create the first one."
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
                        if (confirm(`Delete city "${row.name}"? This is a soft delete.`)) {
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

      <Modal open={modalOpen} onClose={closeModal} title={editing ? `Edit ${editing.name}` : 'New City'}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <ErrorNotice error={mutationError} />
          <Field label="Name" error={errors.name?.message}>
            <input className={inputClass} placeholder="Dubai" {...register('name', { required: 'Name is required' })} />
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
