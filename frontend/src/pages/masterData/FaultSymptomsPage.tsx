import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ActiveBadge, DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Checkbox, Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useAuth } from '../../lib/auth';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import {
  bulkImportFaultSymptoms,
  createFaultSymptom,
  deleteFaultSymptom,
  listFaultSymptoms,
  updateFaultSymptom,
} from '../../lib/masterDataApi';
import { APPLIANCE_CATEGORIES, type CreateFaultSymptomInput, type FaultSymptom } from '../../lib/masterDataTypes';

type FormValues = {
  faultCode: string;
  faultDescription: string;
  symptomCode: string;
  symptomDescription: string;
  category: string;
  requiresWorkshop: boolean;
  isActive: boolean;
};

// CSV bulk import (#301 follow-up): columns are Category, Symptom, Fault, Active (Y/N) -
// deliberately no code columns, since createFaultSymptom/bulkImportFromCsv already
// auto-generate faultCode/symptomCode server-side when left blank.
type ImportPreview = { rows: Partial<CreateFaultSymptomInput>[]; errors: string[] };

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

export function parseFaultSymptomCsv(text: string): ImportPreview {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { rows: [], errors: ['File is empty.'] };
  }

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const categoryIdx = header.indexOf('category');
  const symptomIdx = header.indexOf('symptom');
  const faultIdx = header.indexOf('fault');
  const activeIdx = header.indexOf('active');
  if (categoryIdx === -1 || symptomIdx === -1 || faultIdx === -1) {
    return { rows: [], errors: ['Header row must include Category, Symptom, and Fault columns.'] };
  }

  const rows: Partial<CreateFaultSymptomInput>[] = [];
  const errors: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const rowNum = i + 1;
    const rawCategory = (cols[categoryIdx] ?? '').trim();
    const symptomDescription = (cols[symptomIdx] ?? '').trim();
    const faultDescription = (cols[faultIdx] ?? '').trim();
    const rawActive = activeIdx === -1 ? 'Y' : (cols[activeIdx] ?? 'Y').trim();

    if (!rawCategory || !symptomDescription || !faultDescription) {
      errors.push(`Row ${rowNum}: Category, Symptom, and Fault are all required.`);
      continue;
    }
    const normalizedCategory = rawCategory.toUpperCase().replace(/[\s-]+/g, '_');
    if (!(APPLIANCE_CATEGORIES as readonly string[]).includes(normalizedCategory)) {
      errors.push(`Row ${rowNum}: unknown category "${rawCategory}".`);
      continue;
    }
    rows.push({
      category: normalizedCategory as CreateFaultSymptomInput['category'],
      symptomDescription,
      faultDescription,
      isActive: !/^n/i.test(rawActive),
    });
  }
  return { rows, errors };
}

