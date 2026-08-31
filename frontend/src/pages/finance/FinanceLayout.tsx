import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../lib/auth';

// Same INVOICING_ROLES as invoicing.controller.ts - every route under this layout reads
// financial data (invoice amounts, payment methods, B2B aging), so unlike Delivery (whose
// list/detail queries fire for anyone and only gate the action forms), the whole section
// is gated here, once, at the layout level - mirroring PermissionsPage's admin-only guard
// (Phase 7) rather than Delivery's page-level self-check (Phase 8). A non-privileged user
// never even mounts a child page, so no finance query is ever constructed for them - not
// just refused server-side, never attempted client-side either (the-fool pre-mortem,
// finding #3).
export const FINANCE_ROLES = ['ACCOUNTANT', 'FINANCE_MANAGER', 'SUPER_ADMIN', 'SERVICE_HEAD'];

const TABS: { label: string; path: string }[] = [
  { label: 'Invoices', path: '/finance/invoices' },
  { label: 'B2B Aging Report', path: '/finance/aging' },
];

export function FinanceLayout() {
  const { user } = useAuth();
  const canView = !!user && FINANCE_ROLES.includes(user.role.name);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 bg-white px-8 pt-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Finance & Customer Portal</p>
        <h1 className="mt-0.5 text-xl font-semibold text-slate-900">
          Browse invoices, record payments, and track what's outstanding on B2B Credit
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          "Invoices" is the full system-of-record view (all statuses, B2C and B2B) that
          Delivery's in-context payment flow doesn't give you. "B2B Aging Report" is AC-16's
          0-30/31-60/61-90/90+ days-past-due breakdown of unpaid B2B Credit balances. The
          customer-facing tracking page (status, what's owed, a downloadable summary) is a
          separate public link shared per Job Card - see the "Customer tracking link" on
          that Job Card's own detail screen, not part of this staff section.
        </p>
        {canView && (
          <nav className="mt-4 -mb-px flex flex-wrap gap-1 overflow-x-auto">
            {TABS.map((tab) => (
              <NavLink
                key={tab.path}
                to={tab.path}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-t-md border border-b-0 px-3 py-2 text-sm font-medium ${
                    isActive
                      ? 'border-slate-200 bg-slate-50 text-slate-900'
                      : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                  }`
                }
                end
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
        )}
      </div>
      <div className="flex-1 overflow-y-auto bg-slate-50 px-8 py-6">
        {canView ? (
          <Outlet />
        ) : (
          <p className="max-w-2xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            Finance is restricted to Accountant / Finance Manager / Super Admin / Service Head -
            every endpoint here (invoices, payments, the aging report) is role-gated server-side
            too.
          </p>
        )}
      </div>
    </div>
  );
}
