import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AppointmentDetailScreen from '../../app/appointment/[id]';
import { useOfflineQueue } from '../../context/OfflineQueueContext';
import { listFaultSymptoms } from '../../lib/masterDataApi';
import { captureFaultSymptom, captureSerialNumber, getVisit, startVisit } from '../../lib/technicianApi';
import type { FaultSymptom, ScheduledAppointment } from '../../lib/types';

const mockBack = jest.fn();
let mockParams: { id: string; appt?: string } = { id: 'appt-1' };

jest.mock('expo-router', () => ({
  router: { back: (...args: unknown[]) => mockBack(...args) },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('../../lib/technicianApi', () => ({
  getVisit: jest.fn(),
  startVisit: jest.fn(),
  captureSerialNumber: jest.fn(),
  captureFaultSymptom: jest.fn(),
}));
jest.mock('../../lib/masterDataApi', () => ({ listFaultSymptoms: jest.fn() }));

// Phase 4: this screen reads useOfflineQueue() directly (to branch Start Visit/S-N/
// Fault-Symptom between "send now" and "enqueue"), so - unlike index.test.tsx, which
// only renders the OfflineBanner - this file needs a controllable mock rather than a
// fixed stub.
jest.mock('../../context/OfflineQueueContext', () => ({ useOfflineQueue: jest.fn() }));

const mockRequestForegroundPermissionsAsync = jest.fn();
const mockGetCurrentPositionAsync = jest.fn();
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: (...args: unknown[]) => mockRequestForegroundPermissionsAsync(...args),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetCurrentPositionAsync(...args),
  Accuracy: { High: 4 },
}));

const mockedGetVisit = getVisit as jest.Mock;
const mockedStartVisit = startVisit as jest.Mock;
const mockedCaptureSerialNumber = captureSerialNumber as jest.Mock;
const mockedCaptureFaultSymptom = captureFaultSymptom as jest.Mock;
const mockedListFaultSymptoms = listFaultSymptoms as jest.Mock;
const mockedUseOfflineQueue = useOfflineQueue as jest.Mock;
const mockEnqueue = jest.fn();

function appt(overrides: Partial<ScheduledAppointment> = {}): ScheduledAppointment {
  return {
    id: 'appt-1',
    appointmentNumber: 'APT-0001',
    status: 'TECHNICIAN_ASSIGNED',
    customerName: 'Fatima Al Sayed',
    customerPhone: '+971500000000',
    customerAddress: 'Villa 12, Al Wasl Road',
    customerCity: 'Dubai',
    brand: 'Samsung',
    modelNumber: 'RT38',
    problemDescription: 'Fridge not cooling',
    scheduledAt: '2026-09-07T10:00:00.000Z',
    estimatedDurationMinutes: 60,
    ...overrides,
  };
}

let activeQueryClient: QueryClient | undefined;

async function renderScreen(appointment: ScheduledAppointment) {
  mockParams = { id: appointment.id, appt: JSON.stringify(appointment) };
  // gcTime: 0 on both namespaces - a *mutation* cache entry (this screen's Start Visit
  // button, unlike anything in Phase 1) schedules its own GC timer separately from
  // queries', under defaultOptions.mutations rather than defaultOptions.queries. Left at
  // its 5-minute default, that timer outlives queryClient.clear()/unmount() below and
  // hangs the Jest process after the test suite otherwise passes cleanly.
  activeQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });
  await render(
    <QueryClientProvider client={activeQueryClient}>
      <AppointmentDetailScreen />
    </QueryClientProvider>,
  );
}

function notFoundError() {
  return { isAxiosError: true, response: { status: 404 } };
}

function visitFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'visit-1',
    appointmentId: 'appt-1',
    technicianId: 'tech-1',
    startGpsLat: 25.2,
    startGpsLng: 55.3,
    startedAt: '2026-09-07T10:05:00.000Z',
    serialNumber: null,
    brand: null,
    warrantyStatus: null,
    warrantySupplier: null,
    warrantyPeriodMonths: null,
    serialNumberCapturedAt: null,
    faultCode: null,
    symptomCode: null,
    faultSymptomCapturedAt: null,
    createdAt: '2026-09-07T10:05:00.000Z',
    updatedAt: '2026-09-07T10:05:00.000Z',
    ...overrides,
  };
}

