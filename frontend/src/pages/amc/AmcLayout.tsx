import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { amcPermissions } from '../../lib/amcTypes';

// Page-level self-check, like Delivery (Phase 8) - not a Finance-style (Phase 9)
// layout-level gate - because AMC_VIEW_ROLES is broad (it includes both technician roles,
// since a technician needs to see their own contract/schedule context) and the view data
// itself isn't uniformly sensitive the way Finance's is. Only the narrower actions within
// each tab (create/renew/cancel/reminder, completing a visit, billing) are individually
// gated - see amcPermissions() in lib/amcTypes.ts, the single source of truth for all four
// of this module's role checks (the-fool pre-mortem finding #2).
const TABS: { label: string; path: string }[] = [
  { label: 'Contracts', path: '/amc/contracts' },
  { label: 'Expiring Soon', path: '/amc/expiring' },
  { label: 'Upsell Candidates', path: '/amc/upsell' },
];

export function AmcLayout() {
  const { user } = useAuth();
  const canView = amcPermissions(user?.role.name).canView;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 bg-white px-8 pt-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">AMC Management</p>
        <h1 className="mt-0.5 text-xl font-semibold text-slate-900">
          Annual Maintenance Contracts, their PM visit schedule, and billing
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Creating a contract auto-generates its full preventive-maintenance visit schedule
          (capped at 60 visits) as regular appointments - each PM visit is completed here,
          with its own checklist/signature/extra-charge record, not through the generic
          Appointments "Complete" action.
        </p>
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
      </div>
      <div className="flex-1 overflow-y-auto bg-slate-50 px-8 py-6">
        {canView ? (
          <Outlet />
        ) : (
          <p className="max-w-2xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            AMC data is restricted to Service Head / Super Admin / CCE / Technicians /
            Accountant / Finance Manager - every endpoint here is role-gated server-side too.
          </p>
        )}
      </div>
    </div>
  );
}
