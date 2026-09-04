// Integration-level tests for the OfflineQueueContext provider: real offlineQueue engine
// + mocked NetInfo (controllable, so a "reconnect" can actually be simulated) + mocked
// AsyncStorage (jest.setup.js's official mock) + mocked technicianApi. Complements
// offlineQueue.test.ts (pure engine) by proving the React/NetInfo wiring around it -
// specifically that a reconnect event actually triggers a sync, not just that the
// engine's processQueue() function works in isolation.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { OfflineQueueProvider, useOfflineQueue } from './OfflineQueueContext';
import { captureSerialNumber, startVisit } from '../lib/technicianApi';

jest.mock('../lib/technicianApi', () => ({
  startVisit: jest.fn(),
  captureSerialNumber: jest.fn(),
  captureFaultSymptom: jest.fn(),
  getVisit: jest.fn(),
  getMySchedule: jest.fn(),
}));

let netInfoListener: ((state: { isConnected: boolean; isInternetReachable: boolean | null }) => void) | null = null;
const mockNetInfoFetch = jest.fn();
jest.mock('@react-native-community/netinfo', () => ({
  fetch: (...args: unknown[]) => mockNetInfoFetch(...args),
  addEventListener: (cb: (state: { isConnected: boolean; isInternetReachable: boolean | null }) => void) => {
    netInfoListener = cb;
    return jest.fn();
  },
}));

const mockedStartVisit = startVisit as jest.Mock;
const mockedCaptureSerialNumber = captureSerialNumber as jest.Mock;

function networkError() {
  // Axios's shape for "request went out, nothing came back" - no `.response` at all.
  return { isAxiosError: true, response: undefined, request: {}, message: 'Network Error' };
}

function Probe() {
  const { isOnline, pendingItems, failedItems, enqueue, retry, dismiss } = useOfflineQueue();
  return (
    <>
      <Text testID="online">{String(isOnline)}</Text>
      <Text testID="pending-count">{pendingItems.length}</Text>
      <Text testID="failed-count">{failedItems.length}</Text>
      {failedItems[0] && <Text testID="failed-0-error">{failedItems[0].errorMessage}</Text>}
      <Pressable
        testID="enqueue-start-visit"
        onPress={() => enqueue({ type: 'START_VISIT', appointmentId: 'appt-1', label: 'Fatima', payload: { gpsLat: 1, gpsLng: 1 } })}
      >
        <Text>enqueue</Text>
      </Pressable>
      {failedItems[0] && (
        <>
          <Pressable testID="retry-0" onPress={() => retry(failedItems[0].id)}>
            <Text>retry</Text>
          </Pressable>
          <Pressable testID="dismiss-0" onPress={() => dismiss(failedItems[0].id)}>
            <Text>dismiss</Text>
          </Pressable>
        </>
      )}
    </>
  );
}

let activeQueryClient: QueryClient | undefined;

async function renderProbe() {
  activeQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  await render(
    <QueryClientProvider client={activeQueryClient}>
      <OfflineQueueProvider>
        <Probe />
      </OfflineQueueProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  netInfoListener = null;
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  mockNetInfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
});

afterEach(() => {
  activeQueryClient?.clear();
  activeQueryClient?.unmount();
  activeQueryClient = undefined;
});

