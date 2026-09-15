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
//
// Modification Request (2026-09-15, Delivery & Invoicing screen): two purely-additive,
// opt-in props for lists that can grow large - `maxHeightClassName` wraps the table body in
// its own scroll container (a Tailwind max-h-* class, e.g. "max-h-[28rem]") with a sticky
// header, so a long list scrolls internally instead of pushing the whole page down; `dense`
// switches the default text-sm to text-xs for a tighter, more "operational list" read.
// Neither prop is set by any of the ~40 existing callers, so this changes nothing for them.
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  isLoading,
  error,
  emptyMessage = 'Nothing here yet.',
  rowActions,
  maxHeightClassName,
  dense = false,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  isLoading: boolean;
  error: unknown;
  emptyMessage?: string;
  rowActions?: (row: T) => ReactNode;
  maxHeightClassName?: string;
  dense?: boolean;
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

  const textSizeClass = dense ? 'text-xs' : 'text-sm';
  const cellPadding = dense ? 'px-3 py-1.5' : 'px-4 py-2';

  return (
    <div className={`overflow-x-auto rounded-lg border border-slate-200 bg-white ${maxHeightClassName ?? ''}`}>
      <table className={`min-w-full divide-y divide-slate-200 ${textSizeClass}`}>
        <thead className={`bg-slate-50 ${maxHeightClassName ? 'sticky top-0 z-10' : ''}`}>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={`${cellPadding} text-left font-medium text-slate-500`}>
                {col.label}
              </th>
            ))}
            {rowActions && <th className={cellPadding} />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50">
              {columns.map((col) => (
                <td key={col.key} className={`${cellPadding} text-slate-700 ${col.className ?? ''}`}>
                  {col.render(row)}
                </td>
              ))}
              {rowActions && <td className={`${cellPadding} text-right`}>{rowActions(row)}</td>}
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

// Live-tested finding (2026-09-14): a 403 from RolesGuard's designation-matrix check reads
// as raw backend text - "Access denied. Missing capability: TECHNICIAN_SCHEDULE_GANTT." -
// which a CCE/Workshop Technician hitting it read as "this feature doesn't exist for me",
// not "an admin can grant this". Every one of these IS grantable today via
// Users -> Designation access (the capability catalog backs every @RequiresCapability()
// check in the app) - this was a UX gap, not a missing feature. Rather than touch every
// page individually, this shared component (already used by ~40 pages for every error
// state) now recognizes both 403 shapes RolesGuard throws and appends one plain-language
// line pointing at the actual fix, while still showing the real message beneath it for
// anyone diagnosing the exact key/role.
const MISSING_CAPABILITY_RE = /Missing capability: (\S+?)\.?$/;
const MISSING_ROLE_RE = /^Access denied\. Required roles: /;

function accessDeniedHint(message: string): string | null {
  if (MISSING_CAPABILITY_RE.test(message) || MISSING_ROLE_RE.test(message)) {
    return "You don't have access to this yet. A Super Admin can grant it under Users → Designation access (tick the capability for your designation - it takes effect immediately, no re-login needed).";
  }
  return null;
}

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const status = (error as AxiosError).response?.status;
  const message =
    (error as AxiosError<{ message?: string | string[] }>).response?.data?.message ??
    (error as Error).message ??
    'Something went wrong.';
  const text = Array.isArray(message) ? message.join(', ') : message;
  const hint = status === 403 ? accessDeniedHint(text) : null;
  return (
    <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <p>{text}</p>
      {hint && <p className="mt-1 text-red-600">{hint}</p>}
    </div>
  );
}
