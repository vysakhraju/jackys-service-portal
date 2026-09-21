import { NavLink, Outlet } from 'react-router-dom';
import { AccessDeniedNotice } from '../../components/AccessDeniedNotice';
import { useMyCapabilities } from '../../lib/useMyCapabilities';

// Live-tested finding (2026-09-14): a role with none of these had no reason to be able
// to even OPEN the Master Data section - every entity-type GET here either has its own
// specific gate already (MASTER_DATA_VIEW for the browse-only ones) or its own manage
// capability, so "holds any one of them" is exactly "has a real reason to be on this
// page at all". A role holding only, say, MASTER_DATA_SPARE_PARTS_MANAGE still gets in
// (and sees every tab - see the note on ServiceCentresPage's own actions for why
// individual actions are still separately gated within each tab).
const MASTER_DATA_CAPABILITIES = [
  'MASTER_DATA_VIEW',
  'MASTER_DATA_SERVICE_CENTRE_CREATE',
  'MASTER_DATA_SERVICE_CENTRE_UPDATE',
  'MASTER_DATA_CITY_MANAGE',
  'MASTER_DATA_CANCELLATION_REASON_MANAGE',
  'MASTER_DATA_APPLIANCE_MODEL_MANAGE',
  'MASTER_DATA_FAULT_SYMPTOM_MANAGE',
  'MASTER_DATA_SPARE_PARTS_MANAGE',
  'MASTER_DATA_PRICE_LIST_MANAGE',
  'MASTER_DATA_KPI_RULE_MANAGE',
  'MASTER_DATA_NOTIFICATION_TEMPLATE_MANAGE',
  'MASTER_DATA_WARRANTY_MASTER_MANAGE',
  'MASTER_DATA_COMPONENT_YIELD_MANAGE',
  'MASTER_DATA_BULK_IMPORT',
];

const TABS: { label: string; path: string }[] = [
  { label: 'Service Centres', path: '/master-data/service-centres' },
  { label: 'Cities', path: '/master-data/cities' },
  { label: 'Cancellation Reasons', path: '/master-data/cancellation-reasons' },
  { label: 'Appliance Models', path: '/master-data/appliance-models' },
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
  const { loading, hasAny } = useMyCapabilities();
  const canView = hasAny(MASTER_DATA_CAPABILITIES);

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
        {loading ? (
          <p className="text-sm text-slate-400">Checking access…</p>
        ) : canView ? (
          <Outlet />
        ) : (
          <AccessDeniedNotice what="Master Data" />
        )}
      </div>
    </div>
  );
}