describe('OfflineQueueProvider', () => {
  it('reports online once the initial NetInfo.fetch() resolves', async () => {
    await renderProbe();
    await waitFor(() => expect(screen.getByTestId('online')).toHaveTextContent('true'));
  });

  it('reports offline when the initial NetInfo state is disconnected', async () => {
    mockNetInfoFetch.mockResolvedValue({ isConnected: false, isInternetReachable: false });
    await renderProbe();
    await waitFor(() => expect(screen.getByTestId('online')).toHaveTextContent('false'));
  });

  it('enqueue() adds a pending item, visible to any consumer, when the immediate sync attempt hits a network failure', async () => {
    // enqueue() always attempts an opportunistic sync right away (real connectivity can
    // lag NetInfo's last-known state) - a genuine network failure is what keeps the item
    // 'pending' rather than removing or failing it, so that's what this test simulates.
    mockedStartVisit.mockRejectedValue(networkError());
    await renderProbe();
    await waitFor(() => expect(screen.getByTestId('online')).toHaveTextContent('true'));

    await fireEvent.press(screen.getByTestId('enqueue-start-visit'));

    await waitFor(() => expect(screen.getByTestId('pending-count')).toHaveTextContent('1'));
  });

  it('reconnecting (a NetInfo event flipping offline -> online) retries a pending item and clears it on success', async () => {
    mockNetInfoFetch.mockResolvedValue({ isConnected: false, isInternetReachable: false });
    // First attempt (fired opportunistically by enqueue() itself, while genuinely
    // offline) fails on the network; the retry after reconnecting succeeds.
    mockedStartVisit.mockRejectedValueOnce(networkError());
    mockedStartVisit.mockResolvedValueOnce({ id: 'visit-1' });
    await renderProbe();
    await waitFor(() => expect(screen.getByTestId('online')).toHaveTextContent('false'));

    await fireEvent.press(screen.getByTestId('enqueue-start-visit'));
    await waitFor(() => expect(screen.getByTestId('pending-count')).toHaveTextContent('1'));
    expect(mockedStartVisit).toHaveBeenCalledTimes(1);

    // Simulate the device coming back online.
    await (async () => netInfoListener?.({ isConnected: true, isInternetReachable: true }))();

    await waitFor(() => expect(mockedStartVisit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('pending-count')).toHaveTextContent('0'));
  });

  it('a backend rejection (as opposed to a network failure) surfaces as a failed item, not silently retried', async () => {
    mockedStartVisit.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { message: 'Cannot mark on-site: appointment was cancelled' } },
    });
    await renderProbe();
    await waitFor(() => expect(screen.getByTestId('online')).toHaveTextContent('true'));

    await fireEvent.press(screen.getByTestId('enqueue-start-visit'));

    await waitFor(() => expect(screen.getByTestId('failed-count')).toHaveTextContent('1'));
    expect(screen.getByTestId('failed-0-error')).toHaveTextContent('Cannot mark on-site: appointment was cancelled');
    // A backend rejection is never retried automatically - it stays failed rather than
    // bouncing back to pending on its own.
    expect(screen.getByTestId('pending-count')).toHaveTextContent('0');
  });

  it('retry() moves a failed item back to pending and re-attempts it', async () => {
    mockNetInfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    mockedStartVisit.mockRejectedValueOnce({ isAxiosError: true, response: { status: 409, data: { message: 'Conflict' } } });
    await renderProbe();
    await fireEvent.press(screen.getByTestId('enqueue-start-visit'));
    await waitFor(() => expect(screen.getByTestId('failed-count')).toHaveTextContent('1'));

    mockedStartVisit.mockResolvedValueOnce({ id: 'visit-1' });
    await fireEvent.press(screen.getByTestId('retry-0'));

    await waitFor(() => expect(screen.getByTestId('failed-count')).toHaveTextContent('0'));
    expect(mockedStartVisit).toHaveBeenCalledTimes(2);
  });

  it('dismiss() discards a failed item permanently', async () => {
    mockNetInfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    mockedStartVisit.mockRejectedValue({ isAxiosError: true, response: { status: 400, data: { message: 'nope' } } });
    await renderProbe();
    await fireEvent.press(screen.getByTestId('enqueue-start-visit'));
    await waitFor(() => expect(screen.getByTestId('failed-count')).toHaveTextContent('1'));

    await fireEvent.press(screen.getByTestId('dismiss-0'));

    await waitFor(() => expect(screen.getByTestId('failed-count')).toHaveTextContent('0'));
    expect(screen.getByTestId('pending-count')).toHaveTextContent('0');
  });

  it('useOfflineQueue throws outside an OfflineQueueProvider', async () => {
    function Bare() {
      useOfflineQueue();
      return null;
    }
    // Swallow the expected console.error React logs for this one render-throws case.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(render(<Bare />)).rejects.toThrow('useOfflineQueue must be used within an OfflineQueueProvider');
    spy.mockRestore();
  });
});
