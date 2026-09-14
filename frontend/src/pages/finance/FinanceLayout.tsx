import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useMyCapabilities } from '../../lib/useMyCapabilities';

// 2026-09-14: was a single hardcoded FINANCE_ROLES role array gating the whole layout as
// one all-or-nothing flag. Invoicing.controller.ts and gl-ledger.controller.ts were
// already migrated onto two DIFFERENT capabilities that happen to share the same
// defaultRoles today (INVOICING_MANAGE for Invoices/Aging, GL_LEDGER_VIEW for GL Postings -
// see capability-catalog.ts's own comment: "Own capability, not shared... each
// finance-adjacent module's FINANCE_ROLES const was independently declared") - so a
// Designation-access grant of just one of them (e.g. GL_LEDGER_VIEW only) needs to unlock
// only that tab, not the whole section. Every route under this layout reads financial data
// (invoice amounts, payment methods, B2B aging), so unlike Delivery (whose list/detail
// queries fire for anyone and only gate the action forms), each route is still gated here,
// at the layout level, per its own capability - preserving the original design's
// query-safety intent (the-fool pre-mortem, finding #3): a caller who can't view a given
// tab never even mounts that child page, so no finance query for it is ever constructed
// client-side, not just refused server-side.
const TABS: { label: string; path: string; capability: string }[] = [
  { label: 'Invoices', path: '/finance/invoices', capability: 'INVOICING_MANAGE' },
  { label: 'B2B Aging Report', path: '/finance/aging', capability: 'INVOICING_MANAGE' },
  { label: 'GL Postings', path: '/finance/gl-postings', capability: 'GL_LEDGER_VIEW' },
];

export function FinanceLayout() {
  const { has, hasAny } = useMyCapabilities();
  const location = useLocation();
  const canViewSection = hasAny(TABS.map((t) => t.capability));
  const visibleTabs = TABS.filter((t) => has(t.capability));
  // Per-route check for the Outlet mount itself, not just the tab nav - a caller with only
  // one of the two capabilities can't reach the other's page via direct URL navigation
  // either (e.g. typing /finance/gl-postings in with only INVOICING_MANAGE).
  const activeTab = TABS.find((t) => location.pathname.startsWith(t.path));
  const canViewCurrentRoute = activeTab ? has(activeTab.capability) : canViewSection;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 bg-white px-8 pt-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Finance & Customer Portal</p>
        <h1 className="mt-0.5 text-xl font-semibold text-slate-900">
          Browse invoices, record payments, and track what's outstanding on B2B Credit
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          "Invoices" is the full system-of-record view (all statuses, B2C and B2B) that
          Delivery's in-context payment flow doesn't give you. "B2B Aging Report" is AC-16's
          0-30/31-60/61-90/90+ days-past-due breakdown of unpaid B2B Credit balances. "GL
          Postings" is a read-only view of the internal journal log (invoice payments, debit
          notes, dismantling recoveries, warranty credit notes) - system-generated only, no
          manual entry. The customer-facing tracking page (status, what's owed, a
          downloadable summary) is a separate public link shared per Job Card - see the
          "Customer tracking link" on that Job Card's own detail screen, not part of this
          staff section.
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
        {canViewCurrentRoute ? (
          <Outlet />
        ) : canViewSection ? (
          <p className="max-w-2xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            You don't hold the {activeTab?.capability ?? 'required'} capability, so this
            particular Finance tab is restricted for you - every endpoint here is
            capability-gated server-side too. Use one of the tabs above instead.
          </p>
        ) : (
          <p className="max-w-2xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            Finance is restricted to callers holding INVOICING_MANAGE or GL_LEDGER_VIEW
            (Accountant / Finance Manager by default, or any role granted one via
            Designation access) - every endpoint here (invoices, payments, the aging
            report, GL postings) is capability-gated server-side too.
          </p>
        )}
      </div>
    </div>
  );
}
