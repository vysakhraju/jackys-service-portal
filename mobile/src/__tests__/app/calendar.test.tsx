// Mobile calendar view (2026-09-16) - added alongside the day-grouped list Dashboard
// (index.tsx) per your explicit choice. Covers the welcome header, the month grid's count
// badges (backed by one GET /technician/schedule/month call per visible month), prev/next
// month navigation, tap-to-navigate into day/[date], and the link back to the list view.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { useAuth } from '../../context/AuthContext';
import { getMyMonthSchedule } from '../../lib/technicianApi';
import CalendarScreen from '../../app/calendar';
import type { MonthDayCount } from '../../lib/types';

jest.mock('../../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../lib/technicianApi', () => ({ getMyMonthSchedule: jest.fn() }));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const mockedUseAuth = useAuth as jest.Mock;
const mockedGetMyMonthSchedule = getMyMonthSchedule as jest.Mock;

const FAKE_USER = {
  id: 'user-1',
  firstName: 'Amina',
  lastName: 'Khan',
  email: 'amina@jackys.com',
  role: { name: 'TECHNICIAN_FIELD', displayName: 'Field Technician' },
};

const TODAY = new Date();
const YEAR = TODAY.getFullYear();
const MONTH = TODAY.getMonth() + 1; // 1-12
const TODAY_ISO = `${YEAR}-${String(MONTH).padStart(2, '0')}-${String(TODAY.getDate()).padStart(2, '0')}`;

let activeQueryClient: QueryClient | undefined;

async function renderScreen() {
  activeQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={activeQueryClient}>
      <CalendarScreen />
    </QueryClientProvider>,
  );
}

function stubMonth(counts: MonthDayCount[]) {
  mockedGetMyMonthSchedule.mockResolvedValue(counts);
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

describe('CalendarScreen', () => {
  it('shows a welcome header with the technician\'s name and role', async () => {
    stubMonth([]);
    await renderScreen();

    await waitFor(() => expect(screen.getByText('Welcome, Amina')).toBeOnTheScreen());
    expect(screen.getByText('Amina Khan · Field Technician')).toBeOnTheScreen();
  });

  it('fetches the current month by default', async () => {
    stubMonth([]);
    await renderScreen();

    const expectedKey = `${YEAR}-${String(MONTH).padStart(2, '0')}`;
    await waitFor(() => expect(mockedGetMyMonthSchedule).toHaveBeenCalledWith(expectedKey));
  });

  it('renders a count badge on a day that has active appointments', async () => {
    stubMonth([{ date: TODAY_ISO, count: 3 }]);
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId(`calendar-day-count-${TODAY_ISO}`)).toBeOnTheScreen());
    expect(within(screen.getByTestId(`calendar-day-count-${TODAY_ISO}`)).getByText('3')).toBeOnTheScreen();
  });

  it('renders no count badge on a day with zero active appointments', async () => {
    stubMonth([]);
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId(`calendar-day-${TODAY_ISO}`)).toBeOnTheScreen());
    expect(screen.queryByTestId(`calendar-day-count-${TODAY_ISO}`)).not.toBeOnTheScreen();
  });

  it('tapping a day navigates to that day view', async () => {
    stubMonth([]);
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId(`calendar-day-${TODAY_ISO}`)).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId(`calendar-day-${TODAY_ISO}`));

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/day/[date]', params: { date: TODAY_ISO } });
  });

  it('moves to the next month and refetches when the next-month arrow is pressed', async () => {
    stubMonth([]);
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('calendar-month-label')).toBeOnTheScreen());
    mockedGetMyMonthSchedule.mockClear();

    await fireEvent.press(screen.getByTestId('calendar-next-month'));

    const nextYear = MONTH === 12 ? YEAR + 1 : YEAR;
    const nextMonth = MONTH === 12 ? 1 : MONTH + 1;
    const expectedKey = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
    await waitFor(() => expect(mockedGetMyMonthSchedule).toHaveBeenCalledWith(expectedKey));
  });

  it('moves to the previous month and refetches when the prev-month arrow is pressed', async () => {
    stubMonth([]);
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('calendar-month-label')).toBeOnTheScreen());
    mockedGetMyMonthSchedule.mockClear();

    await fireEvent.press(screen.getByTestId('calendar-prev-month'));

    const prevYear = MONTH === 1 ? YEAR - 1 : YEAR;
    const prevMonth = MONTH === 1 ? 12 : MONTH - 1;
    const expectedKey = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
    await waitFor(() => expect(mockedGetMyMonthSchedule).toHaveBeenCalledWith(expectedKey));
  });

  it('navigates back to the list view when "View list" is pressed', async () => {
    stubMonth([]);
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('open-list-view')).toBeOnTheScreen());

    await fireEvent.press(screen.getByTestId('open-list-view'));

    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('shows an error message without crashing when the month fetch fails', async () => {
    mockedGetMyMonthSchedule.mockRejectedValue(new Error('network down'));
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('calendar-error')).toBeOnTheScreen());
  });

  it('signs out when "Sign out" is pressed', async () => {
    const logout = jest.fn();
    mockedUseAuth.mockReturnValue({ user: FAKE_USER, logout });
    stubMonth([]);
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('logout-button')).toBeOnTheScreen());

    await fireEvent.press(screen.getByTestId('logout-button'));

    expect(logout).toHaveBeenCalled();
  });
});
