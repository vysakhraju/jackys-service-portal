import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io } from 'socket.io-client';
import { makeApprovalAgingReport, makeKanbanBoard } from '../test/fixtures';

vi.mock('socket.io-client', () => ({ io: vi.fn() }));
vi.mock('./api', () => ({
  api: { get: vi.fn() },
  getAccessToken: vi.fn(),
}));

import { api, getAccessToken } from './api';
import { useReportsSocket } from './useReportsSocket';

// A minimal fake matching just the socket.io-client Socket surface this hook touches:
// .on() captures handlers so a test can fire them directly via .emit(), plus .connect()/
// .disconnect() as plain spies. There's no existing WebSocket precedent elsewhere in this
// codebase to match style against - this is the first.
function createFakeSocket() {
  const handlers: Record<string, ((...args: any[]) => void)[]> = {};
  return {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      (handlers[event] ??= []).push(handler);
    }),
    connect: vi.fn(),
    disconnect: vi.fn(),
    emit(event: string, ...args: any[]) {
      (handlers[event] ?? []).forEach((h) => h(...args));
    },
  };
}

describe('useReportsSocket', () => {
  let fakeSocket: ReturnType<typeof createFakeSocket>;

  beforeEach(() => {
    fakeSocket = createFakeSocket();
    vi.mocked(io).mockReset().mockReturnValue(fakeSocket as any);
    vi.mocked(getAccessToken).mockReset().mockReturnValue('token-1');
    vi.mocked(api.get).mockReset().mockResolvedValue({ data: {} } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never calls io(...) when enabled is false', () => {
    renderHook(() => useReportsSocket(false));
    expect(io).not.toHaveBeenCalled();
  });

  // socket.io-client's own `io()` typings allow `auth` to be either a plain object or a
  // function, and `options` itself is optional - neither is true of what this hook actually
  // passes, so tests that need to invoke `auth` narrow it once here rather than fighting the
  // library's union type at every call site.
  function getAuthFn(): (cb: (data: { token: string | null }) => void) => void {
    const options = vi.mocked(io).mock.calls[0]?.[1];
    const auth = options?.auth;
    if (typeof auth !== 'function') {
      throw new Error('expected useReportsSocket to pass a function-form `auth` option');
    }
    return auth as (cb: (data: { token: string | null }) => void) => void;
  }

  it('connects to the /reports namespace with a function-form auth option when enabled', () => {
    renderHook(() => useReportsSocket(true));
    expect(io).toHaveBeenCalledTimes(1);
    const [url] = vi.mocked(io).mock.calls[0];
    expect(url).toContain('/reports');
    expect(typeof getAuthFn()).toBe('function');
  });

  it("reads the access token fresh on every call to auth, not once at mount", () => {
    renderHook(() => useReportsSocket(true));
    const auth = getAuthFn();
    const cb1 = vi.fn();
    auth(cb1);
    expect(cb1).toHaveBeenCalledWith({ token: 'token-1' });

    // Simulate the access token having been silently refreshed since mount.
    vi.mocked(getAccessToken).mockReturnValue('token-2-refreshed');
    const cb2 = vi.fn();
    auth(cb2);
    expect(cb2).toHaveBeenCalledWith({ token: 'token-2-refreshed' });
  });

  it("sets status to 'live' on connect", () => {
    const { result } = renderHook(() => useReportsSocket(true));
    expect(result.current.status).toBe('connecting');
    act(() => fakeSocket.emit('connect'));
    expect(result.current.status).toBe('live');
  });

  it('stores the kanban:update payload', () => {
    const { result } = renderHook(() => useReportsSocket(true));
    const board = makeKanbanBoard();
    act(() => fakeSocket.emit('kanban:update', board));
    expect(result.current.kanban).toEqual(board);
  });

  it('stores the approval-aging:update payload', () => {
    const { result } = renderHook(() => useReportsSocket(true));
    const aging = makeApprovalAgingReport();
    act(() => fakeSocket.emit('approval-aging:update', aging));
    expect(result.current.approvalAging).toEqual(aging);
  });

  it("on a server-initiated disconnect, refreshes the token via GET /auth/profile then reconnects", async () => {
    const { result } = renderHook(() => useReportsSocket(true));
    act(() => fakeSocket.emit('connect'));
    expect(result.current.status).toBe('live');

    act(() => fakeSocket.emit('disconnect', 'io server disconnect'));
    expect(result.current.status).toBe('reconnecting');
    expect(api.get).toHaveBeenCalledWith('/auth/profile');

    await waitFor(() => expect(fakeSocket.connect).toHaveBeenCalledTimes(1));
  });

  it('does not force a refresh or manually reconnect on an ordinary transient disconnect', () => {
    const { result } = renderHook(() => useReportsSocket(true));
    act(() => fakeSocket.emit('connect'));

    act(() => fakeSocket.emit('disconnect', 'transport close'));
    expect(result.current.status).toBe('reconnecting');
    expect(api.get).not.toHaveBeenCalled();
    expect(fakeSocket.connect).not.toHaveBeenCalled();
  });

  it("still reconnects after a failed token refresh (swallows the rejection) rather than getting stuck", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('refresh token also expired'));
    renderHook(() => useReportsSocket(true));
    act(() => fakeSocket.emit('disconnect', 'io server disconnect'));

    await waitFor(() => expect(fakeSocket.connect).toHaveBeenCalledTimes(1));
  });

  it("flips to 'offline' only once connect_error has fired 5 times in a row", () => {
    const { result } = renderHook(() => useReportsSocket(true));

    for (let i = 0; i < 4; i++) {
      act(() => fakeSocket.emit('connect_error', new Error('nope')));
      expect(result.current.status).toBe('reconnecting');
    }
    act(() => fakeSocket.emit('connect_error', new Error('nope')));
    expect(result.current.status).toBe('offline');
  });

  it('resets the connect_error streak on a successful connect', () => {
    const { result } = renderHook(() => useReportsSocket(true));

    for (let i = 0; i < 4; i++) act(() => fakeSocket.emit('connect_error', new Error('nope')));
    act(() => fakeSocket.emit('connect'));
    expect(result.current.status).toBe('live');

    // Only 4 more after the reset - still short of the 5-in-a-row offline threshold.
    for (let i = 0; i < 4; i++) act(() => fakeSocket.emit('connect_error', new Error('nope')));
    expect(result.current.status).toBe('reconnecting');
  });

  it('disconnects the socket on unmount', () => {
    const { unmount } = renderHook(() => useReportsSocket(true));
    unmount();
    expect(fakeSocket.disconnect).toHaveBeenCalledTimes(1);
  });
});
