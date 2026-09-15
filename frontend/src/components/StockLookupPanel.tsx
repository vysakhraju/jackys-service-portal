import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorNotice } from './DataTable';
import { Field, inputClass } from './Field';
import { AccessDeniedNotice } from './AccessDeniedNotice';
import { useMyCapabilities } from '../lib/useMyCapabilities';
import { getStock } from '../lib/inventoryApi';
import { listSpareParts } from '../lib/masterDataApi';
import type { StockLookupResult } from '../lib/inventoryTypes';

/**
 * Modification Request (2026-09-15): extracted from InventoryPage's original
 * StockLookupCard so it can be reused inline on the Workshop screen (the new pill-shaped
 * "Inventory" button opens this in a Modal, without navigating away from the job the
 * technician has open) as well as on its original home, the Inventory & Stock tab.
 *
 * Self-gates on INVENTORY_VIEW (mirrors InventoryController's own
 * @RequiresCapability('INVENTORY_VIEW') on GET /inventory/stock/:sparePartId) rather than
 * relying on the query 403ing - a caller who reaches this panel without the capability
 * (e.g. direct URL nav, or a role granted some other inventory capability but not this
 * one) sees the same "you don't have access yet" notice the rest of the app uses instead
 * of a raw "Access denied. Missing capability: INVENTORY_VIEW" error bubbling out of
 * ErrorNotice.
 */
export function StockLookupPanel() {
  const { has } = useMyCapabilities();
  const canView = has('INVENTORY_VIEW');

  const sparePartsQuery = useQuery({
    queryKey: ['spare-parts', 'active'],
    queryFn: () => listSpareParts({ active: true }),
    enabled: canView,
  });
  const [sparePartId, setSparePartId] = useState('');
  const [location, setLocation] = useState<'MAIN_STORE' | 'DAMAGE_LOCATION'>('MAIN_STORE');
  const [activeId, setActiveId] = useState('');
  const stockQuery = useQuery({
    queryKey: ['stock', activeId, location],
    queryFn: () => getStock(activeId, location),
    enabled: canView && !!activeId,
    retry: false,
  });

  if (!canView) {
    return <AccessDeniedNotice what="stock levels" />;
  }

  return (
    <div>
      <p className="mb-1 text-sm font-medium text-slate-800">Stock lookup</p>
      <p className="mb-3 text-xs text-slate-400">
        Main Store is what's available to reserve. Damage Location is Phase 6's
        consumption total - stock that's permanently moved there on QC approval.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setActiveId(sparePartId);
        }}
        className="flex items-end gap-2"
      >
        <div className="flex-1">
          <Field label="Spare part">
            <select className={inputClass} value={sparePartId} onChange={(e) => setSparePartId(e.target.value)}>
              <option value="">Select…</option>
              {(sparePartsQuery.data ?? []).map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.code} — {sp.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="w-40">
          <Field label="Location">
            <select className={inputClass} value={location} onChange={(e) => setLocation(e.target.value as typeof location)}>
              <option value="MAIN_STORE">Main Store</option>
              <option value="DAMAGE_LOCATION">Damage Location</option>
            </select>
          </Field>
        </div>
        <button
          type="submit"
          disabled={!sparePartId}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Look up
        </button>
      </form>

      {activeId && (
        <div className="mt-3">
          {stockQuery.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
          {stockQuery.error && <ErrorNotice error={stockQuery.error} />}
          {stockQuery.data && <StockSummary stock={stockQuery.data} />}
        </div>
      )}
    </div>
  );
}

function StockSummary({ stock }: { stock: StockLookupResult }) {
  const neverReceived = !stock.id;
  const available = stock.quantityOnHand - stock.quantityReserved;
  return (
    <div className="grid grid-cols-3 gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
      <div>
        <p className="text-xs text-slate-400">On hand</p>
        <p className="font-medium text-slate-800">{stock.quantityOnHand}</p>
      </div>
      <div>
        <p className="text-xs text-slate-400">Reserved</p>
        <p className="font-medium text-slate-800">{stock.quantityReserved}</p>
      </div>
      <div>
        <p className="text-xs text-slate-400">Available</p>
        <p className="font-medium text-slate-800">{available}</p>
      </div>
      {neverReceived && (
        <p className="col-span-3 mt-1 text-xs text-amber-700">
          No stock row exists yet for this part/location - it's never been received via GRN
          (or, for Damage Location, never had anything consumed into it), not necessarily a
          real zero.
        </p>
      )}
    </div>
  );
}
