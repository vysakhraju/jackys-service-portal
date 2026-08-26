import { useAuth } from '../lib/auth';

const FRONTEND_PHASES = [
  { name: 'Authentication & Authorization', status: 'done' as const },
  { name: 'Master Data Management', status: 'planned' as const },
  { name: 'Appointment Scheduling', status: 'planned' as const },
  { name: 'Job Cards & Warranty Override', status: 'planned' as const },
  { name: 'Estimates (approval flow)', status: 'planned' as const },
  { name: 'Workshop & Inventory', status: 'planned' as const },
  { name: 'QC & Permissions', status: 'planned' as const },
  { name: 'Delivery & Invoicing', status: 'planned' as const },
  { name: 'Finance & Customer Portal', status: 'planned' as const },
  { name: 'AMC Management', status: 'planned' as const },
  { name: 'Dismantling', status: 'planned' as const },
  { name: 'Reports & Dashboards (live Kanban)', status: 'planned' as const },
];

export function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="text-xl font-semibold text-slate-900">
        Welcome, {user?.firstName}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        You're signed in and talking to the real backend at localhost:3000.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <InfoCard label="Name" value={`${user?.firstName} ${user?.lastName}`} />
        <InfoCard label="Email" value={user?.email ?? '—'} />
        <InfoCard label="Role" value={user?.role.displayName ?? '—'} />
        <InfoCard label="Employee ID" value={user?.employeeId ?? '—'} />
        <InfoCard label="Status" value={user?.status ?? '—'} />
        <InfoCard
          label="Last login"
          value={user?.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—'}
        />
      </div>

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Frontend build progress
      </h2>
      <p className="mt-1 text-xs text-slate-400">
        Same phase-by-phase order the backend was built in — each one gets its own
        screens, wired to the already-tested API, one at a time.
      </p>
      <ul className="mt-4 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {FRONTEND_PHASES.map((phase) => (
          <li key={phase.name} className="flex items-center justify-between px-4 py-2.5">
            <span className="text-sm text-slate-700">{phase.name}</span>
            {phase.status === 'done' ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                Done
              </span>
            ) : (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                Planned
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}
