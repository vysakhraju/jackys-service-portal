import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../lib/auth';

// Mirrors PERMISSION_ADMIN_ROLES in PermissionsPage.tsx / permissions.controller.ts exactly.
// Live-tested finding (2026-09-16): a Customer Care Executive could see the "Permissions"
// tab and click into it, only to be shown PermissionsPage's own restricted-access notice -
// every endpoint behind that screen is admin-only server-side, so a non-admin user was
// never going to be able to do anything there. Filtering the tab out here means that
// notice is never reached in normal navigation, instead of being shown and then blocking.
const PERMISSION_ADMIN_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD'];

const ALL_TABS: { label: string; path: string; adminOnly?: boolean }[] = [
  { label: 'QC', path: '/qc-permissions/qc' },
  { label: 'Permissions', path: '/qc-permissions/permissions', adminOnly: true },
];

export function QcPermissionsLayout() {
  const { user } = useAuth();
  const isAdmin = !!user && PERMISSION_ADMIN_ROLES.includes(user.role.name);
  const tabs = ALL_TABS.filter((tab) => !tab.adminOnly || isAdmin);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 bg-white px-8 pt-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">QC & Permissions</p>
        <h1 className="mt-0.5 text-xl font-semibold text-slate-900">
          Approve or reject workshop work, and control who can do that
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          "QC" approves or rejects a READY_FOR_QC job. "Permissions" is where an admin
          grants or revokes the QC_APPROVAL / REWORK_APPROVAL permissions those actions
          require - deliberately not tied to a fixed role, so any user can be assigned.
        </p>
        <nav className="mt-4 -mb-px flex flex-wrap gap-1 overflow-x-auto">
          {tabs.map((tab) => (
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
