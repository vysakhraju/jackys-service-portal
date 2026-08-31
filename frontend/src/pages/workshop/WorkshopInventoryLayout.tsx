import { NavLink, Outlet } from 'react-router-dom';

const TABS: { label: string; path: string }[] = [
  { label: 'Workshop', path: '/workshop-inventory/workshop' },
  { label: 'Inventory & Stock', path: '/workshop-inventory/inventory' },
];

export function WorkshopInventoryLayout() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 bg-white px-8 pt-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Workshop & Inventory</p>
        <h1 className="mt-0.5 text-xl font-semibold text-slate-900">
          Track workshop repairs from technician assignment through to QC hand-off, and the spare part reservations behind them
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          "Workshop" is the per-Job-Card console (assign a technician, start WIP, request
          spares, mark complete). "Inventory & Stock" is where GRN, stock lookups, and idle
          reservation review/return happen - shared across every job.
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
        <Outlet />
      </div>
    </div>
  );
}
