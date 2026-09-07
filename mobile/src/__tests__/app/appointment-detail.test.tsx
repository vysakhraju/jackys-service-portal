import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AppointmentDetailScreen from '../../app/appointment/[id]';
import { useOfflineQueue } from '../../context/OfflineQueueContext';
import { listFaultSymptoms, listSpareParts } from '../../lib/masterDataApi';
import {
  captureFaultSymptom,
  captureSerialNumber,
  completeVisit,
  getOwnJobCard,
  getVisit,
  requestNeedSpare,
  startVisit,
} from '../../lib/technicianApi';
import type { FaultSymptom, JobCardSummary, NeedSpareReservation, ScheduledAppointment, SparePart } from '../../lib/types';

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
  getOwnJobCard: jest.fn(),
  requestNeedSpare: jest.fn(),
  completeVisit: jest.fn(),
}));
jest.mock('../../lib/masterDataApi', () => ({ listFaultSymptoms: jest.fn(), listSpareParts: jest.fn() }));

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
const mockedGetOwnJobCard = getOwnJobCard as jest.Mock;
const mockedRequestNeedSpare = requestNeedSpare as jest.Mock;
const mockedCompleteVisit = completeVisit as jest.Mock;
const mockedListFaultSymptoms = listFaultSymptoms as jest.Mock;
const mockedListSpareParts = listSpareParts as jest.Mock;
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

function jobCardFixture(overrides: Partial<JobCardSummary> = {}): JobCardSummary {
  return {
    id: 'job-card-1',
    jobCardNumber: 'JC-0001',
    status: 'SECTION_ASSIGNED',
    section: 'ON_SITE_REPAIR',
    onSiteCompletionNotes: null,
    ...overrides,
  };
}

// 2026-09-07: getOwnJobCard's real response is always this {jobCard, spareRequest}
// wrapper - pass `null` for jobCardOverrides to get the "staff haven't created one yet"
// shape, and spareRequestOverrides to simulate a Need Spare request the server already
// knows about (this is what proves the "forgotten request" fix: the screen must derive
// its state from this, not from anything set only by a prior mutation in this session).
function ownJobCardFixture(
  jobCardOverrides: Partial<JobCardSummary> | null = {},
  spareRequestOverrides: Partial<NeedSpareReservation> | null = null,
): { jobCard: JobCardSummary | null; spareRequest: NeedSpareReservation | null } {
  return {
    jobCard: jobCardOverrides === null ? null : jobCardFixture(jobCardOverrides),
    spareRequest:
      spareRequestOverrides === null
        ? null
        : { id: 'reservation-1', sparePartId: 'part-1', quantityRequested: 1, status: 'PENDING_REVIEW', ...spareRequestOverrides },
  };
}

