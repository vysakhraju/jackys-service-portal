import type { ReactNode } from 'react';
import type { AxiosError } from 'axios';

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  className?: string;
}

// A plain HTML table shared by every Master Data screen. It only knows how to
// render rows/columns/loading/error/empty states — each page decides what the
// columns are and where the data comes from.
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  isLoading,
  error,
  emptyMessage = 'Nothing here yet.',
  rowActions,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  isLoading: boolean;
  error: unknown;
  emptyMessage?: string;
  rowActions?: (row: T) => ReactNode;
}) {
  if (isLoading) {
    return <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">Loading…</div>;
  }

  if (error) {
    const message =
      (error as AxiosError<{ message?: string | string[] }>).response?.data?.message ??
      (error as Error).message ??
      'Something went wrong talking to the server.';
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Couldn't load this list: {Array.isArray(message) ? message.join(', ') : message}
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">{emptyMessage}</div>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className="px-4 py-2 text-left font-medium text-slate-500">
                {col.label}
              </th>
            ))}
            {rowActions && <th className="px-4 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50">
              {columns.map((col) => (
                <td key={col.key} className={`px-4 py-2 text-slate-700 ${col.className ?? ''}`}>
                  {col.render(row)}
                </td>
              ))}
              {rowActions && <td className="px-4 py-2 text-right">{rowActions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Active</span>
  ) : (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Inactive</span>
  );
}

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    (error as AxiosError<{ message?: string | string[] }>).response?.data?.message ??
    (error as Error).message ??
    'Something went wrong.';
  return (
    <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {Array.isArray(message) ? message.join(', ') : message}
    </div>
  );
}
