import { useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ActiveBadge, DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Checkbox, Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { NamePicker } from '../../components/pickers/NamePicker';
import { useAuth } from '../../lib/auth';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { createPriceList, deletePriceList, importPriceLists, listPriceLists, updatePriceList } from '../../lib/masterDataApi';
import { ACTIVE_JOB_TYPES, APPLIANCE_CATEGORIES, type ApplianceCategoryValue, type JobTypeValue } from '../../lib/masterDataTypes';
import type { CreatePriceListInput, ServicePriceList } from '../../lib/masterDataTypes';
import { useBillingChannelOptions } from '../../lib/useBillingChannelOptions';
import { downloadCsv, parseCsv, toCsv } from '../../lib/csv';

// CSV import/export (2026-09-24) - lets whoever has MASTER_DATA_PRICE_LIST_MANAGE fill in
// real B2B/B2C rates for every Category x Job Type row from a spreadsheet instead of the
// one-row-at-a-time modal above. "Download Template" exports every current row (all still
// seeded at price 0 until filled in) under these exact headers; "Upload CSV" re-imports
// the same headers and UPSERTS by Category + Job Type (see importPriceListRows's own doc
// comment on the backend for why this can't just be a create). Header matching ignores
// case/spacing/punctuation so a header surviving a round-trip through Excel still matches.
const IMPORT_HEADERS = [
  'Category',
  'Job Type',
  'B2B Price',
  'B2C Price',
  'Billing Channel',
  'Channel Rate',
  'Warranty Labor Cost',
  'Currency',
] as const;

const HEADER_KEY_MAP: Record<string, string> = {
  category: 'category',
  jobtype: 'jobType',
  b2bprice: 'priceB2B',
  b2cprice: 'priceB2C',
  billingchannel: 'billingChannel',
  channelrate: 'billingChannelRate',
  warrantylaborcost: 'warrantyLaborCost',
  currency: 'currency',
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

type ImportResult = { created: number; updated: number; errors: string[] };

type FormValues = {
  category: ApplianceCategoryValue;
  jobType: JobTypeValue;
  priceB2B: number;
  priceB2C: number;
  billingChannelId: string;
  billingChannelRate: number;
  warrantyLaborCost: number;
  currency: string;
  isActive: boolean;
};

const EMPTY_FORM: FormValues = {
  category: APPLIANCE_CATEGORIES[0],
  jobType: ACTIVE_JOB_TYPES[0],
  priceB2B: 0,
  priceB2C: 0,
  billingChannelId: '',
  billingChannelRate: 0,
  warrantyLaborCost: 0,
  currency: '',
  isActive: true,
};

function toPayload(values: FormValues): CreatePriceListInput {
  return {
    category: values.category,
    jobType: values.jobType,
    priceB2B: values.priceB2B,
    priceB2C: values.priceB2C,
    billingChannelId: values.billingChannelId || undefined,
    billingChannelRate: values.billingChannelRate,
    warrantyLaborCost: values.warrantyLaborCost,
    currency: values.currency.trim() || undefined,
    isActive: values.isActive,
  };
}

// Price List rebuild (requested 2026-09-22, Phase 3) - full replacement of the original
// (2026-09-14) ServiceActivityType/modelId design. Grid is now Appliance Category x Job
// Type (one row per pair, enforced unique server-side), with B2B price / B2C price / an
// optional Billing Channel + its own interdepartment rate, same CRUD shape and
// capability/role gating as BillingChannelsPage.tsx (its own exact template).
export function PriceListsPage() {
  const queryClient = useQueryClient();
  const { has } = useMyCapabilities();
  const { user } = useAuth();
  const canManage = has('MASTER_DATA_PRICE_LIST_MANAGE');
  const canDelete = user?.role.name === 'SUPER_ADMIN';

  const [categoryFilter, setCategoryFilter] = useState<ApplianceCategoryValue | ''>('');
  const [jobTypeFilter, setJobTypeFilter] = useState<JobTypeValue | ''>('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ServicePriceList | null>(null);
  const [mutationError, setMutationError] = useState<unknown>(null);

  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<unknown>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['price-lists', categoryFilter, jobTypeFilter],
    queryFn: () => listPriceLists(categoryFilter || undefined, jobTypeFilter || undefined),
  });

  const billingChannelOptions = useBillingChannelOptions();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: EMPTY_FORM });

  const createMutation = useMutation({
    mutationFn: (data: CreatePriceListInput) => createPriceList(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-lists'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreatePriceListInput> }) => updatePriceList(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-lists'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePriceList(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['price-lists'] }),
  });

  function openCreate() {
    setEditing(null);
    setMutationError(null);
    reset(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(row: ServicePriceList) {
    setEditing(row);
    setMutationError(null);
    reset({
      category: row.category,
      jobType: row.jobType,
      priceB2B: row.priceB2B,
      priceB2C: row.priceB2C,
      billingChannelId: row.billingChannelId ?? '',
      billingChannelRate: row.billingChannelRate,
      warrantyLaborCost: row.warrantyLaborCost,
      currency: row.currency ?? '',
      isActive: row.isActive,
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function onSubmit(values: FormValues) {
    const payload = toPayload(values);
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  // Exports every current row (ignores the on-screen category/job-type filters — the
  // template is meant to be the whole grid, not just what happens to be shown), under the
  // exact headers importCsv reads back. Doubles as an editable export: re-downloading
  // after prices are filled in gives an up-to-date backup, not just a blank starting form.
  async function handleDownloadTemplate() {
    setIsDownloading(true);
    try {
      const rows = await listPriceLists();
      const csvRows: (string | number)[][] = [
        [...IMPORT_HEADERS],
        ...rows.map((r) => [
          r.category,
          r.jobType,
          r.priceB2B,
          r.priceB2C,
          r.billingChannel?.name ?? '',
          r.billingChannelRate,
          r.warrantyLaborCost,
          r.currency ?? '',
        ]),
      ];
      downloadCsv('price-list-template.csv', toCsv(csvRows));
    } finally {
      setIsDownloading(false);
    }
  }

  function handleUploadClick() {
    setImportResult(null);
    setImportError(null);
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file after a fix-and-retry
    if (!file) return;

    setImportResult(null);
    setImportError(null);
    setIsImporting(true);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.length === 0) {
        setImportError(new Error('That file has no rows.'));
        return;
      }

      const [headerRow, ...dataRows] = parsed;
      const keys = headerRow.map((h) => HEADER_KEY_MAP[normalizeHeader(h)]);

      const rows = dataRows
        .filter((row) => row.some((cell) => cell.trim() !== ''))
        .map((row) => {
          const obj: Record<string, string> = {};
          keys.forEach((key, i) => {
            if (key) obj[key] = row[i] ?? '';
          });
          return obj;
        });

      const result = await importPriceLists(rows);
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ['price-lists'] });
    } catch (err) {
      setImportError(err);
    } finally {
      setIsImporting(false);
    }
  }

  const columns: Column<ServicePriceList>[] = [
    { key: 'category', label: 'Category', render: (r) => r.category.replace(/_/g, ' ') },
    { key: 'jobType', label: 'Job Type', render: (r) => r.jobType.replace(/_/g, ' ') },
    { key: 'priceB2B', label: 'B2B Price', render: (r) => Number(r.priceB2B).toFixed(2) },
    { key: 'priceB2C', label: 'B2C Price', render: (r) => Number(r.priceB2C).toFixed(2) },
    { key: 'billingChannel', label: 'Billing Channel', render: (r) => r.billingChannel?.name ?? '—' },
    { key: 'billingChannelRate', label: 'Channel Rate', render: (r) => Number(r.billingChannelRate).toFixed(2) },
    { key: 'warrantyLaborCost', label: 'Warranty Labor', render: (r) => Number(r.warrantyLaborCost).toFixed(2) },
    { key: 'currency', label: 'Currency', render: (r) => r.currency ?? '—' },
    { key: 'status', label: 'Status', render: (r) => <ActiveBadge active={r.isActive} /> },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-slate-500">
            Price List — one row per Appliance Category x Job Type, with B2B/B2C pricing and an optional Billing
            Channel rate for interdepartment routing.
          </p>
          <label className="text-xs font-medium text-slate-500">Category</label>
          <select
            className={`${inputClass} w-auto`}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as ApplianceCategoryValue | '')}
          >
            <option value="">All categories</option>
            {APPLIANCE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <label className="text-xs font-medium text-slate-500">Job Type</label>
          <select
            className={`${inputClass} w-auto`}
            value={jobTypeFilter}
            onChange={(e) => setJobTypeFilter(e.target.value as JobTypeValue | '')}
          >
            <option value="">All job types</option>
            {ACTIVE_JOB_TYPES.map((jt) => (
              <option key={jt} value={jt}>
                {jt.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={handleDownloadTemplate}
            disabled={isDownloading}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {isDownloading ? 'Preparing…' : 'Download Template'}
          </button>
          {canManage && (
            <>
              <button
                onClick={handleUploadClick}
                disabled={isImporting}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {isImporting ? 'Importing…' : 'Upload CSV'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                aria-label="Upload Price List CSV"
                onChange={handleFileSelected}
              />
              <button
                onClick={openCreate}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
              >
                + New Price Row
              </button>
            </>
          )}
        </div>
      </div>

      {(importResult !== null || importError !== null) && (
        <div
          className={`mb-4 rounded-md border p-3 text-sm ${
            importError || importResult!.errors.length > 0
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {importError ? (
            <ErrorNotice error={importError} />
          ) : (
            <>
              <p className="font-medium">
                Import complete — {importResult!.created} created, {importResult!.updated} updated
                {importResult!.errors.length > 0 ? `, ${importResult!.errors.length} row(s) skipped:` : '.'}
              </p>
              {importResult!.errors.length > 0 && (
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {importResult!.errors.map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={data}
        isLoading={isLoading}
        error={error}
        emptyMessage="No price list rows yet — create the first one."
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
                        if (confirm(`Delete the price row for ${row.category.replace(/_/g, ' ')} / ${row.jobType.replace(/_/g, ' ')}? This is a soft delete.`)) {
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

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? `Edit ${editing.category.replace(/_/g, ' ')} / ${editing.jobType.replace(/_/g, ' ')}` : 'New Price Row'}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <ErrorNotice error={mutationError} />

          <div className="grid grid-cols-2 gap-4">
            <Field label="Appliance Category">
              <select className={inputClass} disabled={!!editing} {...register('category', { required: true })}>
                {APPLIANCE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Job Type">
              <select className={inputClass} disabled={!!editing} {...register('jobType', { required: true })}>
                {ACTIVE_JOB_TYPES.map((jt) => (
                  <option key={jt} value={jt}>
                    {jt.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="B2B Price" error={errors.priceB2B?.message}>
              <input
                type="number"
                step="0.01"
                className={inputClass}
                {...register('priceB2B', { valueAsNumber: true, min: { value: 0, message: 'Must be 0 or more' } })}
              />
            </Field>
            <Field label="B2C Price" error={errors.priceB2C?.message}>
              <input
                type="number"
                step="0.01"
                className={inputClass}
                {...register('priceB2C', { valueAsNumber: true, min: { value: 0, message: 'Must be 0 or more' } })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Billing Channel (optional)" hint="For B2B interdepartment routing — leave blank if not applicable">
              <NamePicker
                value={watch('billingChannelId') || null}
                options={billingChannelOptions.options}
                loading={billingChannelOptions.loading}
                onChange={(id) => setValue('billingChannelId', id ?? '')}
              />
            </Field>
            <Field label="Billing Channel Rate" error={errors.billingChannelRate?.message}>
              <input
                type="number"
                step="0.01"
                className={inputClass}
                {...register('billingChannelRate', { valueAsNumber: true, min: { value: 0, message: 'Must be 0 or more' } })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Warranty Labor Cost" error={errors.warrantyLaborCost?.message}>
              <input
                type="number"
                step="0.01"
                className={inputClass}
                {...register('warrantyLaborCost', { valueAsNumber: true, min: { value: 0, message: 'Must be 0 or more' } })}
              />
            </Field>
            <Field label="Currency">
              <input className={inputClass} placeholder="AED" {...register('currency')} />
            </Field>
          </div>

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
