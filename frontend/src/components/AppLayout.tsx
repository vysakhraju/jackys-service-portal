import { Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';

// One row per module in the build plan. `path` is only set once that
// module's screens actually exist — until then it renders as a disabled
// "coming soon" row instead of a link, so this file is also a visible,
// always-up-to-date progress list as each frontend phase ships.
const NAV_ITEMS: { label: string; path?: string }[] = [
  { label: 'Dashboard', path: '/' },
  { label: 'Master Data' },
  { label: 'Appointments' },
  { label: 'Job Cards' },
  { label: 'Estimates' },
  { label: 'Workshop & Inventory' },
  { label: 'QC & Permissions' },
  { label: 'Delivery & Invoicing' },
  { label: 'Finance & Customer Portal' },
  { label: 'AMC Contracts' },
  { label: 'Dismantling' },
  { label: 'Reports & Dashboards' },
];

export function AppLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen bg-slate-50">
      <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <p className="text-sm font-semibold tracking-tight text-slate-900">
            Jacky's Service Portal
          </p>
          <p className="text-xs text-slate-400">Service Ops Console</p>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITEMS.map((item) =>
            item.path ? (
              <a
                key={item.label}
                href={item.path}
                className="block rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                {item.label}
              </a>
            ) : (
              <div
                key={item.label}
                className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-slate-400"
                title="Not built yet"
              >
                <span>{item.label}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  soon
                </span>
              </div>
            ),
          )}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <div className="mb-2 px-2">
            <p className="truncate text-sm font-medium text-slate-800">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="truncate text-xs text-slate-400">{user?.role.displayName}</p>
          </div>
          <button
            onClick={() => void logout()}
            className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Log out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
