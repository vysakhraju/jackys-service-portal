// Mobile Phase 3: the new multi-day Dashboard - replaces the old single-day
// ScheduleScreen tests (that screen's own content/tests moved to day/[date].tsx +
// day-detail.test.tsx). Covers the 4-day window fetch, per-day sections (including
// "Overdue" only appearing when yesterday has something left on it), section-header
// navigation to day/[date], appointment-card navigation to appointment/[id], and the
// urgency color-coding pill.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useAuth } from '../../context/AuthContext';
import { getMySchedule } from '../../lib/technicianApi';
import DashboardScreen from '../../app/index';
import type { ScheduledAppointment } from '../../lib/types';

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta);
}

const TODAY = new Date();
const YESTERDAY_ISO = toIso(addDays(TODAY, -1));
const TODAY_ISO = toIso(TODAY);
const TOMORROW_ISO = toIso(addDays(TODAY, 1));
const DAY_AFTER_ISO = toIso(addDays(TODAY, 2));

jest.mock('../../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../lib/technicianApi', () => ({ getMySchedule: jest.fn() }));
jest.mock('../../context/OfflineQueueContext', () => ({
  useOfflineQueue: () => ({ isOnline: true, pendingItems: [], failedItems: [], enqueue: jest.fn(), retry: jest.fn(), dismiss: jest.fn() }),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

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
    scheduledAt: new Date().toISOString(),
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
      <DashboardScreen />
    </QueryClientProvider>,
  );
}

// Routes getMySchedule(date) to whichever fixture map the test supplies, defaulting to
// an empty list for any date not explicitly stubbed - keeps each test's setup focused on
// only the day(s) it actually cares about.
function stubSchedule(byDate: Partial<Record<string, ScheduledAppointment[]>>) {
  mockedGetMySchedule.mockImplementation((date: string) => Promise.resolve(byDate[date] ?? []));
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

describe('DashboardScreen', () => {
  it('fetches all 4 days in the window (yesterday, today, tomorrow, day+2)', async () => {
    stubSchedule({});
    await renderScreen();

    await waitFor(() => expect(mockedGetMySchedule).toHaveBeenCalledWith(YESTERDAY_ISO));
    expect(mockedGetMySchedule).toHaveBeenCalledWith(TODAY_ISO);
    expect(mockedGetMySchedule).toHaveBeenCalledWith(TOMORROW_ISO);
    expect(mockedGetMySchedule).toHaveBeenCalledWith(DAY_AFTER_ISO);
  });

  it('hides the Overdue section entirely when yesterday has nothing left pending', async () => {
    stubSchedule({});
    await renderScreen();

    // Every section shows "Loading…" until its own query settles (including Overdue's,
    // which only decides whether to render itself at all once loaded) - wait for all 4 to
    // finish before asserting Overdue never rendered, so this doesn't race the load.
    await waitFor(() => expect(screen.queryAllByText('Loading…')).toHaveLength(0));
    expect(screen.queryByText('Overdue')).not.toBeOnTheScreen();
  });

  it('shows the Overdue section when yesterday still has an active appointment', async () => {
    stubSchedule({ [YESTERDAY_ISO]: [appt({ id: 'overdue-1', customerName: 'Left Over Visit' })] });
    await renderScreen();

    await waitFor(() => expect(screen.getByText('Left Over Visit')).toBeOnTheScreen());
    expect(screen.getByText('Overdue')).toBeOnTheScreen();
  });

  it('always shows Today, Tomorrow, and the day-after-tomorrow sections even when empty', async () => {
    stubSchedule({});
    await renderScreen();

    await waitFor(() => expect(screen.getByText('Today')).toBeOnTheScreen());
    expect(screen.getByText('Tomorrow')).toBeOnTheScreen();
  });

  it('tapping a day section header navigates to that day view', async () => {
    stubSchedule({});
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId(`day-section-header-${TODAY_ISO}`)).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId(`day-section-header-${TODAY_ISO}`));

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/day/[date]', params: { date: TODAY_ISO } });
  });

  it('tapping an appointment card navigates straight to the appointment detail screen', async () => {
    const appointment = appt({ id: 'appt-today', customerName: 'Direct Tap Customer' });
    stubSchedule({ [TODAY_ISO]: [appointment] });
    await renderScreen();

    await waitFor(() => expect(screen.getByText('Direct Tap Customer')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('appointment-appt-today'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/appointment/[id]',
      params: { id: 'appt-today', appt: JSON.stringify(appointment) },
    });
  });

  it('color-codes an appointment green when scheduled under 24 hours ago', async () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
    stubSchedule({ [YESTERDAY_ISO]: [appt({ id: 'green-1', scheduledAt: fiveHoursAgo })] });
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('urgency-green-1-green')).toBeOnTheScreen());
  });

  it('color-codes an appointment amber between 24 and 72 hours old', async () => {
    const thirtyHoursAgo = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
    stubSchedule({ [YESTERDAY_ISO]: [appt({ id: 'amber-1', scheduledAt: thirtyHoursAgo })] });
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('urgency-amber-1-amber')).toBeOnTheScreen());
  });

  it('color-codes an appointment red at 72+ hours old', async () => {
    const oneHundredHoursAgo = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
    stubSchedule({ [YESTERDAY_ISO]: [appt({ id: 'red-1', scheduledAt: oneHundredHoursAgo })] });
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('urgency-red-1-red')).toBeOnTheScreen());
  });

  it('shows a per-section error message without breaking the rest of the dashboard', async () => {
    mockedGetMySchedule.mockImplementation((date: string) =>
      date === TODAY_ISO ? Promise.reject(new Error('network down')) : Promise.resolve([]),
    );
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId(`day-section-error-${TODAY_ISO}`)).toBeOnTheScreen());
    expect(screen.getByText('Tomorrow')).toBeOnTheScreen();
  });

  it('signs out when "Sign out" is pressed', async () => {
    const logout = jest.fn();
    mockedUseAuth.mockReturnValue({ user: FAKE_USER, logout });
    stubSchedule({});
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Today')).toBeOnTheScreen());

    await fireEvent.press(screen.getByTestId('logout-button'));

    expect(logout).toHaveBeenCalled();
  });

  it('navigates to the calendar view when "Calendar view" is pressed', async () => {
    stubSchedule({});
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Today')).toBeOnTheScreen());

    await fireEvent.press(screen.getByTestId('open-calendar-view'));

    expect(mockPush).toHaveBeenCalledWith('/calendar');
  });
});
