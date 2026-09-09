import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeAppointment, makeAppointmentDashboardStats } from '../../test/fixtures';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/appointmentsApi', () => ({
  assignTechnician: vi.fn(),
  cancelAppointment: vi.fn(),
  completeAppointment: vi.fn(),
  confirmAppointment: vi.fn(),
  createAppointment: vi.fn(),
  deleteAppointment: vi.fn(),
  getAppointmentDashboardStats: vi.fn(),
  getSchedulingGrid: vi.fn(),
  getVisit: vi.fn(),
  listAppointments: vi.fn(),
  markAppointmentOnSite: vi.fn(),
  resolveMapLink: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
import { createAppointment, getAppointmentDashboardStats, getSchedulingGrid, listAppointments, resolveMapLink } from '../../lib/appointmentsApi';
import { SchedulePage } from './SchedulePage';

// One technician, one hour, all free - just enough for fillRequiredCreateFields() below to
// tap a real chip. Individual tests override this via getSchedulingGrid.mockResolvedValueOnce
// when they care about the grid's own behavior (see SchedulingGrid.test.tsx for that).
function schedulingGridFixture() {
  return {
    date: '2026-09-09',
    isOpen: true,
    startTime: '08:00',
    endTime: '09:00',
    breakStart: null,
    breakEnd: null,
    rosterLabel: 'Mon-Sat 08:00-09:00',
    technicians: [
      {
        id: 'tech-1',
        name: 'Ravi Kumar',
        appointmentCount: 0,
        atDailyCap: false,
        slots: [
          { time: '08:00', iso: '2026-09-09T08:00:00.000Z', available: true },
          { time: '08:15', iso: '2026-09-09T08:15:00.000Z', available: true },
          { time: '08:30', iso: '2026-09-09T08:30:00.000Z', available: true },
          { time: '08:45', iso: '2026-09-09T08:45:00.000Z', available: true },
        ],
      },
    ],
  };
}

// This page (unlike Finance/AMC) has no layout-level role gate at all - every logged-in
// user reaches it. Only the dashboard-stats widget it now renders is itself role-gated
// (DashboardStatsWidget checks canViewDashboardStats client-side), so most of this file's
// existing tests don't care who's logged in - default to a role that CAN see it so the
// widget's own query resolves quietly in the background rather than sitting disabled.
function mockUser(roleName = 'SUPER_ADMIN') {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'u1', firstName: 'T', lastName: 'U', email: 't@jackys.com', employeeId: 'E1', status: 'ACTIVE', lastLoginAt: null, role: { id: 'r1', name: roleName, displayName: roleName } },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
  } as any);
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listAppointments).mockReset();
  vi.mocked(getAppointmentDashboardStats).mockReset().mockResolvedValue(makeAppointmentDashboardStats());
  vi.mocked(createAppointment).mockReset();
  vi.mocked(resolveMapLink).mockReset();
  vi.mocked(getSchedulingGrid).mockReset().mockResolvedValue(schedulingGridFixture());
  mockUser();
});

// The page's filter row and the create modal's form are BOTH mounted at once once the
// modal is open (Modal renders as an overlay, it doesn't unmount what's behind it) - and
// both have their own "Channel" field, so every query below is scoped to the <form> via
// `within()` rather than the page-wide `screen`, to avoid an ambiguous multi-match.
async function openCreateModal() {
  vi.mocked(listAppointments).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
  const { container } = renderPage();
  await screen.findByText('No appointments match these filters yet.');
  fireEvent.click(screen.getByRole('button', { name: '+ New Appointment' }));
  await screen.findByRole('heading', { name: 'New Appointment' });
  return within(container.querySelector('form')!);
}

