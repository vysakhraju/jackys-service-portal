import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ActiveBadge, DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Checkbox, Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useAuth } from '../../lib/auth';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import {
  bulkImportApplianceModels,
  createApplianceModel,
  deleteApplianceModel,
  listApplianceModels,
  updateApplianceModel,
} from '../../lib/masterDataApi';
import { APPLIANCE_CATEGORIES, type ApplianceModel, type CreateApplianceModelInput } from '../../lib/masterDataTypes';

type FormValues = {
  brand: string;
  model: string;
  description: string;
  category: string;
  isActive: boolean;
};

const NO_CATEGORY = '';

// CSV bulk import - same pattern as Fault & Symptom's (#301 follow-up): columns are
// Brand, Model, Category, Description, Active (Y/N). Category and Description are
// optional columns - a model with no category is a valid, supported state (see the
// page-level comment below), same reasoning as the manual create/edit form's "Not set"
// option.
type ImportPreview = { rows: Partial<CreateApplianceModelInput>[]; errors: string[] };

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseApplianceModelCsv(text: string): ImportPreview {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { rows: [], errors: ['File is empty.'] };
  }

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const brandIdx = header.indexOf('brand');
  const modelIdx = header.indexOf('model');
  const categoryIdx = header.indexOf('category');
  const descriptionIdx = header.indexOf('description');
  const activeIdx = header.indexOf('active');
  if (brandIdx === -1 || modelIdx === -1) {
    return { rows: [], errors: ['Header row must include Brand and Model columns.'] };
  }

  const rows: Partial<CreateApplianceModelInput>[] = [];
  const errors: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const rowNum = i + 1;
    const brand = (cols[brandIdx] ?? '').trim();
    const model = (cols[modelIdx] ?? '').trim();
    const rawCategory = categoryIdx === -1 ? '' : (cols[categoryIdx] ?? '').trim();
    const description = descriptionIdx === -1 ? '' : (cols[descriptionIdx] ?? '').trim();
    const rawActive = activeIdx === -1 ? 'Y' : (cols[activeIdx] ?? 'Y').trim();

    if (!brand || !model) {
      errors.push(`Row ${rowNum}: Brand and Model are both required.`);
      continue;
    }
    let category: CreateApplianceModelInput['category'] | undefined;
    if (rawCategory) {
      const normalizedCategory = rawCategory.toUpperCase().replace(/[\s-]+/g, '_');
      if (!(APPLIANCE_CATEGORIES as readonly string[]).includes(normalizedCategory)) {
        errors.push(`Row ${rowNum}: unknown category "${rawCategory}".`);
        continue;
      }
      category = normalizedCategory as CreateApplianceModelInput['category'];
    }
    rows.push({
      brand,
      model,
      category,
      description: description || undefined,
      isActive: !/^n/i.test(rawActive),
    });
  }
  return { rows, errors };
}

