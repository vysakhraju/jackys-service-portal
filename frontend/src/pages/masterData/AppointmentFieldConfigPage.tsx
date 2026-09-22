import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DataTable, type Column } from '../../components/DataTable';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { listAppointmentFieldConfigs, updateAppointmentFieldConfig, updateAppointmentFieldConfigVisibility } from '../../lib/masterDataApi';
import { ACTIVE_JOB_TYPES } from '../../lib/masterDataTypes';
import type { AppointmentFieldConfig } from '../../lib/masterDataTypes';

// Master-Data/New-Appointment billing modification (requested 2026-09-21) Phase 2, req. 1 -
// lets a Super Admin (or anyone holding MASTER_DATA_APPOINTMENT_FIELD_CONFIG_MANAGE) tick
// which optional New Appointment fields are currently mandatory. No create/delete here -
// the row set is fixed (seeded by scripts/seed-appointment-field-config.ts), only
// isMandatory/isVisible toggle. `type`/`customerType` never appear in this list - they stay
// permanently hard-required in code (CreateAppointmentDto's own @IsEnum decorators), per
// the locked Phase 1 decision; this screen only ever controls the "extra" fields.
//
// Job Type split (requested 2026-09-22), Phase 6 - a fieldKey can now have several rows,
// one global ("All job types") plus one per Job Type that overrides it. Added a Job Type
// filter (defaults to "All job types" - the global rows, matching this screen's pre-Phase-6
// behaviour) and a Visible/Hidden toggle alongside the existing Mandatory/Optional one.
export function AppointmentFieldConfigPage() {
  const queryClient = useQueryClient();
  const { has } = useMyCapabilities();
  const canManage = has('MASTER_DATA_APPOINTMENT_FIELD_CONFIG_MANAGE');
  const [jobTypeFilter, setJobTypeFilter] = useState<string>('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['appointment-field-configs'],
    queryFn: () => listAppointmentFieldConfigs(),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isMandatory }: { id: string; isMandatory: boolean }) => updateAppointmentFieldConfig(id, isMandatory),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appointment-field-configs'] }),
  });

  const visibilityMutation = useMutation({
    mutationFn: ({ id, isVisible }: { id: string; isVisible: boolean }) => updateAppointmentFieldConfigVisibility(id, isVisible),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appointment-field-configs'] }),
  });

  const rows = (data ?? []).filter((r) => (jobTypeFilter === '' ? true : (r.jobType ?? '') === jobTypeFilter));

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
      // Deliberately NOT labeled "Job Type" - a row's own fieldLabel can literally BE "Job
      // Type" (the New Appointment popup's own Job Type field is one of the configured
      // fields), which would make this header text collide with that row's cell text in
      // both the UI and any exact-text test query. "For Job Type" reads the same but never
      // collides with a fieldLabel value.
      key: 'jobType',
      label: 'For Job Type',
      render: (r) => (
        <span className="text-sm text-slate-600">{r.jobType ? r.jobType.replaceAll('_', ' ') : 'All job types'}</span>
      ),
    },
    {
      key: 'isVisible',
      label: 'Shown on form',
      render: (r) => (
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            role="switch"
            aria-label={`Visible: ${r.fieldLabel}${r.jobType ? ` (${r.jobType})` : ''}`}
            checked={r.isVisible}
            disabled={!canManage || visibilityMutation.isPending}
            onChange={(e) => visibilityMutation.mutate({ id: r.id, isVisible: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 disabled:opacity-50"
          />
          <span className={r.isVisible ? 'text-xs text-slate-500' : 'text-xs font-medium text-rose-600'}>
            {r.isVisible ? 'Visible' : 'Hidden'}
          </span>
        </label>
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
            aria-label={`Mandatory: ${r.fieldLabel}${r.jobType ? ` (${r.jobType})` : ''}`}
            checked={r.isMandatory}
            disabled={!canManage || toggleMutation.isPending || !r.isVisible}
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
          Which optional New Appointment fields the CCE must fill in before saving, and which are shown at all for a given Job
          Type. <span className="font-medium">Type</span> and <span className="font-medium">Customer Type</span> aren't
          listed here — they're always required and can't be turned off.
        </p>
        {!canManage && (
          <p className="mt-1 text-xs text-slate-400">You have view-only access — ask a Super Admin to change these.</p>
        )}
        <div className="mt-3">
          <label className="inline-flex items-center gap-2">
            {/* Deliberately not the bare text "Job Type" - a pre-existing test uses
                `await screen.findByText('Job Type')` as its load-finished signal, matching
                the table's own "Job Type" fieldLabel cell once data arrives; if this static
                filter label said the same thing, that await would resolve on page-load
                (before the async row data renders) instead of waiting for the real row. */}
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Filter: Job Type</span>
            <select
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              value={jobTypeFilter}
              onChange={(e) => setJobTypeFilter(e.target.value)}
            >
              <option value="">All job types (global rows)</option>
              {ACTIVE_JOB_TYPES.map((jt) => (
                <option key={jt} value={jt}>
                  {jt.replaceAll('_', ' ')} overrides
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        isLoading={isLoading}
        error={error}
        emptyMessage="No field config rows found — run the seed script."
      />
    </div>
  );
}
