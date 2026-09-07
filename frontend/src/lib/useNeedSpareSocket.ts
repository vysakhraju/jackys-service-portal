import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './api';
import { WS_BASE_URL } from './config';
import type { InventoryReservation } from './inventoryTypes';

/**
 * Owns the WebSocket connection behind InventoryGateway's /inventory namespace - the
 * 2026-09-07 fix for a real gap found live-verifying Mobile Phases 3-4: a field
 * technician's Need Spare request had no way to reach a reviewer's attention at all short
 * of Swagger + a raw SQL lookup. `enabled` should be false for any role outside
 * NeedSpareReviewPage's own reviewer roles, same the-fool finding #5 precedent
 * useReportsSocket already follows - the hook itself always runs (hooks can't be
 * conditional), it just no-ops until enabled flips true.
 *
 * `onNewRequest` fires once per reservation id this hook has not seen before, but
 * deliberately NEVER for the very first `need-spare:update` after a (re)connect - that
 * first payload is treated as a baseline snapshot of whatever was already pending, not a
 * batch of brand-new arrivals. Firing it for the initial snapshot would toast a reviewer
 * for requests submitted before they ever opened the app, and would re-toast every
 * already-seen request on every reconnect. `seenIds` persists across reconnects within one
 * mount (only cleared on unmount/disable), so a transient network blip doesn't create a
 * second "first snapshot" and re-fire toasts for things already shown.
 */
export function useNeedSpareSocket(
  enabled: boolean,
  onNewRequest?: (request: InventoryReservation) => void,
): { pending: InventoryReservation[] } {
  const [pending, setPending] = useState<InventoryReservation[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const seenIdsRef = useRef<Set<string> | null>(null);
  // Ref mirror so the socket event handler (registered once per connection) always calls
  // whatever the latest onNewRequest closure is, without needing it in the effect's own
  // dependency array (which would tear down/reconnect the socket on every parent re-render).
  const onNewRequestRef = useRef(onNewRequest);
  onNewRequestRef.current = onNewRequest;

  useEffect(() => {
    if (!enabled) {
      setPending([]);
      seenIdsRef.current = null;
      return;
    }

    const socket = io(`${WS_BASE_URL}/inventory`, {
      auth: (cb) => cb({ token: getAccessToken() }),
      reconnection: true,
    });
    socketRef.current = socket;

    socket.on('need-spare:update', (list: InventoryReservation[]) => {
      setPending(list);

      const previouslySeen = seenIdsRef.current;
      if (previouslySeen) {
        for (const request of list) {
          if (!previouslySeen.has(request.id)) {
            onNewRequestRef.current?.(request);
          }
        }
      }
      seenIdsRef.current = new Set(list.map((r) => r.id));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      seenIdsRef.current = null;
    };
  }, [enabled]);

  return { pending };
}
