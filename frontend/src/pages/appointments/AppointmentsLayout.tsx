import { NavLink, Outlet } from 'react-router-dom';

const TABS: { label: string; path: string }[] = [
  { label: 'Schedule', path: '/appointments/schedule' },
  { label: 'My Field Visits', path: '/appointments/field-visits' },
];

export function AppointmentsLayout() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 bg-white px-8 pt-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Appointment Scheduling</p>
        <h1 className="mt-0.5 text-xl font-semibold text-slate-900">
          Book, assign, and track appointments through to completion
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          "Schedule" is the admin/CCE console (create, assign a technician, move status
          forward, cancel). "My Field Visits" is what a technician sees when they log in —
          their own day, plus the on-site capture steps (start visit, serial number +
          warranty check, fault/symptom) that later phases build Job Cards from.
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