export function FaultSymptomsPage() {
  const queryClient = useQueryClient();
  const { has } = useMyCapabilities();
  const { user } = useAuth();
  const canManage = has('MASTER_DATA_FAULT_SYMPTOM_MANAGE');
  const canDelete = user?.role.name === 'SUPER_ADMIN';
  const canImport = has('MASTER_DATA_BULK_IMPORT');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FaultSymptom | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [mutationError, setMutationError] = useState<unknown>(null);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importResult, setImportResult] = useState<{ success: number; errors: string[] } | null>(null);
  const [importError, setImportError] = useState<unknown>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['fault-symptoms', categoryFilter],
    queryFn: () => listFaultSymptoms(categoryFilter || undefined),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      faultCode: '',
      faultDescription: '',
      symptomCode: '',
      symptomDescription: '',
      category: APPLIANCE_CATEGORIES[0],
      requiresWorkshop: false,
      isActive: true,
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateFaultSymptomInput) => createFaultSymptom(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fault-symptoms'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateFaultSymptomInput> }) => updateFaultSymptom(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fault-symptoms'] });
      setModalOpen(false);
    },
    onError: (err) => setMutationError(err),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteFaultSymptom(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fault-symptoms'] }),
  });

  const importMutation = useMutation({
    mutationFn: (rows: Partial<CreateFaultSymptomInput>[]) => bulkImportFaultSymptoms(rows),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['fault-symptoms'] });
      setImportResult(result);
    },
    onError: (err) => setImportError(err),
  });

  function openCreate() {
    setEditing(null);
    setMutationError(null);
    reset({
      faultCode: '',
      faultDescription: '',
      symptomCode: '',
      symptomDescription: '',
      category: APPLIANCE_CATEGORIES[0],
      requiresWorkshop: false,
      isActive: true,
    });
    setModalOpen(true);
  }

  function openEdit(row: FaultSymptom) {
    setEditing(row);
    setMutationError(null);
    reset({
      faultCode: row.faultCode,
      faultDescription: row.faultDescription,
      symptomCode: row.symptomCode,
      symptomDescription: row.symptomDescription,
      category: row.category,
      requiresWorkshop: row.requiresWorkshop,
      isActive: row.isActive,
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function onSubmit(values: FormValues) {
    const payload = { ...values, category: values.category as CreateFaultSymptomInput['category'] };
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
    reader.onload = () => setImportPreview(parseFaultSymptomCsv(String(reader.result ?? '')));
    reader.readAsText(file);
  }

  function runImport() {
    if (!importPreview || importPreview.rows.length === 0) return;
    setImportError(null);
    importMutation.mutate(importPreview.rows);
  }

  const columns: Column<FaultSymptom>[] = [
    { key: 'faultCode', label: 'Fault code', render: (r) => <span className="font-medium text-slate-900">{r.faultCode}</span> },
    { key: 'faultDescription', label: 'Fault', render: (r) => r.faultDescription },
    { key: 'symptomCode', label: 'Symptom code', render: (r) => r.symptomCode },
    { key: 'symptomDescription', label: 'Symptom', render: (r) => r.symptomDescription },
    { key: 'category', label: 'Category', render: (r) => r.category.replace(/_/g, ' ') },
    { key: 'requiresWorkshop', label: 'Workshop?', render: (r) => (r.requiresWorkshop ? 'Yes' : 'No') },
    { key: 'status', label: 'Status', render: (r) => <ActiveBadge active={r.isActive} /> },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500">
          Fault and symptom codes used across job cards. The same symptom can be paired with
          several faults — the technician picks the real one after diagnosis.
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
          <button
            onClick={openCreate}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            + New Fault/Symptom
          </button>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <label className="text-xs font-medium text-slate-500">Filter by category</label>
        <select className={`${inputClass} w-auto`} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All categories</option>
          {APPLIANCE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      <DataTable
        columns={columns}
        rows={data}
        isLoading={isLoading}
        error={error}
        emptyMessage="No fault/symptom codes yet."
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
                        if (confirm(`Delete fault/symptom "${row.faultCode}"? This is a soft delete.`)) {
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

      <Modal open={modalOpen} onClose={closeModal} title={editing ? `Edit ${editing.faultCode}` : 'New Fault / Symptom'}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <ErrorNotice error={mutationError} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Fault code" error={errors.faultCode?.message}>
              <input className={inputClass} placeholder="F001" {...register('faultCode', { required: 'Required' })} />
            </Field>
            <Field label="Symptom code" error={errors.symptomCode?.message}>
              <input className={inputClass} placeholder="S001" {...register('symptomCode', { required: 'Required' })} />
            </Field>
          </div>
          <Field label="Fault description" error={errors.faultDescription?.message}>
            <input className={inputClass} placeholder="Not draining" {...register('faultDescription', { required: 'Required' })} />
          </Field>
          <Field label="Symptom description" error={errors.symptomDescription?.message}>
            <input
              className={inputClass}
              placeholder="Water remains in drum"
              {...register('symptomDescription', { required: 'Required' })}
            />
          </Field>
          <Field label="Appliance category">
            <select className={inputClass} {...register('category', { required: true })}>
              {APPLIANCE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Checkbox label="Requires workshop" {...register('requiresWorkshop')} />
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

      <Modal open={importModalOpen} onClose={closeImport} title="Import Fault / Symptom CSV">
        <div className="space-y-4">
          <ErrorNotice error={importError} />
          <p className="text-sm text-slate-500">
            Columns: <code>Category, Symptom, Fault, Active</code> (Active is Y/N). Fault and
            symptom codes are generated automatically — don't include them in the file.
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
