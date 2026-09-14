import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeAppointment, makeJobCard } from '../../test/fixtures';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/appointmentsApi', () => ({
  getAppointment: vi.fn(),
  getAppointmentByNumber: vi.fn(),
}));
vi.mock('../../lib/jobCardsApi', () => ({
  approveCustomer: vi.fn(),
  assignSection: vi.fn(),
  cancelJobCard: vi.fn(),
  createJobCard: vi.fn(),
  getJobCardByAppointment: vi.fn(),
  getTaskPauses: vi.fn(),
  pauseTask: vi.fn(),
  resumeTask: vi.fn(),
  validateSn: vi.fn(),
  warrantyOverride: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
import { getAppointment, getAppointmentByNumber } from '../../lib/appointmentsApi';
import { getJobCardByAppointment, getTaskPauses } from '../../lib/jobCardsApi';
import { JobCardsPage } from './JobCardsPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/job-cards']}>
        <JobCardsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      id: 'user-1',
      firstName: 'Test',
      lastName: 'User',
      email: 't@example.com',
      employeeId: 'E1',
      status: 'ACTIVE',
      lastLoginAt: null,
      role: { id: 'r1', name: 'CCE', displayName: 'CCE' },
    },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
  } as any);
  vi.mocked(getAppointment).mockReset();
  vi.mocked(getAppointmentByNumber).mockReset();
  vi.mocked(getJobCardByAppointment).mockReset();
  vi.mocked(getTaskPauses).mockReset().mockResolvedValue([]);
});

// #218/#251: the "paste the appointment's id" input is now an AsyncSearchPicker adapted
// over GET /appointments/number/:appointmentNumber (there is no free-text search endpoint
// for appointments, so this is an exact by-number lookup shaped like a search).
describe('JobCardsPage - #218 name-based appointment picker', () => {
  it('finds an appointment by number and loads its job card', async () => {
    const appointment = makeAppointment({ id: 'appt-55', appointmentNumber: 'APT-0055', customerName: 'Rashid Khan' });
    vi.mocked(getAppointmentByNumber).mockResolvedValue(appointment);
    vi.mocked(getAppointment).mockResolvedValue(appointment);
    vi.mocked(getJobCardByAppointment).mockResolvedValue(makeJobCard({ appointmentId: 'appt-55' }));

    renderPage();

    fireEvent.focus(screen.getByTestId('async-search-picker-input'));
    fireEvent.change(screen.getByTestId('async-search-picker-input'), { target: { value: 'APT-0055' } });
    fireEvent.click(await screen.findByText('APT-0055'));

    await waitFor(() => expect(getAppointmentByNumber).toHaveBeenCalledWith('APT-0055'));
    await waitFor(() => expect(getJobCardByAppointment).toHaveBeenCalledWith('appt-55'));
    expect(await screen.findByText(/Rashid Khan/)).toBeInTheDocument();
  });

  it('shows no matches for an appointment number that does not exist (404 treated as empty, not an error)', async () => {
    const notFoundError = { response: { status: 404 } };
    vi.mocked(getAppointmentByNumber).mockRejectedValue(notFoundError);

    renderPage();

    fireEvent.focus(screen.getByTestId('async-search-picker-input'));
    fireEvent.change(screen.getByTestId('async-search-picker-input'), { target: { value: 'APT-9999' } });

    expect(await screen.findByText('No matches.')).toBeInTheDocument();
  });
});
