import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ActiveBadge, DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Checkbox, Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { createNotificationTemplate, listNotificationTemplates } from '../../lib/masterDataApi';
import { NOTIFICATION_CHANNELS, NOTIFICATION_TRIGGERS, type NotificationTemplate } from '../../lib/masterDataTypes';

type FormValues = {
  trigger: string;
  channel: string;
  subject: string;
  body: string;
  placeholders: string;
  isActive: boolean;
};

export function NotificationTemplatesPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [mutationError, setMutationError] = useState<unknown>(null);

  const { data, isLoading, error } = useQuery({ queryKey: ['notification-templates'], queryFn: listNotificationTemplates });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      trigger: NOTIFICATION_TRIGGERS[0],
      channel: NOTIFICATION_CHANNELS[0],
      subject: '',
      body: '',
      placeholders: '',
      isActive: true,
    },
  });

  const createMutation = useMutation({
    mutationFn: (values: FormValues) =>
      createNotificationTemplate({
        trigger: values.trigger as NotificationTemplate['trigger'],
        channel: values.channel as NotificationTemplate['channel'],
        subject: values.subject,
        body: values.body,
        placeholders: values.placeholders
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean),
        isActive: values.isActive,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-templates'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  function openCreate() {
    setMutationError(null);
    reset();
    setModalOpen(true);
  }

  const columns: Column<NotificationTemplate>[] = [
    { key: 'trigger', label: 'Trigger', render: (r) => <span className="font-medium text-slate-900">{r.trigger.replace(/_/g, ' ')}</span> },
    { key: 'channel', label: 'Channel', render: (r) => r.channel },
    { key: 'subject', label: 'Subject', render: (r) => r.subject },
    {
      key: 'placeholders',
      label: 'Placeholders',
      render: (r) => (r.placeholders.length > 0 ? r.placeholders.map((p) => `{{${p}}}`).join(', ') : '—'),
    },
    { key: 'status', label: 'Status', render: (r) => <ActiveBadge active={r.isActive} /> },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500">
          One template per trigger + channel combination (that pair must be unique in the
          backend). Placeholders like <code className="rounded bg-slate-100 px-1">{'{{customerName}}'}</code> get filled
          in when a notification actually sends.
        </p>
        <button
          onClick={openCreate}
          className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          + New Template
        </button>
      </div>

      <DataTable columns={columns} rows={data} isLoading={isLoading} error={error} emptyMessage="No notification templates yet." />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Notification Template">
        <form onSubmit={handleSubmit((values) => createMutation.mutate(values))} className="space-y-4">
          <ErrorNotice error={mutationError} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Trigger">
              <select className={inputClass} {...register('trigger', { required: true })}>
                {NOTIFICATION_TRIGGERS.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Channel">
              <select className={inputClass} {...register('channel', { required: true })}>
                {NOTIFICATION_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Subject" error={errors.subject?.message}>
            <input className={inputClass} placeholder="Your technician is on the way" {...register('subject', { required: 'Required' })} />
          </Field>
          <Field label="Body" error={errors.body?.message} hint="Use {{placeholderName}} for dynamic values">
            <textarea
              className={inputClass}
              rows={3}
              placeholder="Hi {{customerName}}, your technician {{technicianName}} is en route."
              {...register('body', { required: 'Required' })}
            />
          </Field>
          <Field label="Placeholders" hint="Comma-separated, e.g. customerName, technicianName">
            <input className={inputClass} {...register('placeholders')} />
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
