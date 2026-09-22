import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DataTable, type Column } from '../../components/DataTable';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { listAppointmentFieldConfigs, updateAppointmentFieldConfig } from '../../lib/masterDataApi';
import type { AppointmentFieldConfig } from '../../lib/masterDataTypes';

// Master-Data/New-Appointment billing modification (requested 2026-09-21) Phase 2, req. 1 -
// lets a Super Admin (or anyone holding MASTER_DATA_APPOINTMENT_FIELD_CONFIG_MANAGE) tick
// which optional New Appointment fields are currently mandatory. No create/delete here -
// the row set is fixed (seeded by scripts/seed-appointment-field-config.ts), only
// isMandatory toggles. `type`/`customerType` never appear in this list - they stay
// permanently hard-required in code (CreateAppointmentDto's own @IsEnum decorators),
// per the locked Phase 1 decision; this screen only ever controls the "extra" fields.
export function AppointmentFieldConfigPage() {
  const queryClient = useQueryClient();
  const { has } = useMyCapabilities();
  const canManage = has('MASTER_DATA_APPOINTMENT_FIELD_CONFIG_MANAGE');

  const { data, isLoading, error } = useQuery({
    queryKey: ['appointment-field-configs'],
    queryFn: () => listAppointmentFieldConfigs(),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isMandatory }: { id: string; isMandatory: boolean }) => updateAppointmentFieldConfig(id, isMandatory),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appointment-field-configs'] }),
  });

  const columns: Column<AppointmentFieldConfig>[] = [
    {
      key: 'fieldLabel',
      label: 'Field',
      render: (r) => (
        <div>
          <span className="font-medium text-slate-900">{r.fieldLabel}</span>
          <span className="ml-2 text-xs text-slate-400">{r.fieldKey}</span>
        </div>
      ),
    },
    {
      key: 'isMandatory',
      label: 'Mandatory on New Appointment',
      render: (r) => (
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            role="switch"
            aria-label={`Mandatory: ${r.fieldLabel}`}
            checked={r.isMandatory}
            disabled={!canManage || toggleMutation.isPending}
            onChange={(e) => toggleMutation.mutate({ id: r.id, isMandatory: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 disabled:opacity-50"
          />
          <span className={r.isMandatory ? 'text-xs font-medium text-emerald-700' : 'text-xs text-slate-400'}>
            {r.isMandatory ? 'Mandatory' : 'Optional'}
          </span>
        </label>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-4">
        <p className="text-sm text-slate-500">
          Which optional New Appointment fields the CCE must fill in before saving. <span className="font-medium">Type</span> and{' '}
          <span className="font-medium">Customer Type</span> aren't listed here — they're always required and can't be turned off.
        </p>
        {!canManage && (
          <p className="mt-1 text-xs text-slate-400">You have view-only access — ask a Super Admin to change these.</p>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={data}
        isLoading={isLoading}
        error={error}
        emptyMessage="No field config rows found — run the seed script."
      />
    </div>
  );
}
