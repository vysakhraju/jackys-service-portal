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
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  const displayValue = open ? query : selected?.name ?? '';

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        className={inputClass}
        placeholder={loading ? 'Loading…' : placeholder}
        value={displayValue}
        disabled={disabled || loading}
        onFocus={() => {
          setQuery('');
          setOpen(true);
        }}
        onChange={(e) => {
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
