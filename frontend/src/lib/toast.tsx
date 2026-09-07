import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

// App-wide toast primitive - didn't exist anywhere in this codebase before the 2026-09-07
// Need Spare review notification (grepped: no toast/notification/snackbar/popup library or
// component anywhere in frontend/src). Kept deliberately small - one provider, one hook,
// no external dependency - rather than pulling in a library for what one feature needs so
// far. Any future page can reuse it the same way: call useToast().push({...}) from inside
// <ToastProvider>, which AppLayout mounts once for the whole authenticated app.

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastInput {
  title: string;
  description?: string;
  action?: ToastAction;
  /** Defaults to 8000ms. Pass a larger value for anything the user might need more time to read/act on. */
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastContextValue {
  push: (toast: ToastInput) => void;
}

const DEFAULT_DURATION_MS = 8000;

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (toast: ToastInput) => {
      const id = idRef.current++;
      setToasts((prev) => [...prev, { ...toast, id }]);
      const timer = setTimeout(() => dismiss(id), toast.durationMs ?? DEFAULT_DURATION_MS);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        className="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2"
        aria-live="polite"
        data-testid="toast-stack"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">{t.title}</p>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="shrink-0 text-slate-400 hover:text-slate-600"
              >
                ×
              </button>
            </div>
            {t.description && <p className="mt-1 text-xs text-slate-500">{t.description}</p>}
            {t.action && (
              <button
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
                className="mt-2 text-xs font-medium text-slate-900 underline underline-offset-2"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
