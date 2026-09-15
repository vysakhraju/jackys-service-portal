import { createContext, useContext, useState, type ReactNode } from 'react';

export interface WorkshopJobCardSelection {
  id: string;
  label: string | null;
}

interface WorkshopInventoryContextValue {
  selection: WorkshopJobCardSelection;
  setSelection: (selection: WorkshopJobCardSelection) => void;
}

const EMPTY_SELECTION: WorkshopJobCardSelection = { id: '', label: null };

const WorkshopInventoryContext = createContext<WorkshopInventoryContextValue | null>(null);

/**
 * 2026-09-14 live-tested finding, round 2 (historical - see the Modification Request note
 * below for the current state): a prior fix had WorkshopPage echo its picked Job Card into
 * its OWN url (?jobCardId=) via setSearchParams. That survives a page refresh or a deep
 * link, but NOT the bug reported at the time - switching to the Inventory & Stock or Need
 * Spare Requests tab and back, when those 3 lived as sibling ROUTES under one
 * WorkshopInventoryLayout's <Outlet />, and the "Workshop" tab's <NavLink> target was a
 * fixed path with no query string at all - so clicking back to it navigated to a bare
 * path and WorkshopPage remounted with nothing to re-seed from.
 *
 * The fix at the time: hold the selection here, in a provider mounted by the shared
 * layout itself - which did not unmount when its child route changed, only the
 * <Outlet />'s content did.
 *
 * Modification Request (2026-09-15): Workshop is now its own standalone top-level route -
 * no sibling tabs, no shared layout, nothing left to mount this Provider (see AppLayout.tsx/
 * InventoryLayout.tsx's own comments). useWorkshopJobCardSelection() below gracefully falls
 * back to page-local state in that case (its own doc comment describes this fallback branch,
 * originally written for unit tests mounting WorkshopPage standalone - that's now literally
 * true in production too), so WorkshopPage needed no changes: it still works exactly as
 * before, just without cross-tab persistence it no longer needs. This file (and its
 * WorkshopInventoryProvider export) is kept, unused, in case a future job-card-scoped sibling
 * tab is ever added back under Workshop.
 */
export function WorkshopInventoryProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<WorkshopJobCardSelection>(EMPTY_SELECTION);
  return <WorkshopInventoryContext.Provider value={{ selection, setSelection }}>{children}</WorkshopInventoryContext.Provider>;
}

/**
 * Falls back to page-local-only state (no cross-tab persistence) when used outside the
 * provider - e.g. a unit test mounting WorkshopPage standalone without the layout around
 * it. That fallback behaves exactly like the previous (incomplete) fix did, so existing
 * tests that don't render the layout keep working unchanged.
 */
export function useWorkshopJobCardSelection(): WorkshopInventoryContextValue {
  const ctx = useContext(WorkshopInventoryContext);
  const local = useState<WorkshopJobCardSelection>(EMPTY_SELECTION);
  return ctx ?? { selection: local[0], setSelection: local[1] };
}
