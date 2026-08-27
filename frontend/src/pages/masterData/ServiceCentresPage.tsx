import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ActiveBadge, DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Checkbox, Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { createServiceCentre, deleteServiceCentre, listServiceCentres, updateServiceCentre } from '../../lib/masterDataApi';
import {
  COUNTRIES,
  WEEKDAYS,
  defaultDaySchedule,
  defaultWeekSchedule,
  type CreateServiceCentreInput,
  type DaySchedule,
  type ServiceCentre,
  type Weekday,
} from '../../lib/masterDataTypes';

type FormValues = {
  code: string;
  name: string;
  country: string;
  city: string;
  address: string;
  vatRate: number;
  isActive: boolean;
};

export function ServiceCentresPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceCentre | null>(null);
  const [schedule, setSchedule] = useState<Record<string, DaySchedule>>(defaultWeekSchedule());

  const { data, isLoading, error } = useQuery({ queryKey: ['service-centres'], queryFn: () => listServiceCentres() });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { code: '', name: '', country: 'UAE', city: '', address: '', vatRate: 5, isActive: true },
  });

  const [mutationError, setMutationError] = useState<unknown>(null);

  const createMutation = useMutation({
    mutationFn: (data: CreateServiceCentreInput) => createServiceCentre(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-centres'] });
      closeModal();
    },
    onError: (err) => setMutationError(err),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateServiceCentreInput> }) => updateServiceCentre(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-centres'] });
      closeModal();
    },
    onError: (err) => setMutationError(err),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteServiceCentre(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['service-centres'] }),
  });

  function openCreate() {
    setEditing(null);
    setMutationError(null);
    reset({ code: '', name: '', country: 'UAE', city: '', address: '', vatRate: 5, isActive: true });
    setSchedule(defaultWeekSchedule());
    setModalOpen(true);
  }

  function openEdit(centre: ServiceCentre) {
    setEditing(centre);
    setMutationError(null);
    reset({
      code: centre.code,
      name: centre.name,
      country: centre.country,
      city: centre.city ?? '',
      address: centre.address ?? '',
      vatRate: Number(centre.vatRate),
      isActive: centre.isActive,
    });
    const merged = defaultWeekSchedule();
    for (const day of WEEKDAYS) {
      if (centre.schedule?.[day]) merged[day] = centre.schedule[day];
    }
    setSchedule(merged);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function onSubmit(values: FormValues) {
    const payload: CreateServiceCentreInput = {
      code: values.code,
      name: values.name,
      country: values.country as CreateServiceCentreInput['country'],
      city: values.city || undefined,
      address: values.address || undefined,
      vatRate: Number(values.vatRate),
      isActive: values.isActive,
      schedule,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const columns: Column<ServiceCentre>[] = [
    { key: 'code', label: 'Code', render: (r) => <span className="font-medium text-slate-900">{r.code}</span> },
    { key: 'name', label: 'Name', render: (r) => r.name },
    { key: 'country', label: 'Country', render: (r) => r.country },
    { key: 'city', label: 'City', render: (r) => r.city ?? '—' },
    { key: 'vatRate', label: 'VAT %', render: (r) => Number(r.vatRate).toFixed(2) },
    { key: 'status', label: 'Status', render: (r) => <ActiveBadge active={r.isActive} /> },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Service centre locations, opening hours and per-country VAT. The only Master Data
          entity with full edit/delete support in the backend today.
        </p>
        <button
          onClick={openCreate}
          className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          + New Service Centre
        </button>
      </div>

      <DataTable
        columns={columns}
        rows={data}
        isLoading={isLoading}
        error={error}
        emptyMessage="No service centres yet — create the first one."
        rowActions={(row) => (
          <div className="flex justify-end gap-3">
            <button onClick={() => openEdit(row)} className="text-xs font-medium text-slate-600 hover:text-slate-900">
              Edit
            </button>
            <button
              onClick={() => {
                if (confirm(`Delete service centre "${row.name}"? This is a soft delete.`)) {
                  deleteMutation.mutate(row.id);
                }
              }}
              className="text-xs font-medium text-red-500 hover:text-red-700"
            >
              Delete
            </button>
          </div>
        )}
      />

      <Modal open={modalOpen} onClose={closeModal} title={editing ? `Edit ${editing.code}` : 'New Service Centre'}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <ErrorNotice error={mutationError} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Code" error={errors.code?.message}>
              <input className={inputClass} placeholder="DXB-01" {...register('code', { required: 'Code is required' })} />
            </Field>
            <Field label="Country">
              <select className={inputClass} {...register('country', { required: true })}>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Name" error={errors.name?.message}>
            <input className={inputClass} placeholder="Dubai Service Centre" {...register('name', { required: 'Name is required' })} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="City">
              <input className={inputClass} {...register('city')} />
            </Field>
            <Field label="VAT rate %" hint="5.0 for UAE, 15.0 for KSA per the BRD">
              <input type="number" step="0.01" className={inputClass} {...register('vatRate', { valueAsNumber: true })} />
            </Field>
          </div>
          <Field label="Address">
            <textarea className={inputClass} rows={2} {...register('address')} />
          </Field>
          <Checkbox label="Active" {...register('isActive')} />

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Weekly schedule</p>
            <div className="space-y-2 rounded-md border border-slate-200 p-3">
              {WEEKDAYS.map((day) => (
                <ScheduleRow
                  key={day}
                  day={day}
                  value={schedule[day] ?? defaultDaySchedule(false)}
                  onChange={(next) => setSchedule((prev) => ({ ...prev, [day]: next }))}
                />
              ))}
            </div>
          </div>

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

function ScheduleRow({
  day,
  value,
  onChange,
}: {
  day: Weekday;
  value: DaySchedule;
  onChange: (next: DaySchedule) => void;
}) {
  return (
    <div className="grid grid-cols-12 items-center gap-2 text-xs">
      <label className="col-span-3 flex items-center gap-1.5 font-medium capitalize text-slate-700">
        <input
          type="checkbox"
          checked={value.isOpen}
          onChange={(e) => onChange({ ...value, isOpen: e.target.checked })}
          className="h-3.5 w-3.5 rounded border-slate-300"
        />
        {day}
      </label>
      <input
        type="time"
        value={value.startTime}
        disabled={!value.isOpen}
        onChange={(e) => onChange({ ...value, startTime: e.target.value })}
        className="col-span-2 rounded border border-slate-300 px-1.5 py-1 disabled:bg-slate-100"
      />
      <input
        type="time"
        value={value.endTime}
        disabled={!value.isOpen}
        onChange={(e) => onChange({ ...value, endTime: e.target.value })}
        className="col-span-2 rounded border border-slate-300 px-1.5 py-1 disabled:bg-slate-100"
      />
      <input
        type="time"
        value={value.breakStart}
        disabled={!value.isOpen}
        onChange={(e) => onChange({ ...value, breakStart: e.target.value })}
        className="col-span-2 rounded border border-slate-300 px-1.5 py-1 disabled:bg-slate-100"
        title="Break start"
      />
      <input
        type="time"
        value={value.breakEnd}
        disabled={!value.isOpen}
        onChange={(e) => onChange({ ...value, breakEnd: e.target.value })}
        className="col-span-2 rounded border border-slate-300 px-1.5 py-1 disabled:bg-slate-100"
        title="Break end"
      />
      <input
        type="number"
        min={0}
        value={value.maxJobsPerDay}
        disabled={!value.isOpen}
        onChange={(e) => onChange({ ...value, maxJobsPerDay: Number(e.target.value) })}
        className="col-span-1 rounded border border-slate-300 px-1.5 py-1 disabled:bg-slate-100"
        title="Max jobs/day"
      />
    </div>
  );
}
