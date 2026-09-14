import { useEffect, useMemo, useRef, useState } from 'react';
import { inputClass } from '../Field';

export interface NamePickerOption {
  id: string;
  name: string;
}

/**
 * #218/#249: a searchable dropdown over a small, already-fetched list of {id, name}
 * options - the shared replacement for every "paste a UUID" text input across the app
 * that's backed by a list small enough to hand over in one response (service centres,
 * technicians, drivers, rework approvers, spare part models, users). For a list too large
 * or dynamic to prefetch, use AsyncSearchPicker instead.
 *
 * Deliberately a plain filtered list, not a full combobox library - this codebase has no
 * combobox dependency and the interaction only needs to support "type to narrow, click to
 * pick", not full ARIA combobox keyboard semantics.
 */
export function NamePicker({
  value,
  onChange,
  options,
  placeholder = 'Type to search…',
  disabled = false,
  loading = false,
  allowClear = true,
  emptyMessage = 'No matches.',
  getOptionSubtext,
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  options: NamePickerOption[];
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  allowClear?: boolean;
  emptyMessage?: string;
  /** Optional secondary text shown next to each option, e.g. a model number or role. */
  getOptionSubtext?: (option: NamePickerOption) => string | undefined;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  // #218 pre-mortem follow-up (2026-09-14): tracks whether the user has actually typed
  // since the field was last focused. Without this, re-focusing an already-filled field
  // used to blank the input immediately (query reset to '') - harmless (the real `value`
  // was untouched, it just re-displayed on blur/close), but it read as "did I just lose my
  // selection?" on every single converted picker in the app. Now focusing shows the current
  // selection's name (fully selected, so typing replaces it) and the full option list stays
  // browsable underneath, exactly like every option was visible before picking; only actual
  // typing narrows the list.
  const [hasTyped, setHasTyped] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = (hasTyped ? query : '').trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query, hasTyped]);

  const displayValue = open ? (hasTyped ? query : selected?.name ?? '') : selected?.name ?? '';

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        className={inputClass}
        placeholder={loading ? 'Loading…' : placeholder}
        value={displayValue}
        disabled={disabled || loading}
        onFocus={(e) => {
          setHasTyped(false);
          setQuery('');
          setOpen(true);
          // Pre-select the current text so the first keystroke replaces it outright,
          // rather than inserting into the middle of the existing selection's name.
          e.target.select();
        }}
        onChange={(e) => {
          setHasTyped(true);
          setQuery(e.target.value);
          setOpen(true);
        }}
        data-testid="name-picker-input"
      />
      {selected && allowClear && !open && !disabled && (
        <button
          type="button"
          aria-label="Clear selection"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          onClick={() => onChange(null)}
        >
          ×
        </button>
      )}
      {open && !disabled && (
        <ul
          className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg"
          data-testid="name-picker-options"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-1.5 text-slate-400">{emptyMessage}</li>
          ) : (
            filtered.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-slate-100"
                  onClick={() => {
                    onChange(option.id);
                    setQuery('');
                    setHasTyped(false);
                    setOpen(false);
                  }}
                >
                  <span>{option.name}</span>
                  {getOptionSubtext?.(option) && (
                    <span className="ml-2 text-xs text-slate-400">{getOptionSubtext(option)}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
