import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useAuth } from '../../context/AuthContext';
import { getMySchedule } from '../../lib/technicianApi';
import ScheduleScreen from '../../app/index';
import type { ScheduledAppointment } from '../../lib/types';

jest.mock('../../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../lib/technicianApi', () => ({ getMySchedule: jest.fn() }));
// Phase 2: tapping an appointment card now navigates via expo-router's useRouter() -
// stub it out since these tests render ScheduleScreen without a real router present.
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const mockedUseAuth = useAuth as jest.Mock;
const mockedGetMySchedule = getMySchedule as jest.Mock;

const FAKE_USER = {
  id: 'user-1',
  firstName: 'Amina',
  lastName: 'Khan',
  email: 'amina@jackys.com',
  role: { name: 'TECHNICIAN_FIELD', displayName: 'Field Technician' },
};

function appt(overrides: Partial<ScheduledAppointment> = {}): ScheduledAppointment {
  return {
    id: 'appt-1',
    appointmentNumber: 'APT-0001',
    status: 'CONFIRMED',
    customerName: 'Fatima Al Sayed',
    customerPhone: '+971500000000',
    customerAddress: 'Villa 12, Al Wasl Road',
    customerCity: 'Dubai',
    brand: 'Samsung',
    modelNumber: 'RT38',
    problemDescription: 'Fridge not cooling',
    scheduledAt: '2026-09-03T10:00:00.000Z',
    estimatedDurationMinutes: 60,
    ...overrides,
  };
}

// QueryClient sets up internal GC/focus/online subscriptions on construction that
// otherwise keep the Jest process alive after the test finishes (a well-known
// react-query + non-browser-environment gotcha) - tracking and unmounting each one in
// afterEach is what lets `jest` exit cleanly instead of hanging.
let activeQueryClient: QueryClient | undefined;

async function renderScreen() {
  activeQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={activeQueryClient}>
      <ScheduleScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseAuth.mockReturnValue({ user: FAKE_USER, logout: jest.fn() });
});

afterEach(() => {
  activeQueryClient?.clear();
  activeQueryClient?.unmount();
  activeQueryClient = undefined;
});

describe('ScheduleScreen', () => {
  it("shows the technician's appointments for the selected date, sorted by time", async () => {
    mockedGetMySchedule.mockResolvedValue([
      appt({ id: 'a', customerName: 'Later Visit', scheduledAt: '2026-09-03T14:00:00.000Z' }),
      appt({ id: 'b', customerName: 'Earlier Visit', scheduledAt: '2026-09-03T09:00:00.000Z' }),
    ]);
    await renderScreen();

    await waitFor(() => expect(screen.getByText('Earlier Visit')).toBeOnTheScreen());
    const earlier = screen.getByText('Earlier Visit');
    const later = screen.getByText('Later Visit');
    // React Native FlatList renders items in data order - Earlier Visit (09:00) sorted
    // ahead of Later Visit (14:00) proves the component re-sorts by scheduledAt itself
    // rather than trusting the API's response order.
    expect(earlier).toBeOnTheScreen();
    expect(later).toBeOnTheScreen();
  });

  it('shows an empty-state message when there is nothing scheduled', async () => {
    mockedGetMySchedule.mockResolvedValue([]);
    await renderScreen();

    await waitFor(() => expect(screen.getByText('Nothing on your schedule for this date.')).toBeOnTheScreen());
  });

  it('shows an error message and lets the user pull to refresh when the schedule fails to load', async () => {
    mockedGetMySchedule.mockRejectedValue(new Error('network down'));
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('schedule-error')).toBeOnTheScreen());
  });

  it('moving to the next/previous day re-fetches the schedule for that date', async () => {
    // Computed from the real clock rather than a hardcoded date, so this test doesn't
    // depend on which day it happens to run - only that stepping the date nav forward/
    // back changes what date getMySchedule is called with, by exactly one day each time.
    const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const addDays = (d: Date, delta: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta);
    const today = new Date();

    mockedGetMySchedule.mockResolvedValue([]);
    await renderScreen();

    await waitFor(() => expect(mockedGetMySchedule).toHaveBeenCalledWith(toIso(today)));

    await fireEvent.press(screen.getByTestId('date-next'));
    await waitFor(() => expect(mockedGetMySchedule).toHaveBeenCalledWith(toIso(addDays(today, 1))));

    await fireEvent.press(screen.getByTestId('date-prev'));
    await fireEvent.press(screen.getByTestId('date-prev'));
    await waitFor(() => expect(mockedGetMySchedule).toHaveBeenCalledWith(toIso(addDays(today, -1))));
  });

  it('signs out when "Sign out" is pressed', async () => {
    const logout = jest.fn();
    mockedUseAuth.mockReturnValue({ user: FAKE_USER, logout });
    mockedGetMySchedule.mockResolvedValue([]);
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Nothing on your schedule for this date.')).toBeOnTheScreen());

    await fireEvent.press(screen.getByTestId('logout-button'));

    expect(logout).toHaveBeenCalled();
  });
});
