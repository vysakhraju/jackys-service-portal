// Core-engine tests for Phase 4's offline queue - deliberately independent of any
// screen/React Query, exercising exactly the mechanism the scope doc's §5 "spike
// first" recommendation is about: enqueue -> persist -> replay -> success/failure,
// including the network-vs-backend-failure distinction that decides whether an item
// stays silently pending or gets surfaced to the technician.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  enqueueAction,
  extractBackendErrorMessage,
  isNetworkError,
  loadQueue,
  processQueue,
  removeAction,
  retryAction,
} from './offlineQueue';
import { captureFaultSymptom, captureSerialNumber, startVisit } from './technicianApi';

jest.mock('./technicianApi', () => ({
  startVisit: jest.fn(),
  captureSerialNumber: jest.fn(),
  captureFaultSymptom: jest.fn(),
  getVisit: jest.fn(),
  getMySchedule: jest.fn(),
}));

const mockedStartVisit = startVisit as jest.Mock;
const mockedCaptureSerialNumber = captureSerialNumber as jest.Mock;
const mockedCaptureFaultSymptom = captureFaultSymptom as jest.Mock;

function networkError() {
  // Axios's shape for "request went out, nothing came back" - no `.response` at all.
  return { isAxiosError: true, response: undefined, request: {}, message: 'Network Error' };
}

function backendError(status: number, message: string) {
  return { isAxiosError: true, response: { status, data: { message } } };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('isNetworkError', () => {
  it('is true for an axios error with no response', () => {
    expect(isNetworkError(networkError())).toBe(true);
  });

  it('is false for an axios error that got a real response', () => {
    expect(isNetworkError(backendError(400, 'bad request'))).toBe(false);
  });

  it('is false for a non-axios error', () => {
    expect(isNetworkError(new Error('boom'))).toBe(false);
  });
});

describe('extractBackendErrorMessage', () => {
  it('reads a string message off the response body', () => {
    expect(extractBackendErrorMessage(backendError(400, 'Invalid technician'), 'fallback')).toBe('Invalid technician');
  });

  it('joins an array message (class-validator style)', () => {
    const err = { isAxiosError: true, response: { data: { message: ['a', 'b'] } } };
    expect(extractBackendErrorMessage(err, 'fallback')).toBe('a b');
  });

  it('falls back for anything else', () => {
    expect(extractBackendErrorMessage(new Error('boom'), 'fallback')).toBe('fallback');
  });
});

describe('enqueueAction / loadQueue', () => {
  it('persists a queued action and it survives a fresh load (simulating app restart)', async () => {
    await enqueueAction({
      type: 'START_VISIT',
      appointmentId: 'appt-1',
      label: 'Fatima Al Sayed (APT-0001)',
      payload: { gpsLat: 25.2, gpsLng: 55.3 },
    });

    const reloaded = await loadQueue();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]).toMatchObject({
      type: 'START_VISIT',
      appointmentId: 'appt-1',
      status: 'pending',
      errorMessage: null,
    });
  });

  it('dedupes on {type, appointmentId} - a fresh enqueue replaces what was already queued for the same action', async () => {
    await enqueueAction({
      type: 'CAPTURE_SERIAL_NUMBER',
      appointmentId: 'appt-1',
      label: 'Fatima Al Sayed (APT-0001)',
      payload: { serialNumber: 'SN-OLD' },
    });
    await enqueueAction({
      type: 'CAPTURE_SERIAL_NUMBER',
      appointmentId: 'appt-1',
      label: 'Fatima Al Sayed (APT-0001)',
      payload: { serialNumber: 'SN-NEW' },
    });

    const items = await loadQueue();
    expect(items).toHaveLength(1);
    expect(items[0].payload).toEqual({ serialNumber: 'SN-NEW' });
  });

  it('does not dedupe across different appointments or different action types', async () => {
    await enqueueAction({ type: 'START_VISIT', appointmentId: 'appt-1', label: 'A', payload: { gpsLat: 1, gpsLng: 1 } });
    await enqueueAction({ type: 'START_VISIT', appointmentId: 'appt-2', label: 'B', payload: { gpsLat: 2, gpsLng: 2 } });
    await enqueueAction({
      type: 'CAPTURE_SERIAL_NUMBER',
      appointmentId: 'appt-1',
      label: 'A',
      payload: { serialNumber: 'SN1' },
    });

    expect(await loadQueue()).toHaveLength(3);
  });
});