// #304 - Appliance Models admin page. Backend (POST/GET/PUT/DELETE
// /master-data/appliance-models) has existed since Phase 1; the #301 work (2026-09-21)
// added the nullable `category` column this page now exposes. Category is left
// unset-able on purpose - existing models predate the field and the Fault & Symptom
// pickers already fall back to "show every category" for a model with none set, so
// leaving it blank here is a valid, supported state, not a validation gap.
export function ApplianceModelsPage() {
  const queryClient = useQueryClient();
  const { has } = useMyCapabilities();
  const { user } = useAuth();
  const canManage = has('MASTER_DATA_APPLIANCE_MODEL_MANAGE');
  const canDelete = user?.role.name === 'SUPER_ADMIN';
  const canImport = has('MASTER_DATA_BULK_IMPORT');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ApplianceModel | null>(null);
  const [brandFilter, setBrandFilter] = useState('');
  const [mutationError, setMutationError] = useState<unknown>(null);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importResult, setImportResult] = useState<{ success: number; errors: string[] } | null>(null);
  const [importError, setImportError] = useState<unknown>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['appliance-models', brandFilter],
    queryFn: () => listApplianceModels(brandFilter || undefined),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { brand: '', model: '', description: '', category: NO_CATEGORY, isActive: true },
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateApplianceModelInput) => createApplianceModel(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appliance-models'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateApplianceModelInput> }) => updateApplianceModel(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appliance-models'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteApplianceModel(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appliance-models'] }),
  });

  const importMutation = useMutation({
    mutationFn: (rows: Partial<CreateApplianceModelInput>[]) => bulkImportApplianceModels(rows),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['appliance-models'] });
      setImportResult(result);
    },
    onError: (err) => setImportError(err),
  });

  function openCreate() {
    setEditing(null);
    setMutationError(null);
    reset({ brand: '', model: '', description: '', category: NO_CATEGORY, isActive: true });
    setModalOpen(true);
  }

  function openEdit(row: ApplianceModel) {
    setEditing(row);
    setMutationError(null);
    reset({
      brand: row.brand,
      model: row.model,
      description: row.description ?? '',
      category: row.category ?? NO_CATEGORY,
      isActive: row.isActive,
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function onSubmit(values: FormValues) {
    const payload: CreateApplianceModelInput = {
      brand: values.brand,
      model: values.model,
      description: values.description || undefined,
      category: values.category ? (values.category as CreateApplianceModelInput['category']) : undefined,
      isActive: values.isActive,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function openImport() {
    setImportPreview(null);
    setImportResult(null);
    setImportError(null);
    setImportModalOpen(true);
  }

  function closeImport() {
    setImportModalOpen(false);
  }

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportResult(null);
    setImportError(null);
    const reader = new FileReader();
    reader.onload = () => setImportPreview(parseApplianceModelCsv(String(reader.result ?? '')));
    reader.readAsText(file);
  }

  function runImport() {
    if (!importPreview || importPreview.rows.length === 0) return;
    setImportError(null);
    importMutation.mutate(importPreview.rows);
  }

  const columns: Column<ApplianceModel>[] = [
    { key: 'brand', label: 'Brand', render: (r) => <span className="font-medium text-slate-900">{r.brand}</span> },
    { key: 'model', label: 'Model', render: (r) => r.model },
    {
      key: 'category',
      label: 'Category',
      render: (r) => (r.category ? r.category.replace(/_/g, ' ') : <span className="text-amber-600">Not set</span>),
    },
    { key: 'description', label: 'Description', render: (r) => r.description ?? '—' },
    { key: 'status', label: 'Status', render: (r) => <ActiveBadge active={r.isActive} /> },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500">
          Brand/model combinations used across appointments and job cards. Category links a model to the
          Fault &amp; Symptoms picker — leave unset if unknown, the picker falls back to showing every category.
        </p>
        <div className="flex shrink-0 gap-2">
          {canImport && (
            <button
              onClick={openImport}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Import CSV
            </button>
          )}
          {canManage && (
            <button
              onClick={openCreate}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              + New Appliance Model
            </button>
          )}
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <label className="text-xs font-medium text-slate-500">Filter by brand</label>
        <input
          className={`${inputClass} w-48`}
          placeholder="e.g. LG"
          value={brandFilter}
          onChange={(e) => setBrandFilter(e.target.value)}
        />
      </div>

      <DataTable
        columns={columns}
        rows={data}
        isLoading={isLoading}
        error={error}
        emptyMessage="No appliance models yet — create the first one."
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
                        if (confirm(`Delete appliance model "${row.brand} ${row.model}"? This is a soft delete.`)) {
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

      <Modal open={modalOpen} onClose={closeModal} title={editing ? `Edit ${editing.brand} ${editing.model}` : 'New Appliance Model'}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <ErrorNotice error={mutationError} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Brand" error={errors.brand?.message}>
              <input className={inputClass} placeholder="LG" {...register('brand', { required: 'Brand is required' })} />
            </Field>
            <Field label="Model" error={errors.model?.message}>
              <input className={inputClass} placeholder="WM-2401" {...register('model', { required: 'Model is required' })} />
            </Field>
          </div>
          <Field label="Category" hint="Leave unset if unknown — the fault/symptom picker falls back to showing every category.">
            <select className={inputClass} {...register('category')}>
              <option value={NO_CATEGORY}>Not set</option>
              {APPLIANCE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Description">
            <textarea className={inputClass} rows={2} {...register('description')} />
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

      <Modal open={importModalOpen} onClose={closeImport} title="Import Appliance Model CSV">
        <div className="space-y-4">
          <ErrorNotice error={importError} />
          <p className="text-sm text-slate-500">
            Columns: <code>Brand, Model, Category, Description, Active</code> (Active is Y/N). Brand and
            Model are required; Category and Description may be left blank.
          </p>
          <input type="file" accept=".csv,text/csv" onChange={onFileSelected} data-testid="csv-file-input" />

          {importPreview && importPreview.errors.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <p className="mb-1 font-medium">{importPreview.errors.length} row(s) skipped:</p>
              <ul className="list-disc pl-4">
                {importPreview.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {importPreview && importPreview.rows.length > 0 && (
            <p className="text-sm text-slate-700">{importPreview.rows.length} row(s) ready to import.</p>
          )}
          {importResult && (
            <div className="rounded-md border border-green-200 bg-green-50 p-3 text-xs text-green-800">
              Imported {importResult.success} row(s).
              {importResult.errors.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {importResult.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeImport} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
              Close
            </button>
            <button
              type="button"
              onClick={runImport}
              disabled={!importPreview || importPreview.rows.length === 0 || importMutation.isPending}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Import {importPreview ? importPreview.rows.length : ''} row(s)
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