// { exact: false } throughout: Field renders the label text plus, for any field that also
// has a `hint`, an extra hint <span> INSIDE the same <label> - so the label's full computed
// text for e.g. "Customer phone" (which has a hint) is actually "Customer phonee.g.
// +971501234567" once concatenated, not the bare string. Substring matching sidesteps that
// without needing to track which fields happen to carry a hint today.
// Picking a technician + time is now one tap on the scheduling grid (2026-09-09), not a
// separate "Scheduled at" input - fill in the service centre id first (the grid query is
// disabled until one is set), then wait for the grid to load and tap its first chip.
async function fillRequiredCreateFields(form: ReturnType<typeof within>) {
  fireEvent.change(form.getByLabelText('Customer name', { exact: false }), { target: { value: 'Jane Doe' } });
  fireEvent.change(form.getByLabelText('Customer phone', { exact: false }), { target: { value: '+971500000000' } });
  fireEvent.change(form.getByLabelText('Service centre id', { exact: false }), { target: { value: 'sc-1' } });
  fireEvent.click(await form.findByTestId('chip-tech-1-08:00'));
}

// Regression test for the-fool's most severe Frontend Phase 10 finding: an AMC-type,
// ON_SITE appointment used to show the same generic "Complete" button as everything else,
// which calls PUT /appointments/:id/complete and silently loses the visit's checklist/
// signature/extra-charge documentation forever (AmcService.completeVisit() refuses to run
// once status is already COMPLETED). The row action must instead be a link into the AMC
// module's own completion flow, and only for AMC rows - a non-AMC ON_SITE row must be
// completely unaffected.
describe('SchedulePage - AMC PM visit completion routing', () => {
  it('shows "Complete PM Visit ->" (not the generic Complete button) for an AMC-type ON_SITE row, linking to its contract', async () => {
    vi.mocked(listAppointments).mockResolvedValue({
      data: [
        makeAppointment({
          id: 'appt-amc-1',
          appointmentNumber: 'APT-0099',
          type: 'AMC',
          status: 'ON_SITE',
          amcContractId: 'contract-42',
        }),
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();

    await screen.findByText('APT-0099');

    const amcLink = screen.getByRole('link', { name: /Complete PM Visit/ });
    expect(amcLink).toHaveAttribute('href', '/amc/contracts?contractId=contract-42');
    expect(screen.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument();
  });

  it('still shows the generic Complete button for a non-AMC ON_SITE row, unaffected by the AMC routing', async () => {
    vi.mocked(listAppointments).mockResolvedValue({
      data: [
        makeAppointment({
          id: 'appt-oow-1',
          appointmentNumber: 'APT-0050',
          type: 'OUT_OF_WARRANTY',
          status: 'ON_SITE',
          amcContractId: null,
        }),
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();

    await screen.findByText('APT-0050');

    expect(screen.getByRole('button', { name: 'Complete' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Complete PM Visit/ })).not.toBeInTheDocument();
  });
});

// 2026-09-08: once a Job Card exists for an appointment, AppointmentsService.cancel() now
// 409s - this mirrors that guard client-side so the row doesn't even offer a Cancel button
// the backend would just reject (same pattern as the AMC-routing block above).
describe('SchedulePage - appointment cancellation guard (Job Card already exists)', () => {
  it('hides the Cancel action once a Job Card exists for the appointment', async () => {
    vi.mocked(listAppointments).mockResolvedValue({
      data: [
        makeAppointment({
          id: 'appt-has-jc',
          appointmentNumber: 'APT-0200',
          status: 'TECHNICIAN_ASSIGNED',
          jobCard: { id: 'jc-1', jobCardNumber: 'JC-0001' },
        }),
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();

    await screen.findByText('APT-0200');
    const row = screen.getByText('APT-0200').closest('tr')!;
    expect(within(row).queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('still shows the Cancel action for a non-terminal appointment with no Job Card yet', async () => {
    vi.mocked(listAppointments).mockResolvedValue({
      data: [
        makeAppointment({
          id: 'appt-no-jc',
          appointmentNumber: 'APT-0201',
          status: 'CONFIRMED',
          jobCard: null,
        }),
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();

    await screen.findByText('APT-0201');
    const row = screen.getByText('APT-0201').closest('tr')!;
    expect(within(row).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});

// Service Desk channel gap from REDTRA360_REVIEW.md - this list IS the "dedicated list
// view" the review calls for, so channel needs to show up as both a column and a filter
// here, and the create form needs to actually submit it (defaulting to PHONE rather than
// leaving it unset, since the whole point is that every appointment carries one).
describe('SchedulePage - Service Desk channel', () => {
  it('shows the channel on each row and lets it be filtered', async () => {
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-wa-1', appointmentNumber: 'APT-0077', channel: 'WHATSAPP' })],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();

    await screen.findByText('APT-0077');
    const row = screen.getByText('APT-0077').closest('tr')!;
    expect(within(row).getByText('WHATSAPP')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Channel', { exact: false }), { target: { value: 'DEALER' } });

    await waitFor(() => {
      expect(vi.mocked(listAppointments)).toHaveBeenLastCalledWith(
        expect.objectContaining({ channel: 'DEALER' }),
      );
    });
  });

  it('submits the selected channel (defaulting to PHONE) when creating an appointment', async () => {
    vi.mocked(createAppointment).mockResolvedValue(makeAppointment());
    const form = await openCreateModal();
    await fillRequiredCreateFields(form);

    // Default should already be PHONE without the user touching the field.
    expect(form.getByLabelText('Channel', { exact: false })).toHaveValue('PHONE');

    fireEvent.change(form.getByLabelText('Channel', { exact: false }), { target: { value: 'WALK_IN' } });
    fireEvent.click(form.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(vi.mocked(createAppointment)).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'WALK_IN' }),
      );
    });
  });
});

// The user's own idea from the REDTRA360 review call: paste a Google Maps short link
// instead of typing lat/lng by hand.
describe('SchedulePage - Google Maps link resolve', () => {
  it('resolves a pasted link and fills in the latitude/longitude fields, then submits them', async () => {
    vi.mocked(resolveMapLink).mockResolvedValue({ lat: 25.2048493, lng: 55.2707828 });
    vi.mocked(createAppointment).mockResolvedValue(makeAppointment());
    const form = await openCreateModal();
    await fillRequiredCreateFields(form);

    fireEvent.change(form.getByPlaceholderText('https://maps.app.goo.gl/…'), {
      target: { value: 'https://maps.app.goo.gl/AbCdEf' },
    });
    fireEvent.click(form.getByRole('button', { name: 'Resolve' }));

    await form.findByText('Resolved: 25.2048493, 55.2707828');
    expect(vi.mocked(resolveMapLink)).toHaveBeenCalledWith('https://maps.app.goo.gl/AbCdEf');
    expect(form.getByLabelText(/Latitude/)).toHaveValue(25.2048493);
    expect(form.getByLabelText(/Longitude/)).toHaveValue(55.2707828);

    fireEvent.click(form.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(vi.mocked(createAppointment)).toHaveBeenCalledWith(
        expect.objectContaining({ customerLat: 25.2048493, customerLng: 55.2707828 }),
      );
    });
  });

  it('shows an inline error and leaves the coordinate fields untouched when the link cannot be resolved', async () => {
    vi.mocked(resolveMapLink).mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: 'That does not look like a Google Maps link.' } },
    });
    const form = await openCreateModal();

    fireEvent.change(form.getByPlaceholderText('https://maps.app.goo.gl/…'), {
      target: { value: 'https://evil.example.com' },
    });
    fireEvent.click(form.getByRole('button', { name: 'Resolve' }));

    await form.findByText('That does not look like a Google Maps link.');
    expect(form.getByLabelText(/Latitude/)).toHaveValue(null);
    expect(form.getByLabelText(/Longitude/)).toHaveValue(null);
    expect(form.queryByText(/^Resolved:/)).not.toBeInTheDocument();
  });

  it('lets latitude/longitude be typed in by hand without ever resolving a link', async () => {
    vi.mocked(createAppointment).mockResolvedValue(makeAppointment());
    const form = await openCreateModal();
    await fillRequiredCreateFields(form);

    fireEvent.change(form.getByLabelText(/Latitude/), { target: { value: '25.1' } });
    fireEvent.change(form.getByLabelText(/Longitude/), { target: { value: '55.2' } });
    fireEvent.click(form.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(vi.mocked(createAppointment)).toHaveBeenCalledWith(
        expect.objectContaining({ customerLat: 25.1, customerLng: 55.2 }),
      );
    });
    expect(vi.mocked(resolveMapLink)).not.toHaveBeenCalled();
  });
});
