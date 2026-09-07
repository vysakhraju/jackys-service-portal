import { NavLink, Outlet } from 'react-router-dom';

// BRD Workflow 14 in full: 18.1 (Live Board, Frontend Phase 12) plus the three dashboards
// deferred at that time - 18.2 Finance, 18.3 Quality/Product, 18.4 Operational (Frontend
// Phase 14). Each tab has its OWN role list (Finance pulls in ACCOUNTANT/FINANCE_MANAGER,
// which the other three explicitly exclude - see reportsTypes.ts), so unlike FinanceLayout
// this layout deliberately does NOT gate at this level or filter which tabs render: every
// tab is always visible, matching AppLayout's own top-level nav (which never hides a
// module from a role that can't use it either) - each destination page runs its own
// canView check before firing any network call and shows the restricted-access notice
// itself when the viewer's role doesn't match. This also means a page whose own header
// already explains its scope (ReportsPage's "Live Job Status Board" intro) isn't
// duplicated up here - this layout is just the tab strip.
const TABS: { label: string; path: string; end?: boolean }[] = [
  { label: 'Live Board', path: '/reports', end: true },
  { label: 'Finance', path: '/reports/finance' },
  { label: 'Quality', path: '/reports/quality' },
  { label: 'Operational', path: '/reports/operational' },
];

export function ReportsLayout() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 bg-white px-8 pt-4">
        <nav className="-mb-px flex flex-wrap gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              end={tab.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-t-md border border-b-0 px-3 py-2 text-sm font-medium ${
                  isActive
                    ? 'border-slate-200 bg-slate-50 text-slate-900'
                    : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="flex-1 overflow-y-auto bg-slate-50">
        <Outlet />
      </div>
    </div>
  );
}
