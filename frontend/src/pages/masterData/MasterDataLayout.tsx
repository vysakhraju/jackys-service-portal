import { NavLink, Outlet } from 'react-router-dom';

const TABS: { label: string; path: string }[] = [
  { label: 'Service Centres', path: '/master-data/service-centres' },
  { label: 'Fault & Symptoms', path: '/master-data/fault-symptoms' },
  { label: 'Spare Parts', path: '/master-data/spare-parts' },
  { label: 'Spare Part Models', path: '/master-data/spare-part-models' },
  { label: 'Price Lists', path: '/master-data/price-lists' },
  { label: 'KPI Rules', path: '/master-data/kpi-rules' },
  { label: 'Notification Templates', path: '/master-data/notification-templates' },
  { label: 'Warranty Master', path: '/master-data/warranty-master' },
  { label: 'Component Yield', path: '/master-data/component-yield' },
];

export function MasterDataLayout() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 bg-white px-8 pt-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Master Data Management</p>
        <h1 className="mt-0.5 text-xl font-semibold text-slate-900">Reference data for every downstream module</h1>
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
        <Outlet />
      </div>
    </div>
  );
}
