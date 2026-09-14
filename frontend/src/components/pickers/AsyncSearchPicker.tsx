import { useEffect, useRef, useState } from 'react';
import { inputClass } from '../Field';

/**
 * #218/#249: a debounced async typeahead against a backend search endpoint - the shared
 * replacement for "paste a Job Card/Appointment id" text inputs where the full list is too
 * large or dynamic to prefetch (unlike NamePicker's small-list case). Generic over the
 * result item type T so it can sit in front of any search(query) => Promise<T[]> function -
 * this session's first user is GET /job-card-journey/search.
 */
export function AsyncSearchPicker<T>({
  onSelect,
  search,
  renderOption,
  getOptionLabel,
  placeholder = 'Search…',
  minChars = 2,
  debounceMs = 300,
  disabled = false,
  selectedLabel,
  onClear,
  emptyMessage = 'No matches.',
}: {
  onSelect: (item: T) => void;
  search: (query: string) => Promise<T[]>;
  renderOption: (item: T) => React.ReactNode;
  getOptionLabel: (item: T) => string;
  placeholder?: string;
  minChars?: number;
  debounceMs?: number;
  disabled?: boolean;
  /** When set, shows this as the current selection instead of the search box. */
  selectedLabel?: string | null;
  onClear?: () => void;
  /**
   * #218 pre-mortem follow-up (2026-09-14): shown when a search comes back empty. Override
   * this for a picker whose search() isn't a real narrowing search (e.g. an exact-match
   * lookup adapter) so a zero-result state reads as "check what you typed", not "the system
   * might be broken" - the generic default is fine for a real partial-match search.
   */
  emptyMessage?: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (trimmed.length < minChars) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    const thisRequestId = ++requestIdRef.current;

    debounceRef.current = setTimeout(async () => {
      try {
        const items = await search(trimmed);
        // Ignore stale responses from a superseded keystroke.
        if (thisRequestId === requestIdRef.current) {
          setResults(items);
        }
      } catch {
        if (thisRequestId === requestIdRef.current) {
          setError('Search failed - try again.');
          setResults([]);
        }
      } finally {
        if (thisRequestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    }, debounceMs);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, minChars, debounceMs]);

  if (selectedLabel != null && !open) {
    return (
      <div className="flex items-center gap-2">
        <span className={`${inputClass} flex items-center`}>{selectedLabel}</span>
        {!disabled && onClear && (
          <button type="button" className="text-xs text-slate-500 hover:text-slate-700 hover:underline" onClick={onClear}>
            Change
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        className={inputClass}
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        data-testid="async-search-picker-input"
      />
      {open && !disabled && (
        <ul
          className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg"
          data-testid="async-search-picker-options"
        >
          {query.trim().length < minChars ? (
            <li className="px-3 py-1.5 text-slate-400">Type at least {minChars} characters to search.</li>
          ) : loading ? (
            <li className="px-3 py-1.5 text-slate-400">Searching…</li>
          ) : error ? (
            <li className="px-3 py-1.5 text-red-600">{error}</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-1.5 text-slate-400">{emptyMessage}</li>
          ) : (
            results.map((item, idx) => (
              <li key={getOptionLabel(item) + idx}>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left hover:bg-slate-100"
                  onClick={() => {
                    onSelect(item);
                    setQuery('');
                    setOpen(false);
                  }}
                >
                  {renderOption(item)}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