describe('processQueue', () => {
  it('replays a pending action, removes it from the queue on success', async () => {
    mockedStartVisit.mockResolvedValue({ id: 'visit-1' });
    await enqueueAction({ type: 'START_VISIT', appointmentId: 'appt-1', label: 'A', payload: { gpsLat: 25.2, gpsLng: 55.3 } });

    const result = await processQueue();

    expect(mockedStartVisit).toHaveBeenCalledWith('appt-1', { gpsLat: 25.2, gpsLng: 55.3 });
    expect(result.synced).toHaveLength(1);
    expect(await loadQueue()).toHaveLength(0);
  });

  it('replays items oldest-first regardless of type', async () => {
    const calls: string[] = [];
    mockedStartVisit.mockImplementation(async () => {
      calls.push('start');
    });
    mockedCaptureSerialNumber.mockImplementation(async () => {
      calls.push('serial');
    });

    // Enqueue serial-number first for a DIFFERENT appointment, then start-visit for
    // another - order must follow clientTimestamp, not action type or insertion index
    // into a type-grouped structure.
    await enqueueAction({ type: 'CAPTURE_SERIAL_NUMBER', appointmentId: 'appt-2', label: 'B', payload: { serialNumber: 'SN1' } });
    await enqueueAction({ type: 'START_VISIT', appointmentId: 'appt-1', label: 'A', payload: { gpsLat: 1, gpsLng: 1 } });

    await processQueue();

    expect(calls).toEqual(['serial', 'start']);
  });

  it('leaves the item pending and stops the run on a network failure, without surfacing an error', async () => {
    mockedStartVisit.mockRejectedValue(networkError());
    await enqueueAction({ type: 'START_VISIT', appointmentId: 'appt-1', label: 'A', payload: { gpsLat: 1, gpsLng: 1 } });

    const result = await processQueue();

    expect(result.synced).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    const items = await loadQueue();
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('pending');
    expect(items[0].errorMessage).toBeNull();
  });

  it('a network failure on one item stops the run - later items are not attempted this pass', async () => {
    mockedStartVisit.mockRejectedValue(networkError());
    mockedCaptureSerialNumber.mockResolvedValue({ id: 'visit-1' });
    await enqueueAction({ type: 'START_VISIT', appointmentId: 'appt-1', label: 'A', payload: { gpsLat: 1, gpsLng: 1 } });
    await enqueueAction({ type: 'CAPTURE_SERIAL_NUMBER', appointmentId: 'appt-2', label: 'B', payload: { serialNumber: 'SN1' } });

    await processQueue();

    expect(mockedCaptureSerialNumber).not.toHaveBeenCalled();
    expect(await loadQueue()).toHaveLength(2);
  });

  it('marks the item failed with the backend message on a real rejection, and continues to the next item', async () => {
    mockedStartVisit.mockRejectedValue(backendError(400, 'Cannot mark on-site: appointment was cancelled'));
    mockedCaptureSerialNumber.mockResolvedValue({ id: 'visit-1' });
    await enqueueAction({ type: 'START_VISIT', appointmentId: 'appt-1', label: 'A', payload: { gpsLat: 1, gpsLng: 1 } });
    await enqueueAction({ type: 'CAPTURE_SERIAL_NUMBER', appointmentId: 'appt-2', label: 'B', payload: { serialNumber: 'SN1' } });

    const result = await processQueue();

    expect(result.failed).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(mockedCaptureSerialNumber).toHaveBeenCalled();

    const items = await loadQueue();
    const failedItem = items.find((item) => item.appointmentId === 'appt-1');
    expect(failedItem?.status).toBe('failed');
    expect(failedItem?.errorMessage).toBe('Cannot mark on-site: appointment was cancelled');
    expect(failedItem?.attempts).toBe(1);
    // The successfully-replayed sibling item is gone.
    expect(items.find((item) => item.appointmentId === 'appt-2')).toBeUndefined();
  });

  it('dispatches CAPTURE_FAULT_SYMPTOM actions to captureFaultSymptom', async () => {
    mockedCaptureFaultSymptom.mockResolvedValue({ id: 'visit-1' });
    await enqueueAction({
      type: 'CAPTURE_FAULT_SYMPTOM',
      appointmentId: 'appt-1',
      label: 'A',
      payload: { faultCode: 'F001', symptomCode: 'S001' },
    });

    await processQueue();

    expect(mockedCaptureFaultSymptom).toHaveBeenCalledWith('appt-1', { faultCode: 'F001', symptomCode: 'S001' });
  });
});

describe('retryAction / removeAction', () => {
  it('retryAction flips a failed item back to pending and clears its error', async () => {
    mockedStartVisit.mockRejectedValue(backendError(400, 'nope'));
    await enqueueAction({ type: 'START_VISIT', appointmentId: 'appt-1', label: 'A', payload: { gpsLat: 1, gpsLng: 1 } });
    await processQueue();
    const [failedItem] = await loadQueue();
    expect(failedItem.status).toBe('failed');

    await retryAction(failedItem.id);

    const [retried] = await loadQueue();
    expect(retried.status).toBe('pending');
    expect(retried.errorMessage).toBeNull();
  });

  it('removeAction discards an item permanently (technician chose Discard)', async () => {
    await enqueueAction({ type: 'START_VISIT', appointmentId: 'appt-1', label: 'A', payload: { gpsLat: 1, gpsLng: 1 } });
    const [{ id }] = await loadQueue();

    await removeAction(id);

    expect(await loadQueue()).toHaveLength(0);
  });
});
