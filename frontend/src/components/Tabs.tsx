// A small, generic tab bar - segregates a page into named sections instead of one long
// scroll. Only the active panel's children are mounted, so a heavy/rarely-used tab (its
// own queries included) never loads until an admin actually opens it.
import type { ReactNode } from 'react';

export interface TabDef {
  id: string;
  label: string;
  hint?: string;
}

export function TabBar({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-slate-200">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            title={tab.hint}
            onClick={() => onChange(tab.id)}
            className={`relative -mb-px rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'border border-b-white bg-white text-slate-900'
                : 'border border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ active, children }: { active: boolean; children: ReactNode }) {
  if (!active) return null;
  return <div role="tabpanel">{children}</div>;
}
