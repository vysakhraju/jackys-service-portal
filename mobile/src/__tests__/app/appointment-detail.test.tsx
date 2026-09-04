import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AppointmentDetailScreen from '../../app/appointment/[id]';
import { getVisit, startVisit } from '../../lib/technicianApi';
import type { ScheduledAppointment } from '../../lib/types';

const mockBack = jest.fn();
let mockParams: { id: string; appt?: string } = { id: 'appt-1' };

jest.mock('expo-router', () => ({
  router: { back: (...args: unknown[]) => mockBack(...args) },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('../../lib/technicianApi', () => ({ getVisit: jest.fn(), startVisit: jest.fn() }));

const mockRequestForegroundPermissionsAsync = jest.fn();
const mockGetCurrentPositionAsync = jest.fn();
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: (...args: unknown[]) => mockRequestForegroundPermissionsAsync(...args),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetCurrentPositionAsync(...args),
  Accuracy: { High: 4 },
}));

const mockedGetVisit = getVisit as jest.Mock;
const mockedStartVisit = startVisit as jest.Mock;

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

beforeEach(() => {
  jest.clearAllMocks();
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
});