function sparePartFixture(overrides: Partial<SparePart> = {}): SparePart {
  return {
    id: 'part-1',
    code: 'SP-001',
    name: 'Compressor relay',
    category: 'REFRIGERATOR',
    brand: 'Samsung',
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
  // Sane default for the Job Card poll (Phase 5) so every pre-existing test - none of
  // which know about Job Cards - renders the "waiting for the office" state rather than
  // an unhandled rejection from an un-mocked getOwnJobCard() call.
  mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture(null));
  mockedListSpareParts.mockResolvedValue([]);
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

// Phase 5: Job Card polling + Need Spare + Complete/QC-handoff. Online behavior only -
// the offline branches for these two new write actions are covered in the offline-queue
// describe block below, alongside Phase 4's three.
describe('AppointmentDetailScreen - Need Spare & Complete', () => {
  it('shows a waiting message when no visit exists yet (Job Card query is not even enabled)', async () => {
    mockedGetVisit.mockRejectedValue(notFoundError());
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('start-visit-button')).toBeOnTheScreen());
    expect(screen.queryByTestId('job-card-waiting')).toBeNull();
    expect(mockedGetOwnJobCard).not.toHaveBeenCalled();
  });

  it('shows a waiting message once a visit exists but staff have not created a Job Card yet', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture(null));
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('job-card-waiting')).toBeOnTheScreen());
    expect(screen.queryByTestId('open-spare-part-picker')).toBeNull();
    expect(screen.queryByTestId('complete-visit-button')).toBeNull();
  });

  it('shows a workshop message and no Need Spare/Complete controls when the Job Card was assigned to the workshop instead', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture({ section: 'WORKSHOP' }));
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('job-card-workshop')).toBeOnTheScreen());
    expect(screen.queryByTestId('open-spare-part-picker')).toBeNull();
    expect(screen.queryByTestId('complete-visit-button')).toBeNull();
  });

  it('shows the finished state when the Job Card has already moved past SECTION_ASSIGNED', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture({ status: 'READY_FOR_QC' }));
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('job-card-finished')).toHaveTextContent('JC-0001 sent to QC ✓'));
    expect(screen.queryByTestId('open-spare-part-picker')).toBeNull();
  });

  it('shows Need Spare and Complete controls once the Job Card is assigned to on-site repair', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture());
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('open-spare-part-picker')).toBeOnTheScreen());
    expect(screen.getByTestId('complete-visit-button')).toBeOnTheScreen();
  });

  it('opens the spare part picker, filters by search, selects a part, and requests it', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    // First fetch (on mount): no request yet. Second fetch (after the mutation succeeds
    // and invalidates the Job Card query): the server now knows about the PENDING_REVIEW
    // request just created - this is what the screen's "waiting for review" state below
    // actually reads, not anything set locally by the mutation itself.
    mockedGetOwnJobCard.mockResolvedValueOnce(ownJobCardFixture());
    mockedListSpareParts.mockResolvedValue([
      sparePartFixture(),
      sparePartFixture({ id: 'part-2', code: 'SP-002', name: 'Door gasket', brand: 'LG' }),
    ]);
    mockedRequestNeedSpare.mockResolvedValue({ id: 'reservation-1', sparePartId: 'part-2', quantityRequested: 3, status: 'PENDING_REVIEW' });
    mockedGetOwnJobCard.mockResolvedValueOnce(
      ownJobCardFixture({}, { id: 'reservation-1', sparePartId: 'part-2', quantityRequested: 3 }),
    );
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('open-spare-part-picker')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('open-spare-part-picker'));

    await waitFor(() => expect(screen.getByTestId('spare-part-option-part-1')).toBeOnTheScreen());
    expect(screen.getByTestId('spare-part-option-part-2')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('spare-part-search'), 'gasket');
    await waitFor(() => expect(screen.queryByTestId('spare-part-option-part-1')).toBeNull());

    await fireEvent.press(screen.getByTestId('spare-part-option-part-2'));

    await waitFor(() => expect(screen.getByTestId('spare-part-selection')).toBeOnTheScreen());
    expect(screen.getByText('Door gasket')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('spare-part-quantity-input'), '3');
    await fireEvent.press(screen.getByTestId('request-need-spare-button'));

    await waitFor(() =>
      expect(mockedRequestNeedSpare).toHaveBeenCalledWith(
        'appt-1',
        expect.objectContaining({ sparePartId: 'part-2', quantity: 3, idempotencyKey: expect.stringMatching(/^need-spare-/) }),
      ),
    );
    await waitFor(() => expect(screen.getByTestId('need-spare-requested')).toBeOnTheScreen());
  });

  it('defaults to quantity 1 and treats a non-numeric quantity as 1', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture());
    mockedListSpareParts.mockResolvedValue([sparePartFixture()]);
    mockedRequestNeedSpare.mockResolvedValue({ id: 'reservation-1', status: 'PENDING_REVIEW' });
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('open-spare-part-picker')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('open-spare-part-picker'));
    await waitFor(() => expect(screen.getByTestId('spare-part-option-part-1')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('spare-part-option-part-1'));

    await fireEvent.changeText(screen.getByTestId('spare-part-quantity-input'), 'abc');
    await fireEvent.press(screen.getByTestId('request-need-spare-button'));

    await waitFor(() => expect(mockedRequestNeedSpare).toHaveBeenCalledWith('appt-1', expect.objectContaining({ quantity: 1 })));
  });

  it('shows an error message when the Need Spare request fails', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture());
    mockedListSpareParts.mockResolvedValue([sparePartFixture()]);
    mockedRequestNeedSpare.mockRejectedValue({
      isAxiosError: true,
      response: { status: 404, data: { message: 'Spare part not found' } },
    });
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('open-spare-part-picker')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('open-spare-part-picker'));
    await waitFor(() => expect(screen.getByTestId('spare-part-option-part-1')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('spare-part-option-part-1'));
    await fireEvent.press(screen.getByTestId('request-need-spare-button'));

    await waitFor(() => expect(screen.getByTestId('need-spare-error')).toHaveTextContent('Spare part not found'));
    // A failed request is not a "sent this session" success - the form should still be there to retry.
    expect(screen.getByTestId('open-spare-part-picker')).toBeOnTheScreen();
  });

  it('shows an error in the spare part picker when the spare parts list fails to load', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture());
    mockedListSpareParts.mockRejectedValue(new Error('network down'));
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('open-spare-part-picker')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('open-spare-part-picker'));

    await waitFor(() => expect(screen.getByTestId('spare-part-list-error')).toBeOnTheScreen());
  });

  it('completes the visit with notes and shows the finished state on success', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture());
    mockedCompleteVisit.mockResolvedValue(jobCardFixture({ status: 'READY_FOR_QC' }));
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('complete-visit-button')).toBeOnTheScreen());
    await fireEvent.changeText(screen.getByTestId('completion-notes-input'), 'Replaced compressor relay on-site');
    await fireEvent.press(screen.getByTestId('complete-visit-button'));

    await waitFor(() =>
      expect(mockedCompleteVisit).toHaveBeenCalledWith('appt-1', { notes: 'Replaced compressor relay on-site' }),
    );
    await waitFor(() => expect(screen.getByTestId('job-card-finished')).toBeOnTheScreen());
  });

  it('completes the visit with no notes when the field is left blank', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture());
    mockedCompleteVisit.mockResolvedValue(jobCardFixture({ status: 'READY_FOR_QC' }));
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('complete-visit-button')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('complete-visit-button'));

    await waitFor(() => expect(mockedCompleteVisit).toHaveBeenCalledWith('appt-1', { notes: undefined }));
  });

  it('shows an error message when completing the visit fails', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture());
    mockedCompleteVisit.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { message: 'Job card is not ready for completion' } },
    });
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('complete-visit-button')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('complete-visit-button'));

    await waitFor(() =>
      expect(screen.getByTestId('complete-visit-error')).toHaveTextContent('Job card is not ready for completion'),
    );
    expect(screen.queryByTestId('job-card-finished')).toBeNull();
  });
});

