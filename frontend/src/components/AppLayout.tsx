import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useMyCapabilities } from '../lib/useMyCapabilities';
import { ToastProvider } from '../lib/toast';
import { NeedSpareNotifier } from './NeedSpareNotifier';
import { NotificationPermissionBanner } from './NotificationPermissionBanner';

// One row per module in the build plan. `path` is only set once that
// module's screens actually exist — until then it renders as a disabled
// "coming soon" row instead of a link, so this file is also a visible,
// always-up-to-date progress list as each frontend phase ships.
//
// Modification Request (2026-09-15): every row used to render unconditionally, so a role
// with zero reason to open a section (no capability in it, no fullAccess) still saw it in
// the nav, clicked in, and hit a "you don't have access" notice or, worse, a raw backend
// 403 (see InventoryPage/StockLookupPanel's own comment on that second case). `capabilities`
// is that row's module from capability-catalog.ts on the backend (hasAny - holding ANY one
// capability in the module is a real reason to open the section; each row's own layout/page
// still gates the specific action/tab further, same as before - this only controls whether
// the row appears at all). `adminOnly` rows (Users) aren't in the capability matrix at all -
// Users/Permissions/Auth controllers deliberately stay on the hardcoded SUPER_ADMIN/
// SERVICE_HEAD @Roles() forever (capability-catalog.ts's own comment: "the module that fixes
// a bad matrix state can't depend on the system it administers") - fullAccess is that same
// bypass, surfaced client-side. Rows with neither `capabilities` nor `adminOnly` (Dashboard,
// Job Card Journey) are JwtAuthGuard-only server-side - every authenticated user has a real
// reason to see them, so they always show.
const NAV_ITEMS: { label: string; path?: string; capabilities?: string[]; adminOnly?: boolean }[] = [
  { label: 'Dashboard', path: '/' },
  { label: 'Users', path: '/users', adminOnly: true },
  {
    label: 'Master Data',
    path: '/master-data',
    capabilities: [
      'MASTER_DATA_VIEW',
      'MASTER_DATA_SERVICE_CENTRE_CREATE',
      'MASTER_DATA_SERVICE_CENTRE_UPDATE',
      'MASTER_DATA_FAULT_SYMPTOM_MANAGE',
      'MASTER_DATA_SPARE_PARTS_MANAGE',
      'MASTER_DATA_PRICE_LIST_MANAGE',
      'MASTER_DATA_KPI_RULE_MANAGE',
      'MASTER_DATA_NOTIFICATION_TEMPLATE_MANAGE',
      'MASTER_DATA_WARRANTY_MASTER_MANAGE',
      'MASTER_DATA_COMPONENT_YIELD_MANAGE',
      'MASTER_DATA_BULK_IMPORT',
    ],
  },
  {
    label: 'Appointments',
    path: '/appointments',
    capabilities: ['SCHEDULE_CCE_MANAGE', 'SCHEDULE_VIEW_UPDATE', 'SCHEDULE_ASSIGN_TECHNICIAN', 'SCHEDULE_FIELD_VISIT'],
  },
  { label: 'Job Cards', path: '/job-cards', capabilities: ['JOB_CARD_MANAGE', 'JOB_CARD_WARRANTY_OVERRIDE', 'JOB_CARD_TASK_PAUSE'] },
  { label: 'Job Card Journey', path: '/job-cards/journey' },
  { label: 'Technician Schedule', path: '/technician-schedule', capabilities: ['TECHNICIAN_SCHEDULE_GANTT'] },
  { label: 'Workshop Queue', path: '/technician-schedule/workshop-queue', capabilities: ['WORKSHOP_QUEUE_VIEW'] },
  { label: 'Field Technician Schedule', path: '/technician-schedule/field-schedule', capabilities: ['FIELD_SCHEDULE_REORDER'] },
  { label: 'Estimates', path: '/estimates', capabilities: ['ESTIMATE_MANAGE', 'ESTIMATE_RECORD_RESPONSE'] },
  { label: 'Workshop', path: '/workshop', capabilities: ['WORKSHOP_ASSIGN', 'WORKSHOP_ACTION', 'WORKSHOP_VIEW'] },
  {
    label: 'Inventory',
    path: '/inventory',
    capabilities: ['INVENTORY_STAFF', 'INVENTORY_REVIEW', 'INVENTORY_VIEW', 'INVENTORY_RETURN_REQUEST'],
  },
  // QC_GATE_ACCESS covers the QC tab; the Permissions tab is the same admin-only bypass as
  // Users (PermissionsPage's own PERMISSION_ADMIN_ROLES) - either is a real reason to open
  // this section, so it's capabilities-OR-adminOnly, not one or the other.
  { label: 'QC & Permissions', path: '/qc-permissions', capabilities: ['QC_GATE_ACCESS'], adminOnly: true },
  { label: 'Delivery & Invoicing', path: '/delivery', capabilities: ['DELIVERY_MANAGE', 'INVOICING_MANAGE', 'INVOICING_JOB_CARD_VIEW'] },
  { label: 'Finance & Customer Portal', path: '/finance', capabilities: ['INVOICING_MANAGE', 'GL_LEDGER_VIEW'] },
  { label: 'AMC Contracts', path: '/amc', capabilities: ['AMC_MANAGE', 'AMC_VIEW', 'AMC_TECHNICIAN_VISIT', 'AMC_BILLING'] },
  {
    label: 'Dismantling',
    path: '/dismantling',
    capabilities: ['DISMANTLING_HARVEST', 'DISMANTLING_VERIFY', 'DISMANTLING_MANAGE', 'DISMANTLING_VIEW'],
  },
  { label: 'Warranty Claims', path: '/warranty-claims', capabilities: ['WARRANTY_CLAIMS_CLERK', 'WARRANTY_CLAIMS_VIEW', 'CREDIT_NOTE_POST'] },
  {
    label: 'Reports & Dashboards',
    path: '/reports',
    capabilities: ['REPORTS_DASHBOARD_VIEW', 'REPORTS_OPERATIONAL_VIEW', 'REPORTS_QUALITY_VIEW', 'REPORTS_FINANCE_VIEW'],
  },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  // 2026-09-14 (Group C): same REVIEW_ROLES -> INVENTORY_REVIEW conversion as
  // NeedSpareNotifier's own gate (see its doc comment) - was a hardcoded array kept in
  // sync by hand.
  const { has, hasAny, fullAccess, loading: capabilitiesLoading } = useMyCapabilities();
  const canReviewNeedSpare = has('INVENTORY_REVIEW');

  // Modification Request (2026-09-15): while the capability check itself is loading, show
  // every row rather than none - a flash of "everything hidden" on every page load would be
  // worse than a flash of "everything shown" for the ~1 request this query takes to settle
  // (useMyCapabilities has its own 30s staleTime, so this is a true cold-start case only).
  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (capabilitiesLoading) return true;
    if (!item.capabilities && !item.adminOnly) return true;
    if (item.adminOnly && fullAccess) return true;
    if (item.capabilities && hasAny(item.capabilities)) return true;
    return false;
  });

  return (
    <ToastProvider>
      {/* Owns the app-wide Need Spare live-update socket + fires a toast for each new
          request, wherever the reviewer is in the app - the 2026-09-07 fix for a real
          gap found live-verifying Mobile Phases 3-4 (no way for a request to reach a
          reviewer's attention at all). Renders nothing itself. */}
      <NeedSpareNotifier />
      <div className="flex h-screen bg-slate-50">
        <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <p className="text-sm font-semibold tracking-tight text-slate-900">
              Jacky's Service Portal
            </p>
            <p className="text-xs text-slate-400">Service Ops Console</p>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto p-3">
            {visibleNavItems.map((item) =>
              item.path ? (
                <NavLink
                  key={item.label}
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) =>
                    `block rounded-md px-3 py-2 text-sm font-medium ${
                      isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
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

        <main className="flex flex-1 flex-col overflow-y-auto">
          {/* Same reviewer gate as NeedSpareNotifier - only whoever actually holds
              INVENTORY_REVIEW is asked to turn on OS notifications for it. */}
          {canReviewNeedSpare && <NotificationPermissionBanner />}
          <div className="flex-1">
            <Outlet />
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