function faultSymptomFixture(overrides: Partial<FaultSymptom> = {}): FaultSymptom {
  return {
    id: 'fs-1',
    faultCode: 'F001',
    faultDescription: 'Not cooling',
    symptomCode: 'S001',
    symptomDescription: 'No power to unit',
    category: 'REFRIGERATOR',
    requiresWorkshop: false,
    isActive: true,
    ...overrides,
  };
}

function queuedAction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'queue-1',
    type: 'START_VISIT',
    appointmentId: 'appt-1',
    label: 'Fatima Al Sayed (APT-0001)',
    payload: {},
    clientTimestamp: '2026-09-07T10:00:00.000Z',
    status: 'pending',
    errorMessage: null,
    attempts: 0,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEnqueue.mockResolvedValue(undefined);
  mockedUseOfflineQueue.mockReturnValue({
    isOnline: true,
    pendingItems: [],
    failedItems: [],
    enqueue: mockEnqueue,
    retry: jest.fn(),
    dismiss: jest.fn(),
  });
});

afterEach(() => {
  activeQueryClient?.clear();
  activeQueryClient?.unmount();
  activeQueryClient = undefined;
});

describe('AppointmentDetailScreen', () => {
  it('shows appointment details and a Start Visit button when no visit exists yet', async () => {
    mockedGetVisit.mockRejectedValue(notFoundError());
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('start-visit-button')).toBeOnTheScreen());
    expect(screen.getByText('Fatima Al Sayed')).toBeOnTheScreen();
    expect(screen.getByText('Fridge not cooling')).toBeOnTheScreen();
  });

  it('does not offer Start Visit for an appointment that is not yet confirmed/assigned', async () => {
    mockedGetVisit.mockRejectedValue(notFoundError());
    await renderScreen(appt({ status: 'COMPLETED' }));

    await waitFor(() => expect(screen.getByText('Fatima Al Sayed')).toBeOnTheScreen());
    expect(screen.queryByTestId('start-visit-button')).toBeNull();
  });

  it('shows the started state when a visit already exists', async () => {
    mockedGetVisit.mockResolvedValue({
      id: 'visit-1',
      appointmentId: 'appt-1',
      technicianId: 'tech-1',
      startGpsLat: 25.2,
      startGpsLng: 55.3,
      startedAt: '2026-09-07T10:05:00.000Z',
      serialNumber: null,
      brand: null,
      warrantyStatus: null,
      warrantySupplier: null,
      warrantyPeriodMonths: null,
      serialNumberCapturedAt: null,
      faultCode: null,
      symptomCode: null,
      faultSymptomCapturedAt: null,
      createdAt: '2026-09-07T10:05:00.000Z',
      updatedAt: '2026-09-07T10:05:00.000Z',
    });
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('visit-started')).toBeOnTheScreen());
    expect(screen.queryByTestId('start-visit-button')).toBeNull();
  });

  it('blocks Start Visit and shows a message when location permission is denied', async () => {
    mockedGetVisit.mockRejectedValue(notFoundError());
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true, status: 'denied' });
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('start-visit-button')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('start-visit-button'));

    await waitFor(() => expect(screen.getByTestId('location-error')).toBeOnTheScreen());
    expect(mockedStartVisit).not.toHaveBeenCalled();
    // Permission can still be asked again, so no "open Settings" escape hatch is shown.
    expect(screen.queryByTestId('open-settings')).toBeNull();
  });

  it('offers to open Settings when location permission is permanently denied', async () => {
    mockedGetVisit.mockRejectedValue(notFoundError());
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' });
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('start-visit-button')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('start-visit-button'));

    await waitFor(() => expect(screen.getByTestId('open-settings')).toBeOnTheScreen());
  });

  it('starts the visit with the captured GPS coordinates on success', async () => {
    mockedGetVisit.mockRejectedValue(notFoundError());
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
    mockGetCurrentPositionAsync.mockResolvedValue({ coords: { latitude: 25.2048, longitude: 55.2708 } });
    mockedStartVisit.mockResolvedValue({ id: 'visit-1' });
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('start-visit-button')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('start-visit-button'));

    await waitFor(() => expect(mockedStartVisit).toHaveBeenCalledWith('appt-1', { gpsLat: 25.2048, gpsLng: 55.2708 }));
  });

  it('shows the backend error message when starting the visit fails (e.g. not assigned yet)', async () => {
    mockedGetVisit.mockRejectedValue(notFoundError());
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
    mockGetCurrentPositionAsync.mockResolvedValue({ coords: { latitude: 25.2048, longitude: 55.2708 } });
    mockedStartVisit.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { message: 'Can only mark on-site for confirmed/assigned appointments' } },
    });
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('start-visit-button')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('start-visit-button'));

    await waitFor(() =>
      expect(screen.getByTestId('start-visit-error')).toHaveTextContent(
        'Can only mark on-site for confirmed/assigned appointments',
      ),
    );
  });

  it('goes back to the schedule when the back button is pressed', async () => {
    mockedGetVisit.mockRejectedValue(notFoundError());
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('back-button')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('back-button'));

    expect(mockBack).toHaveBeenCalled();
  });

  it('captures a serial number and shows the warranty badge on success', async () => {
    mockedGetVisit.mockResolvedValueOnce(visitFixture());
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('serial-number-input')).toBeOnTheScreen());

    mockedCaptureSerialNumber.mockResolvedValue(
      visitFixture({ serialNumber: 'SN123', warrantyStatus: 'IW', warrantySupplier: 'Samsung Gulf', warrantyPeriodMonths: 12 }),
    );
    mockedGetVisit.mockResolvedValueOnce(
      visitFixture({ serialNumber: 'SN123', warrantyStatus: 'IW', warrantySupplier: 'Samsung Gulf', warrantyPeriodMonths: 12 }),
    );

    await fireEvent.changeText(screen.getByTestId('serial-number-input'), 'SN123');
    await fireEvent.press(screen.getByTestId('capture-serial-number-button'));

    await waitFor(() => expect(mockedCaptureSerialNumber).toHaveBeenCalledWith('appt-1', { serialNumber: 'SN123', brand: 'Samsung' }));
    await waitFor(() => expect(screen.getByTestId('serial-number-captured')).toBeOnTheScreen());
    expect(screen.getByTestId('status-pill-IW')).toBeOnTheScreen();
    expect(screen.getByText('In Warranty')).toBeOnTheScreen();
  });

  it('shows an error message when serial number capture fails', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('serial-number-input')).toBeOnTheScreen());
    mockedCaptureSerialNumber.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { message: 'Serial number can only be captured for an on-site visit' } },
    });

    await fireEvent.changeText(screen.getByTestId('serial-number-input'), 'SN123');
    await fireEvent.press(screen.getByTestId('capture-serial-number-button'));

    await waitFor(() =>
      expect(screen.getByTestId('serial-number-error')).toHaveTextContent(
        'Serial number can only be captured for an on-site visit',
      ),
    );
  });

  it('keeps fault/symptom capture locked until a serial number is captured', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('fault-symptom-locked-hint')).toBeOnTheScreen());
    expect(screen.queryByTestId('open-fault-symptom-picker')).toBeNull();
    expect(mockedListFaultSymptoms).not.toHaveBeenCalled();
  });

  it('opens the fault/symptom picker, filters by search, selects an item, and captures it', async () => {
    mockedGetVisit.mockResolvedValueOnce(visitFixture({ serialNumber: 'SN123', warrantyStatus: 'IW' }));
    mockedListFaultSymptoms.mockResolvedValue([
      faultSymptomFixture(),
      faultSymptomFixture({ id: 'fs-2', faultCode: 'F002', faultDescription: 'Not draining', symptomCode: 'S002', symptomDescription: 'Water pooling' }),
    ]);
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('open-fault-symptom-picker')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('open-fault-symptom-picker'));

    await waitFor(() => expect(screen.getByTestId('fault-symptom-option-fs-1')).toBeOnTheScreen());
    expect(screen.getByTestId('fault-symptom-option-fs-2')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('fault-symptom-search'), 'draining');
    await waitFor(() => expect(screen.queryByTestId('fault-symptom-option-fs-1')).toBeNull());
    expect(screen.getByTestId('fault-symptom-option-fs-2')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('fault-symptom-option-fs-2'));

    await waitFor(() => expect(screen.getByTestId('fault-symptom-selection')).toBeOnTheScreen());
    expect(screen.queryByTestId('fault-symptom-picker-close')).toBeNull();

    mockedCaptureFaultSymptom.mockResolvedValue(visitFixture({ serialNumber: 'SN123', warrantyStatus: 'IW', faultCode: 'F002', symptomCode: 'S002' }));
    mockedGetVisit.mockResolvedValueOnce(visitFixture({ serialNumber: 'SN123', warrantyStatus: 'IW', faultCode: 'F002', symptomCode: 'S002' }));

    await fireEvent.press(screen.getByTestId('capture-fault-symptom-button'));

    await waitFor(() => expect(mockedCaptureFaultSymptom).toHaveBeenCalledWith('appt-1', { faultCode: 'F002', symptomCode: 'S002' }));
    await waitFor(() => expect(screen.getByTestId('fault-symptom-captured')).toHaveTextContent('F002 · S002'));
  });

  it('shows an error message when fault/symptom capture fails', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture({ serialNumber: 'SN123', warrantyStatus: 'IW' }));
    mockedListFaultSymptoms.mockResolvedValue([faultSymptomFixture()]);
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('open-fault-symptom-picker')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('open-fault-symptom-picker'));
    await waitFor(() => expect(screen.getByTestId('fault-symptom-option-fs-1')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('fault-symptom-option-fs-1'));

    mockedCaptureFaultSymptom.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { message: 'Capture and validate the serial number before recording fault/symptom codes' } },
    });

    await waitFor(() => expect(screen.getByTestId('capture-fault-symptom-button')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('capture-fault-symptom-button'));

    await waitFor(() =>
      expect(screen.getByTestId('fault-symptom-error')).toHaveTextContent(
        'Capture and validate the serial number before recording fault/symptom codes',
      ),
    );
  });

  it('shows an error in the picker when the fault/symptom list fails to load', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture({ serialNumber: 'SN123', warrantyStatus: 'IW' }));
    mockedListFaultSymptoms.mockRejectedValue(new Error('network down'));
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('open-fault-symptom-picker')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('open-fault-symptom-picker'));

    await waitFor(() => expect(screen.getByTestId('fault-symptom-list-error')).toBeOnTheScreen());
    expect(screen.queryByTestId('fault-symptom-option-fs-1')).toBeNull();
  });
});

