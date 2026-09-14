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
 * 2026-09-14 live-tested finding, round 2: a prior fix had WorkshopPage echo its picked Job
 * Card into its OWN url (?jobCardId=) via setSearchParams. That survives a page refresh or
 * a deep link, but NOT the actual reported bug - switching to the Inventory & Stock or Need
 * Spare Requests tab and back. Those 3 tabs are sibling ROUTES under
 * WorkshopInventoryLayout's single <Outlet />, and the "Workshop" tab's <NavLink> target is
 * a fixed path with no query string at all - so clicking back to it navigates to a bare
 * `/workshop-inventory/workshop` and WorkshopPage remounts with nothing to re-seed from,
 * no matter what its own url-sync wrote a moment earlier.
 *
 * The actual fix: hold the selection here, in a provider mounted by
 * WorkshopInventoryLayout itself - which does NOT unmount when its child route changes,
 * only the <Outlet />'s content does. That makes the selection survive every tab switch
 * regardless of what the "Workshop" NavLink's url looks like. WorkshopPage still ALSO
 * mirrors the selection into its own ?jobCardId= (see its own comment) purely so a real
 * browser refresh or a bookmarked/shared link still works - this context is what fixes the
 * in-session tab-switch case the refresh-only fix didn't cover.
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
