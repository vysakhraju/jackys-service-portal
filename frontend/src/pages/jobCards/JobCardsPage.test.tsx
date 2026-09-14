import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeAppointment, makeJobCard } from '../../test/fixtures';

vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/appointmentsApi', () => ({
  getAppointment: vi.fn(),
  searchAppointments: vi.fn(),
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

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { getAppointment, searchAppointments } from '../../lib/appointmentsApi';
import { getJobCardByAppointment, getTaskPauses } from '../../lib/jobCardsApi';
import { JobCardsPage } from './JobCardsPage';

// 2026-09-14: canWarrantyOverride now gates on the real capability (useMyCapabilities)
// rather than a hardcoded WARRANTY_OVERRIDE_ROLES array - see JobCardsPage.tsx's own
// comment. mockCapabilities replaces the old useAuth role mock for this purpose.
function mockCapabilities(capabilities: string[], fullAccess = false) {
  vi.mocked(useMyCapabilities).mockReturnValue({
    loading: false,
    error: null,
    fullAccess,
    capabilities,
    has: (key: string) => fullAccess || capabilities.includes(key),
    hasAny: (keys: string[]) => fullAccess || keys.some((k) => capabilities.includes(k)),
  });
}

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
  mockCapabilities([]);
  vi.mocked(getAppointment).mockReset();
  vi.mocked(searchAppointments).mockReset();
  vi.mocked(getJobCardByAppointment).mockReset();
  vi.mocked(getTaskPauses).mockReset().mockResolvedValue([]);
});

// #218 pre-mortem follow-up (2026-09-14): the "paste the appointment's id" input is now an
// AsyncSearchPicker backed by a real GET /appointments?q= search (searchAppointments()) -
// narrows on partial input by appointment #, customer name, or phone, same as every other
// #218 picker. It used to wrap an exact-by-number-only lookup (GET /appointments/number/:n),
// which was the one picker in the whole conversion that didn't narrow on partial typing - a
// pre-mortem flagged that inconsistency as likely to read as "the search is broken" to a
// CCE used to every other picker suggesting-as-you-type; this endpoint change is the fix.
describe('JobCardsPage - #218 name-based appointment picker', () => {
  it('finds a matching appointment on partial input and loads its job card', async () => {
    const appointment = makeAppointment({ id: 'appt-55', appointmentNumber: 'APT-0055', customerName: 'Rashid Khan' });
    vi.mocked(searchAppointments).mockResolvedValue([appointment]);
    vi.mocked(getAppointment).mockResolvedValue(appointment);
    vi.mocked(getJobCardByAppointment).mockResolvedValue(makeJobCard({ appointmentId: 'appt-55' }));

    renderPage();

    fireEvent.focus(screen.getByTestId('async-search-picker-input'));
    fireEvent.change(screen.getByTestId('async-search-picker-input'), { target: { value: 'APT-005' } });
    fireEvent.click(await screen.findByText('APT-0055'));

    await waitFor(() => expect(searchAppointments).toHaveBeenCalledWith('APT-005'));
    await waitFor(() => expect(getJobCardByAppointment).toHaveBeenCalledWith('appt-55'));
    expect(await screen.findByText(/Rashid Khan/)).toBeInTheDocument();
  });

  it('shows no matches when the search comes back empty', async () => {
    vi.mocked(searchAppointments).mockResolvedValue([]);

    renderPage();

    fireEvent.focus(screen.getByTestId('async-search-picker-input'));
    fireEvent.change(screen.getByTestId('async-search-picker-input'), { target: { value: 'zzz-no-such-thing' } });

    expect(await screen.findByText('No matches.')).toBeInTheDocument();
  });

  it('shows the search-failed error state (not "No matches.") when the search request itself fails, e.g. a 500', async () => {
    vi.mocked(searchAppointments).mockRejectedValue({ response: { status: 500 } });

    renderPage();

    fireEvent.focus(screen.getByTestId('async-search-picker-input'));
    fireEvent.change(screen.getByTestId('async-search-picker-input'), { target: { value: 'APT-0055' } });

    expect(await screen.findByText('Search failed - try again.')).toBeInTheDocument();
    expect(screen.queryByText('No matches.')).not.toBeInTheDocument();
  });
});

// 2026-09-14: canWarrantyOverride converted from a hardcoded WARRANTY_OVERRIDE_ROLES
// array to the real JOB_CARD_WARRANTY_OVERRIDE capability.
describe('JobCardsPage - Warranty Override capability gate', () => {
  async function loadJobCard() {
    const appointment = makeAppointment({ id: 'appt-55', appointmentNumber: 'APT-0055' });
    vi.mocked(searchAppointments).mockResolvedValue([appointment]);
    vi.mocked(getAppointment).mockResolvedValue(appointment);
    vi.mocked(getJobCardByAppointment).mockResolvedValue(makeJobCard({ appointmentId: 'appt-55' }));

    renderPage();
    fireEvent.focus(screen.getByTestId('async-search-picker-input'));
    fireEvent.change(screen.getByTestId('async-search-picker-input'), { target: { value: 'APT-0055' } });
    fireEvent.click(await screen.findByText('APT-0055'));
    await waitFor(() => expect(getJobCardByAppointment).toHaveBeenCalledWith('appt-55'));
  }

  it('hides the Warranty Override card for a caller with no JOB_CARD_WARRANTY_OVERRIDE capability', async () => {
    mockCapabilities([]);
    await loadJobCard();
    expect(screen.queryByText(/Warranty Override/)).not.toBeInTheDocument();
  });

  it('shows the Warranty Override card for a role granted JOB_CARD_WARRANTY_OVERRIDE via Designation access, not just a default role', async () => {
    // The whole point of this round's fix: a role with no default membership in
    // JOB_CARD_WARRANTY_OVERRIDE sees the card once Super Admin ticks the capability for
    // them - proven here by mocking the capability directly, independent of role name.
    mockCapabilities(['JOB_CARD_WARRANTY_OVERRIDE']);
    await loadJobCard();
    expect(await screen.findByText(/Warranty Override/)).toBeInTheDocument();
  });
});