// Phase 4: offline branches for the three write actions this screen owns. Online
// behavior is exercised above and is untouched by Phase 4 - these tests only cover the
// `!isOnline` branch (enqueue instead of mutate) and the queued-item display states.
describe('AppointmentDetailScreen - offline queue', () => {
  function offlineQueueValue(overrides: Record<string, unknown> = {}) {
    return {
      isOnline: false,
      pendingItems: [],
      failedItems: [],
      enqueue: mockEnqueue,
      retry: jest.fn(),
      dismiss: jest.fn(),
      ...overrides,
    };
  }

  it('enqueues Start Visit instead of calling the mutation when offline', async () => {
    mockedGetVisit.mockRejectedValue(notFoundError());
    mockedUseOfflineQueue.mockReturnValue(offlineQueueValue());
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
    mockGetCurrentPositionAsync.mockResolvedValue({ coords: { latitude: 25.2048, longitude: 55.2708 } });
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('start-visit-button')).toBeOnTheScreen());
    expect(screen.getByText(/offline - this will be queued/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('start-visit-button'));

    await waitFor(() =>
      expect(mockEnqueue).toHaveBeenCalledWith({
        type: 'START_VISIT',
        appointmentId: 'appt-1',
        label: 'Fatima Al Sayed (APT-0001)',
        payload: { gpsLat: 25.2048, gpsLng: 55.2708 },
      }),
    );
    expect(mockedStartVisit).not.toHaveBeenCalled();
  });

  it('shows a queued message instead of the Start Visit button when a start-visit item is pending', async () => {
    mockedGetVisit.mockRejectedValue(notFoundError());
    mockedUseOfflineQueue.mockReturnValue(
      offlineQueueValue({ pendingItems: [queuedAction({ type: 'START_VISIT', appointmentId: 'appt-1' })] }),
    );
    await renderScreen(appt());

    await waitFor(() =>
      expect(screen.getByTestId('start-visit-queued')).toHaveTextContent(
        'Queued - will start this visit as soon as you’re back online.',
      ),
    );
    expect(screen.queryByTestId('start-visit-button')).toBeNull();
  });

  it('shows a sync-failed message instead of the Start Visit button when a start-visit item failed', async () => {
    mockedGetVisit.mockRejectedValue(notFoundError());
    mockedUseOfflineQueue.mockReturnValue(
      offlineQueueValue({
        isOnline: true,
        failedItems: [
          queuedAction({ type: 'START_VISIT', appointmentId: 'appt-1', status: 'failed', errorMessage: 'Appointment was cancelled' }),
        ],
      }),
    );
    await renderScreen(appt());

    await waitFor(() =>
      expect(screen.getByTestId('start-visit-queued')).toHaveTextContent(
        'Could not sync starting this visit - see the sync status above to retry or discard.',
      ),
    );
    expect(screen.queryByTestId('start-visit-button')).toBeNull();
  });

  it('enqueues serial number capture instead of calling the mutation when offline', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedUseOfflineQueue.mockReturnValue(offlineQueueValue());
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('serial-number-input')).toBeOnTheScreen());
    await fireEvent.changeText(screen.getByTestId('serial-number-input'), 'SN123');
    await fireEvent.press(screen.getByTestId('capture-serial-number-button'));

    await waitFor(() =>
      expect(mockEnqueue).toHaveBeenCalledWith({
        type: 'CAPTURE_SERIAL_NUMBER',
        appointmentId: 'appt-1',
        label: 'Fatima Al Sayed (APT-0001)',
        payload: { serialNumber: 'SN123', brand: 'Samsung' },
      }),
    );
    expect(mockedCaptureSerialNumber).not.toHaveBeenCalled();
  });

  it('shows a queued message instead of the serial number form when an item is pending', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedUseOfflineQueue.mockReturnValue(
      offlineQueueValue({ pendingItems: [queuedAction({ type: 'CAPTURE_SERIAL_NUMBER', appointmentId: 'appt-1' })] }),
    );
    await renderScreen(appt());

    await waitFor(() =>
      expect(screen.getByTestId('serial-number-queued')).toHaveTextContent('Queued - will sync as soon as you’re back online.'),
    );
    expect(screen.queryByTestId('serial-number-input')).toBeNull();
  });

  it('shows a sync-failed message instead of the serial number form when an item failed', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedUseOfflineQueue.mockReturnValue(
      offlineQueueValue({
        isOnline: true,
        failedItems: [
          queuedAction({ type: 'CAPTURE_SERIAL_NUMBER', appointmentId: 'appt-1', status: 'failed', errorMessage: 'nope' }),
        ],
      }),
    );
    await renderScreen(appt());

    await waitFor(() =>
      expect(screen.getByTestId('serial-number-queued')).toHaveTextContent(
        'Could not sync this serial number - see the sync status above to retry or discard.',
      ),
    );
  });

  it('enqueues fault/symptom capture instead of calling the mutation when offline', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture({ serialNumber: 'SN123', warrantyStatus: 'IW' }));
    mockedListFaultSymptoms.mockResolvedValue([faultSymptomFixture()]);
    mockedUseOfflineQueue.mockReturnValue(offlineQueueValue());
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('open-fault-symptom-picker')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('open-fault-symptom-picker'));
    await waitFor(() => expect(screen.getByTestId('fault-symptom-option-fs-1')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('fault-symptom-option-fs-1'));

    await waitFor(() => expect(screen.getByTestId('capture-fault-symptom-button')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('capture-fault-symptom-button'));

    await waitFor(() =>
      expect(mockEnqueue).toHaveBeenCalledWith({
        type: 'CAPTURE_FAULT_SYMPTOM',
        appointmentId: 'appt-1',
        label: 'Fatima Al Sayed (APT-0001)',
        payload: { faultCode: 'F001', symptomCode: 'S001' },
      }),
    );
    expect(mockedCaptureFaultSymptom).not.toHaveBeenCalled();
  });

  it('shows a queued message instead of the picker/capture button when a fault-symptom item is pending', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture({ serialNumber: 'SN123', warrantyStatus: 'IW' }));
    mockedUseOfflineQueue.mockReturnValue(
      offlineQueueValue({ pendingItems: [queuedAction({ type: 'CAPTURE_FAULT_SYMPTOM', appointmentId: 'appt-1' })] }),
    );
    await renderScreen(appt());

    await waitFor(() =>
      expect(screen.getByTestId('fault-symptom-queued')).toHaveTextContent('Queued - will sync as soon as you’re back online.'),
    );
    expect(screen.queryByTestId('open-fault-symptom-picker')).toBeNull();
  });

  it('shows a sync-failed message instead of the picker/capture button when a fault-symptom item failed', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture({ serialNumber: 'SN123', warrantyStatus: 'IW' }));
    mockedUseOfflineQueue.mockReturnValue(
      offlineQueueValue({
        isOnline: true,
        failedItems: [
          queuedAction({ type: 'CAPTURE_FAULT_SYMPTOM', appointmentId: 'appt-1', status: 'failed', errorMessage: 'nope' }),
        ],
      }),
    );
    await renderScreen(appt());

    await waitFor(() =>
      expect(screen.getByTestId('fault-symptom-queued')).toHaveTextContent(
        'Could not sync this fault/symptom - see the sync status above to retry or discard.',
      ),
    );
  });
});
