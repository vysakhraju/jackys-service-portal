import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken } from './api';
import { WS_BASE_URL } from './config';
import type { ApprovalAgingReport, KanbanBoard, ReportsConnectionStatus } from './reportsTypes';

// After this many CONSECUTIVE connect_error events, the status flips to 'offline' so the
// UI stops implying "reconnecting any second now" when the real cause is something that
// won't resolve itself (a corporate proxy blocking the WebSocket upgrade entirely, the
// backend down for longer than a blip). socket.io keeps retrying underneath regardless -
// this only changes what's shown, per the-fool finding #2.
const OFFLINE_AFTER_CONSECUTIVE_ERRORS = 5;

interface ReportsSocketState {
  status: ReportsConnectionStatus;
  kanban: KanbanBoard | null;
  approvalAging: ApprovalAgingReport | null;
}

/**
 * Owns the single WebSocket connection behind the live Kanban board + approval-aging
 * feed (reports.gateway.ts's /reports namespace). `enabled` should be false for any user
 * outside REPORTS_VIEW_ROLES so a restricted account never even attempts the handshake
 * (the-fool finding #5) - the hook itself always runs (hooks can't be conditional), it
 * just no-ops until enabled flips true.
 *
 * Two the-fool findings live entirely in here:
 *  - #1 (token staleness): the client's `auth` option is a FUNCTION, not a plain object,
 *    so socket.io calls it fresh before every connection attempt - including automatic
 *    reconnects - rather than replaying whatever token was captured at mount time. That
 *    alone isn't enough if the viewer has been idle long enough for the access token to
 *    expire (NFR-04: 15 min) with zero other REST calls happening to trigger axios's own
 *    silent-refresh interceptor (lib/api.ts). So on a server-initiated disconnect (which is
 *    what an auth failure on a reconnect attempt looks like - see the 'disconnect' handler
 *    below) this hook proactively calls an already-authenticated REST endpoint first,
 *    forcing that refresh, before manually reconnecting.
 *  - #2 (silent staleness looks like calm): the returned `status` is the thing the page
 *    renders as a connection pill - 'live' data and a dropped connection must never look
 *    the same.
 */
export function useReportsSocket(enabled: boolean): ReportsSocketState {
  const [status, setStatus] = useState<ReportsConnectionStatus>('connecting');
  const [kanban, setKanban] = useState<KanbanBoard | null>(null);
  const [approvalAging, setApprovalAging] = useState<ApprovalAgingReport | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const errorStreakRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setStatus('connecting');
      return;
    }

    setStatus('connecting');
    const socket = io(`${WS_BASE_URL}/reports`, {
      auth: (cb) => cb({ token: getAccessToken() }),
      reconnection: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      errorStreakRef.current = 0;
      setStatus('live');
    });

    socket.on('kanban:update', (board: KanbanBoard) => setKanban(board));
    socket.on('approval-aging:update', (aging: ApprovalAgingReport) => setApprovalAging(aging));

    socket.on('disconnect', (reason: Socket.DisconnectReason) => {
      if (reason === 'io server disconnect') {
        // Server-initiated - socket.io will NOT auto-reconnect on its own after this one
        // (that's true only for client/transport-initiated disconnects). Almost always
        // means handleConnection's JWT check rejected a reconnect attempt's now-stale
        // token. Force a refresh, then reconnect manually with whatever that leaves us.
        setStatus('reconnecting');
        api
          .get('/auth/profile')
          .catch(() => {
            // Refresh token also expired: lib/api.ts's response interceptor already
            // clears storage and redirects to /login on its own - nothing more to do
            // from inside a socket event handler.
          })
          .finally(() => socketRef.current?.connect());
      } else {
        // Transient drop (network blip, backend restart, laptop sleep/wake) - socket.io's
        // built-in reconnection logic (with backoff) handles this by itself.
        setStatus('reconnecting');
      }
    });

    socket.on('connect_error', () => {
      errorStreakRef.current += 1;
      setStatus(errorStreakRef.current >= OFFLINE_AFTER_CONSECUTIVE_ERRORS ? 'offline' : 'reconnecting');
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled]);

  return { status, kanban, approvalAging };
}
