import { NavLink, Outlet } from 'react-router-dom';

const TABS: { label: string; path: string }[] = [
  { label: 'Ready for Delivery', path: '/delivery/ready' },
  { label: 'Deliveries', path: '/delivery/deliveries' },
];

export function DeliveryLayout() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 bg-white px-8 pt-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Delivery & Invoicing</p>
        <h1 className="mt-0.5 text-xl font-semibold text-slate-900">
          Batch or hand back finished units, gated on payment for out-of-warranty jobs
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          "Ready for Delivery" is the QC_PASSED pool waiting to be claimed into a delivery
          (IW/OOW tabs, batch-select). "Deliveries" tracks each DLV# through dispatch, proof
          of delivery, or cancellation. Invoicing itself has no separate screen yet - it's
          reached in-context here, wherever an out-of-warranty payment needs recording
          (a full Invoicing screen with payment history browsing and the B2B aging report
          is Frontend Phase 9, "Finance extension").
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
