// One shared offline-queue instance for the whole app - a single NetInfo subscription
// and a single in-memory mirror of the persisted queue, so the schedule screen's banner
// and the appointment detail screen's enqueue calls both see the same state instantly
// (no polling, no duplicate listeners). Mirrors AuthContext's provider/useX() shape.
import NetInfo from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  enqueueAction,
  loadQueue,
  processQueue,
  removeAction,
  retryAction,
  type QueuedAction,
  type QueuedActionType,
} from '../lib/offlineQueue';
import type { CaptureFaultSymptomInput, CaptureSerialNumberInput, StartVisitInput } from '../lib/types';

interface EnqueueInput {
  type: QueuedActionType;
  appointmentId: string;
  label: string;
  payload: StartVisitInput | CaptureSerialNumberInput | CaptureFaultSymptomInput;
}

interface OfflineQueueContextValue {
  isOnline: boolean;
  pendingItems: QueuedAction[];
  failedItems: QueuedAction[];
  enqueue: (input: EnqueueInput) => Promise<void>;
  retry: (id: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
}

const OfflineQueueContext = createContext<OfflineQueueContextValue | null>(null);

export function OfflineQueueProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<QueuedAction[]>([]);
  // Assume online until the first NetInfo read/event lands, rather than flashing an
  // "offline" state on every app launch while that first check is in flight.
  const [isOnline, setIsOnline] = useState(true);
  const queryClient = useQueryClient();
  const syncingRef = useRef(false);

  const refresh = useCallback(async () => {
    setItems(await loadQueue());
  }, []);

  const runSync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
      const result = await processQueue();
      if (result.synced.length > 0) {
        // Broad invalidation is deliberate and cheap here - the queue is small and a
        // sync run is infrequent, so refetching the schedule and any open visit is
        // simpler and safer than tracking exactly which query keys each action type
        // could affect.
        queryClient.invalidateQueries({ queryKey: ['technician-schedule'] });
        queryClient.invalidateQueries({ queryKey: ['technician-visit'] });
      }
    } finally {
      syncingRef.current = false;
      await refresh();
    }
  }, [queryClient, refresh]);

  useEffect(() => {
    refresh();

    NetInfo.fetch().then((state) => {
      const online = state.isConnected !== false && state.isInternetReachable !== false;
      setIsOnline(online);
      if (online) runSync();
    });

    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected !== false && state.isInternetReachable !== false;
      setIsOnline((wasOnline) => {
        if (online && !wasOnline) {
          // Reconnected - this is the moment §5's "sync on reconnect" refers to.
          runSync();
        }
        return online;
      });
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enqueue = useCallback(
    async (input: EnqueueInput) => {
      await enqueueAction(input);
      // Opportunistically attempt a sync right away rather than waiting for the next
      // NetInfo event - the last-known `isOnline` value can lag reality by a beat (e.g.
      // connectivity actually came back while the technician was still filling in the
      // form), and a sync attempted while genuinely offline is harmless: processQueue()
      // just leaves the item pending on a network failure. The screen calling enqueue()
      // still checks isOnline first purely to skip a pointless spinner/attempt when it
      // already knows it's offline - this is not the only path that can trigger a sync.
      await runSync();
    },
    [runSync],
  );

  const retry = useCallback(
    async (id: string) => {
      await retryAction(id);
      await runSync();
    },
    [runSync],
  );

  const dismiss = useCallback(
    async (id: string) => {
      await removeAction(id);
      await refresh();
    },
    [refresh],
  );

  const pendingItems = items.filter((item) => item.status === 'pending');
  const failedItems = items.filter((item) => item.status === 'failed');

  return (
    <OfflineQueueContext.Provider value={{ isOnline, pendingItems, failedItems, enqueue, retry, dismiss }}>
      {children}
    </OfflineQueueContext.Provider>
  );
}

export function useOfflineQueue(): OfflineQueueContextValue {
  const ctx = useContext(OfflineQueueContext);
  if (!ctx) {
    throw new Error('useOfflineQueue must be used within an OfflineQueueProvider');
  }
  return ctx;
}