// 2026-09-07 fix: a live-verify run on a real device found that navigating away from this
// screen and back made an already-sent Need Spare request look like it had never been
// sent - `needSpareSentThisSession`/`needSpareMutation.isSuccess` were local React state
// that a screen remount (a fresh mount of this component, exactly what happens navigating
// Schedule -> appointment -> Schedule -> same appointment) always reset to false/idle,
// even though the real PENDING_REVIEW reservation was still sitting on the server. These
// tests render the screen "fresh" (no mutation ever called in this test) with the server
// already reporting a spareRequest, which is the only way to prove the state genuinely
// survives a remount rather than merely surviving within one mutation's lifetime.
describe('AppointmentDetailScreen - Need Spare state survives a remount (server-derived, not local state)', () => {
  it('shows "waiting for review" on a fresh mount when the server already has a PENDING_REVIEW request', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture({}, { status: 'PENDING_REVIEW' }));
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('need-spare-requested')).toBeOnTheScreen());
    // The picker/submit form for a fresh request must not be offered while one is pending.
    expect(screen.queryByTestId('open-spare-part-picker')).toBeNull();
    expect(mockedRequestNeedSpare).not.toHaveBeenCalled();
  });

  it('shows an approved/reserved message on a fresh mount when the server has a HELD request', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture({}, { status: 'HELD' }));
    await renderScreen(appt());

    await waitFor(() =>
      expect(screen.getByTestId('need-spare-approved')).toHaveTextContent('Spare part approved - pick it up from the store.'),
    );
    expect(screen.queryByTestId('open-spare-part-picker')).toBeNull();
  });

  it('shows a partial-reservation message on a fresh mount when the server has a PARTIALLY_RESERVED request', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture({}, { status: 'PARTIALLY_RESERVED' }));
    await renderScreen(appt());

    await waitFor(() =>
      expect(screen.getByTestId('need-spare-approved')).toHaveTextContent(/only part of the quantity was available/),
    );
  });

  it('on a fresh mount with a REJECTED request, shows the rejection note and still offers the form to request again', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture({}, { status: 'REJECTED' }));
    mockedListSpareParts.mockResolvedValue([sparePartFixture()]);
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('need-spare-rejected')).toBeOnTheScreen());
    expect(screen.getByTestId('open-spare-part-picker')).toBeOnTheScreen();

    // And requesting again works exactly like a first-ever request.
    await fireEvent.press(screen.getByTestId('open-spare-part-picker'));
    await waitFor(() => expect(screen.getByTestId('spare-part-option-part-1')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('spare-part-option-part-1'));
    await fireEvent.press(screen.getByTestId('request-need-spare-button'));

    await waitFor(() =>
      expect(mockedRequestNeedSpare).toHaveBeenCalledWith(
        'appt-1',
        expect.objectContaining({ sparePartId: 'part-1', quantity: 1 }),
      ),
    );
  });

  it('offers the request form on a fresh mount when no Need Spare request has ever been made', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture());
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('open-spare-part-picker')).toBeOnTheScreen());
    expect(screen.queryByTestId('need-spare-requested')).toBeNull();
    expect(screen.queryByTestId('need-spare-approved')).toBeNull();
    expect(screen.queryByTestId('need-spare-rejected')).toBeNull();
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

  it('enqueues Need Spare instead of calling the mutation when offline', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture());
    mockedListSpareParts.mockResolvedValue([sparePartFixture()]);
    mockedUseOfflineQueue.mockReturnValue(offlineQueueValue());
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('open-spare-part-picker')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('open-spare-part-picker'));
    await waitFor(() => expect(screen.getByTestId('spare-part-option-part-1')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('spare-part-option-part-1'));
    await fireEvent.press(screen.getByTestId('request-need-spare-button'));

    await waitFor(() =>
      expect(mockEnqueue).toHaveBeenCalledWith({
        type: 'NEED_SPARE',
        appointmentId: 'appt-1',
        label: 'Fatima Al Sayed (APT-0001)',
        payload: expect.objectContaining({ sparePartId: 'part-1', quantity: 1, idempotencyKey: expect.stringMatching(/^need-spare-/) }),
      }),
    );
    expect(mockedRequestNeedSpare).not.toHaveBeenCalled();
    // No local "just requested" flag anymore (that was the bug) - what actually shows a
    // queued state is `queuedNeedSpare` reading OfflineQueueContext's real pendingItems,
    // covered by the dedicated "shows a queued message..." test below. This mock's static
    // pendingItems: [] doesn't reactively pick up the enqueue() call above, so the picker
    // simply remains available here, same as the sibling Start Visit/Serial Number offline
    // tests above.
  });

  it('shows a queued message instead of the picker/submit button when a need-spare item is pending', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture());
    mockedUseOfflineQueue.mockReturnValue(
      offlineQueueValue({ pendingItems: [queuedAction({ type: 'NEED_SPARE', appointmentId: 'appt-1' })] }),
    );
    await renderScreen(appt());

    await waitFor(() =>
      expect(screen.getByTestId('need-spare-queued')).toHaveTextContent(
        'Queued - will send this request as soon as you’re back online.',
      ),
    );
    expect(screen.queryByTestId('open-spare-part-picker')).toBeNull();
  });

  it('shows a sync-failed message instead of the picker/submit button when a need-spare item failed', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture());
    mockedUseOfflineQueue.mockReturnValue(
      offlineQueueValue({
        isOnline: true,
        failedItems: [
          queuedAction({ type: 'NEED_SPARE', appointmentId: 'appt-1', status: 'failed', errorMessage: 'nope' }),
        ],
      }),
    );
    await renderScreen(appt());

    await waitFor(() =>
      expect(screen.getByTestId('need-spare-queued')).toHaveTextContent(
        'Could not sync this spare part request - see the sync status above to retry or discard.',
      ),
    );
  });

  it('enqueues Complete instead of calling the mutation when offline', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture());
    mockedUseOfflineQueue.mockReturnValue(offlineQueueValue());
    await renderScreen(appt());

    await waitFor(() => expect(screen.getByTestId('complete-visit-button')).toBeOnTheScreen());
    await fireEvent.changeText(screen.getByTestId('completion-notes-input'), 'Fixed on-site');
    await fireEvent.press(screen.getByTestId('complete-visit-button'));

    await waitFor(() =>
      expect(mockEnqueue).toHaveBeenCalledWith({
        type: 'COMPLETE_VISIT',
        appointmentId: 'appt-1',
        label: 'Fatima Al Sayed (APT-0001)',
        payload: { notes: 'Fixed on-site' },
      }),
    );
    expect(mockedCompleteVisit).not.toHaveBeenCalled();
  });

  it('shows a queued message instead of the completion form when a complete-visit item is pending', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture());
    mockedUseOfflineQueue.mockReturnValue(
      offlineQueueValue({ pendingItems: [queuedAction({ type: 'COMPLETE_VISIT', appointmentId: 'appt-1' })] }),
    );
    await renderScreen(appt());

    await waitFor(() =>
      expect(screen.getByTestId('complete-visit-queued')).toHaveTextContent(
        'Queued - will complete this visit as soon as you’re back online.',
      ),
    );
    expect(screen.queryByTestId('complete-visit-button')).toBeNull();
  });

  it('shows a sync-failed message instead of the completion form when a complete-visit item failed', async () => {
    mockedGetVisit.mockResolvedValue(visitFixture());
    mockedGetOwnJobCard.mockResolvedValue(ownJobCardFixture());
    mockedUseOfflineQueue.mockReturnValue(
      offlineQueueValue({
        isOnline: true,
        failedItems: [
          queuedAction({ type: 'COMPLETE_VISIT', appointmentId: 'appt-1', status: 'failed', errorMessage: 'nope' }),
        ],
      }),
    );
    await renderScreen(appt());

    await waitFor(() =>
      expect(screen.getByTestId('complete-visit-queued')).toHaveTextContent(
        'Could not sync completing this visit - see the sync status above to retry or discard.',
      ),
    );
  });
});
