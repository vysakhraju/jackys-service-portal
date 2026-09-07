import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { io } from 'socket.io-client';
import { makeNeedSpareRequest } from '../test/fixtures';

vi.mock('socket.io-client', () => ({ io: vi.fn() }));
vi.mock('./api', () => ({ getAccessToken: vi.fn() }));

import { getAccessToken } from './api';
import { useNeedSpareSocket } from './useNeedSpareSocket';

// Same minimal fake as useReportsSocket.test.ts - this hook shares its socket.io-client
// surface, so the fake is identical on purpose.
function createFakeSocket() {
  const handlers: Record<string, ((...args: any[]) => void)[]> = {};
  return {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      (handlers[event] ??= []).push(handler);
    }),
    disconnect: vi.fn(),
    emit(event: string, ...args: any[]) {
      (handlers[event] ?? []).forEach((h) => h(...args));
    },
  };
}

describe('useNeedSpareSocket', () => {
  let fakeSocket: ReturnType<typeof createFakeSocket>;

  beforeEach(() => {
    fakeSocket = createFakeSocket();
    vi.mocked(io).mockReset().mockReturnValue(fakeSocket as any);
    vi.mocked(getAccessToken).mockReset().mockReturnValue('token-1');
  });

  it('never calls io(...) when enabled is false', () => {
    renderHook(() => useNeedSpareSocket(false));
    expect(io).not.toHaveBeenCalled();
  });

  it('connects to the /inventory namespace with a function-form auth option when enabled', () => {
    renderHook(() => useNeedSpareSocket(true));
    expect(io).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(io).mock.calls[0];
    expect(url).toContain('/inventory');
    expect(typeof options?.auth).toBe('function');
  });

  it('stores the need-spare:update payload as `pending`', () => {
    const { result } = renderHook(() => useNeedSpareSocket(true));
    const list = [makeNeedSpareRequest()];
    act(() => fakeSocket.emit('need-spare:update', list));
    expect(result.current.pending).toEqual(list);
  });

  it('does NOT call onNewRequest for the first snapshot after connecting', () => {
    const onNewRequest = vi.fn();
    renderHook(() => useNeedSpareSocket(true, onNewRequest));
    act(() => fakeSocket.emit('need-spare:update', [makeNeedSpareRequest({ id: 'res-1' })]));
    expect(onNewRequest).not.toHaveBeenCalled();
  });

  it('calls onNewRequest once for a request id not seen in the previous snapshot', () => {
    const onNewRequest = vi.fn();
    renderHook(() => useNeedSpareSocket(true, onNewRequest));

    act(() => fakeSocket.emit('need-spare:update', [makeNeedSpareRequest({ id: 'res-1' })]));
    expect(onNewRequest).not.toHaveBeenCalled();

    const newRequest = makeNeedSpareRequest({ id: 'res-2' });
    act(() => fakeSocket.emit('need-spare:update', [makeNeedSpareRequest({ id: 'res-1' }), newRequest]));

    expect(onNewRequest).toHaveBeenCalledTimes(1);
    expect(onNewRequest).toHaveBeenCalledWith(newRequest);
  });

  it('does not re-fire onNewRequest for a request already seen in an earlier snapshot', () => {
    const onNewRequest = vi.fn();
    renderHook(() => useNeedSpareSocket(true, onNewRequest));

    act(() => fakeSocket.emit('need-spare:update', [makeNeedSpareRequest({ id: 'res-1' })]));
    act(() => fakeSocket.emit('need-spare:update', [makeNeedSpareRequest({ id: 'res-1' }), makeNeedSpareRequest({ id: 'res-2' })]));
    onNewRequest.mockClear();

    // Same two ids again, nothing new - e.g. a reconnect resending the current snapshot.
    act(() => fakeSocket.emit('need-spare:update', [makeNeedSpareRequest({ id: 'res-1' }), makeNeedSpareRequest({ id: 'res-2' })]));

    expect(onNewRequest).not.toHaveBeenCalled();
  });

  it('fires onNewRequest for every newly-appeared id in a single update, not just the first', () => {
    const onNewRequest = vi.fn();
    renderHook(() => useNeedSpareSocket(true, onNewRequest));

    act(() => fakeSocket.emit('need-spare:update', []));
    const a = makeNeedSpareRequest({ id: 'res-a' });
    const b = makeNeedSpareRequest({ id: 'res-b' });
    act(() => fakeSocket.emit('need-spare:update', [a, b]));

    expect(onNewRequest).toHaveBeenCalledTimes(2);
    expect(onNewRequest).toHaveBeenCalledWith(a);
    expect(onNewRequest).toHaveBeenCalledWith(b);
  });

  it('disconnects the socket on unmount', () => {
    const { unmount } = renderHook(() => useNeedSpareSocket(true));
    unmount();
    expect(fakeSocket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('clears pending and resets the baseline when enabled flips to false', () => {
    const onNewRequest = vi.fn();
    const { result, rerender } = renderHook(({ enabled }) => useNeedSpareSocket(enabled, onNewRequest), {
      initialProps: { enabled: true },
    });
    act(() => fakeSocket.emit('need-spare:update', [makeNeedSpareRequest({ id: 'res-1' })]));
    expect(result.current.pending).toHaveLength(1);

    rerender({ enabled: false });
    expect(result.current.pending).toEqual([]);
  });
});
