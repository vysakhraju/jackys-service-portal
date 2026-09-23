// Mobile Phase 3: this is the single-day schedule screen extracted verbatim out of what
// used to be the whole of index.tsx (see day/[date].tsx's own doc comment) - this test
// file is index.test.tsx's content, carried over unchanged except for how the date is
// seeded (previously always "today" from the real clock; now from the route param,
// which these tests set to "today" themselves so every existing assertion still holds).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useAuth } from '../../context/AuthContext';
import { getMySchedule } from '../../lib/technicianApi';
import DayScreen from '../../app/day/[date]';
import type { ScheduledAppointment } from '../../lib/types';

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// jest.mock's factory can't close over an ordinary module-scope const (hoisting rule),
// but a `mock`-prefixed name is allowed - so this is named for that, not by convention.
const mockTodayIso = toIso(new Date());

jest.mock('../../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../lib/technicianApi', () => ({ getMySchedule: jest.fn() }));
// Phase 3: this screen now reads the date from the route param instead of always
// defaulting to `new Date()` - seeded to "today" here so every test below behaves
// exactly like the old single-day screen's own default did.
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => ({ date: mockTodayIso }),
}));
jest.mock('../../context/OfflineQueueContext', () => ({
  useOfflineQueue: () => ({ isOnline: true, pendingItems: [], failedItems: [], enqueue: jest.fn(), retry: jest.fn(), dismiss: jest.fn() }),
}));

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
    jobType: 'REPAIR',
    ...overrides,
  };
}

let activeQueryClient: QueryClient | undefined;

async function renderScreen() {
  activeQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={activeQueryClient}>
      <DayScreen />
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

describe('DayScreen', () => {
  it("shows the technician's appointments for the selected date, sorted by time", async () => {
    mockedGetMySchedule.mockResolvedValue([
      appt({ id: 'a', customerName: 'Later Visit', scheduledAt: '2026-09-03T14:00:00.000Z' }),
      appt({ id: 'b', customerName: 'Earlier Visit', scheduledAt: '2026-09-03T09:00:00.000Z' }),
    ]);
    await renderScreen();

    await waitFor(() => expect(screen.getByText('Earlier Visit')).toBeOnTheScreen());
    const earlier = screen.getByText('Earlier Visit');
    const later = screen.getByText('Later Visit');
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
