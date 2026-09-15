import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AccessDeniedNotice } from '../../components/AccessDeniedNotice';
import { useMyCapabilities } from '../../lib/useMyCapabilities';

/**
 * Modification Request (2026-09-15): Inventory & Stock and Need Spare Requests used to
 * live as 2 of the 3 tabs under WorkshopInventoryLayout ("Workshop & Inventory"), one
 * combined left-pane section. Split out into their own top-level "Inventory" nav item -
 * see AppLayout.tsx's own comment. "Workshop" (the per-Job-Card console) is now its own
 * standalone route; the shared-job-card-selection context that used to keep those 3 tabs
 * in sync no longer applies here, since Inventory & Stock and Need Spare Requests were
 * never job-card-scoped views in the first place (see InventoryPage's own intro text).
 *
 * Per-tab capability lists, same reasoning as FinanceLayout's own split (2026-09-14): each
 * tab is its own genuinely different audience today (INVENTORY_REVIEW-only for Need Spare
 * vs. any of the 3 general inventory capabilities for the broader Inventory & Stock tab, each
 * of whose 4 cards already self-gates further - see InventoryPage.tsx's own comment) - so a
 * Designation-access grant of just one needs to unlock only that tab, not the whole section.
 */
const TABS: { label: string; path: string; capabilities: string[] }[] = [
  { label: 'Inventory & Stock', path: '/inventory/stock', capabilities: ['INVENTORY_VIEW', 'INVENTORY_STAFF', 'INVENTORY_REVIEW'] },
  { label: 'Need Spare Requests', path: '/inventory/need-spare', capabilities: ['INVENTORY_REVIEW'] },
];

export function InventoryLayout() {
  const { hasAny } = useMyCapabilities();
  const location = useLocation();
  const canViewSection = hasAny(TABS.flatMap((t) => t.capabilities));
  const visibleTabs = TABS.filter((t) => hasAny(t.capabilities));
  const activeTab = TABS.find((t) => location.pathname.startsWith(t.path));
  const canViewCurrentRoute = activeTab ? hasAny(activeTab.capabilities) : canViewSection;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 bg-white px-8 pt-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Inventory</p>
        <h1 className="mt-0.5 text-xl font-semibold text-slate-900">
          Stock lookups, GRN, and idle reservation review/return - shared across every job
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          "Inventory & Stock" is where GRN, stock lookups, and idle reservation review/return
          happen. "Need Spare Requests" is field technicians' mobile-app requests waiting for
          a decision. Per-job spare requests and reservations still happen on the Workshop
          screen for that job - use its own "Inventory" button for a quick stock check
          without leaving the job.
        </p>
        {canViewSection && (
          <nav className="mt-4 -mb-px flex flex-wrap gap-1 overflow-x-auto">
            {visibleTabs.map((tab) => (
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
        {canViewCurrentRoute ? <Outlet /> : canViewSection ? <AccessDeniedNotice what="this Inventory tab" /> : <AccessDeniedNotice what="Inventory" />}
      </div>
    </div>
  );
}
