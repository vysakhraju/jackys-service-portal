import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeAppointment, makeAppointmentDashboardStats } from '../../test/fixtures';

vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
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
  markAppointmentCollectedToWorkshop: vi.fn(),
  markAppointmentOnSite: vi.fn(),
  resolveMapLink: vi.fn(),
  searchAppointments: vi.fn(),
  updateAppointment: vi.fn(),
}));
// #218: Service centre/Technician filter+form fields are now NamePickers backed by these.
// Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 2): cities/appliance models added
// for the New Appointment popup's City and Brand+Model pickers.
// Master-Data/New-Appointment billing modification Phase 2 (2026-09-22) - the New
// Appointment popup's dynamic mandatory-field check reads this.
// Phase 5 (2026-09-22) - the New Appointment popup's Billing Channel picker
// (useBillingChannelOptions) also goes through listBillingChannels.
vi.mock('../../lib/masterDataApi', () => ({
  listServiceCentres: vi.fn(),
  listCities: vi.fn(),
  listApplianceModels: vi.fn(),
  listAppointmentFieldConfigs: vi.fn(),
  listBillingChannels: vi.fn(),
}));
// req.txt Issue F "+ Create Job" pill (widened 2026-09-21) - now backed by the same
// eligible-appointments endpoint JobCardsPage's picker already calls, instead of
// effectiveStatus alone.
vi.mock('../../lib/jobCardsApi', () => ({
  getBlockedAppointmentsForJobCard: vi.fn(),
  getEligibleAppointmentsForJobCard: vi.fn(),
}));
vi.mock('../../lib/technicianScheduleApi', () => ({
  getGanttBoard: vi.fn(),
}));
// Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 4) - WorkshopIntakeModal (rendered
// by this page for a COLLECTED_TO_WS row's "Mark Received" action) goes through these.
vi.mock('../../lib/workshopIntakeApi', () => ({
  getWorkshopIntake: vi.fn(),
  markWorkshopReceived: vi.fn(),
  captureWorkshopSerialNumber: vi.fn(),
  captureWorkshopFaultSymptom: vi.fn(),
}));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import {
  assignTechnician,
  createAppointment,
  getAppointmentDashboardStats,
  getSchedulingGrid,
  getVisit,
  listAppointments,
  markAppointmentCollectedToWorkshop,
  resolveMapLink,
  searchAppointments,
  updateAppointment,
} from '../../lib/appointmentsApi';
import { listApplianceModels, listAppointmentFieldConfigs, listBillingChannels, listCities, listServiceCentres } from '../../lib/masterDataApi';
import { getBlockedAppointmentsForJobCard, getEligibleAppointmentsForJobCard } from '../../lib/jobCardsApi';
import { getGanttBoard } from '../../lib/technicianScheduleApi';
import { getWorkshopIntake } from '../../lib/workshopIntakeApi';
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
// user reaches it. Individual row actions and the dashboard-stats widget are each gated on
// their own real capability (SCHEDULE_CCE_MANAGE/SCHEDULE_VIEW_UPDATE/
// SCHEDULE_ASSIGN_TECHNICIAN/SCHEDULE_FIELD_VISIT, converted 2026-09-14, Group B) rather than
// a hardcoded role list - most of this file's existing tests don't care about capability
// gating specifically, so default to full access so every action renders and the widget's
// own query resolves quietly in the background rather than sitting disabled.
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
  vi.mocked(getVisit).mockReset().mockRejectedValue({ response: { status: 404 } });
  vi.mocked(updateAppointment).mockReset();
  vi.mocked(markAppointmentCollectedToWorkshop).mockReset();
  vi.mocked(searchAppointments).mockReset().mockResolvedValue([]);
  vi.mocked(getSchedulingGrid).mockReset().mockResolvedValue(schedulingGridFixture());
  vi.mocked(listServiceCentres).mockReset().mockResolvedValue([{ id: 'sc-1', name: 'Dubai Service Centre' }] as any);
  vi.mocked(listCities).mockReset().mockResolvedValue([{ id: 'city-1', name: 'Dubai' }] as any);
  vi.mocked(listApplianceModels).mockReset().mockResolvedValue([{ id: 'model-1', brand: 'Samsung', model: 'WA80J5710' }] as any);
  // Phase 5 (2026-09-22) - the New Appointment popup's Billing Channel picker.
  vi.mocked(listBillingChannels).mockReset().mockResolvedValue([{ id: 'bc-1', name: 'Corporate Interdepartment', isActive: true, defaultRate: 450 }] as any);
  // Master-Data/New-Appointment billing modification Phase 2 (2026-09-22) - empty by
  // default so every pre-existing test (written before this table existed) keeps passing
  // unchanged; the dedicated describe block below overrides this per-test.
  vi.mocked(listAppointmentFieldConfigs).mockReset().mockResolvedValue([]);
  vi.mocked(getEligibleAppointmentsForJobCard).mockReset().mockResolvedValue([]);
  vi.mocked(getBlockedAppointmentsForJobCard).mockReset().mockResolvedValue([]);
  vi.mocked(getGanttBoard).mockReset().mockResolvedValue({
    date: '2026-09-09',
    rows: [],
    unassignedAppointments: [],
    unassignedJobCards: [],
  } as any);
  vi.mocked(getWorkshopIntake).mockReset().mockResolvedValue(null);
  mockCapabilities([], true);
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
  // Phase 2 (2026-09-16) added two more NamePickers (City, Brand/Model) ahead of Service
  // centre in the form - scoped by label so this helper doesn't care about DOM order.
  // Exact match (not { exact: false }) here: the Country field's own hint text ("...VAT
  // stays Service Centre-driven") contains the substring "Service centre" too, so a
  // substring match against this particular label would resolve to two elements.
  fireEvent.focus(form.getByLabelText('Service centre'));
  fireEvent.click(await form.findByText('Dubai Service Centre'));
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

// Live-tested bug fix (2026-09-14): invoiceNumber used to be settable only on the CREATE
// form - once an appointment existed without one, there was no way to add it later, which
// permanently blocked Job Card creation (FR-05). This is the fix: an inline Add/Edit control
// on the View detail modal.
describe('SchedulePage - invoice number can be added after the appointment already exists', () => {
  it('lets the invoice number be added from the View modal when it is missing, and shows the saved value afterward', async () => {
    vi.mocked(listAppointments).mockResolvedValue({
      data: [
        makeAppointment({
          id: 'appt-no-invoice',
          appointmentNumber: 'APT-0300',
          status: 'COMPLETED',
          invoiceNumber: null,
        }),
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    vi.mocked(updateAppointment).mockResolvedValue(
      makeAppointment({ id: 'appt-no-invoice', appointmentNumber: 'APT-0300', invoiceNumber: 'INV-2026-00123' }),
    );
    renderPage();

    await screen.findByText('APT-0300');
    fireEvent.click(within(screen.getByText('APT-0300').closest('tr')!).getByRole('button', { name: 'View' }));

    await screen.findByRole('heading', { name: /APT-0300/ });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. INV-2026-00123'), { target: { value: 'INV-2026-00123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateAppointment).toHaveBeenCalledWith('appt-no-invoice', { invoiceNumber: 'INV-2026-00123' }),
    );
    await screen.findByText('INV-2026-00123');
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
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

    // Default should already be PHONE without the user touching the field. Anchored regex
    // (not a plain substring match) - "Channel" alone would also match the unrelated
    // "Billing Channel (optional)" label added by Phase 5 below.
    expect(form.getByLabelText(/^Channel/)).toHaveValue('PHONE');

    fireEvent.change(form.getByLabelText(/^Channel/), { target: { value: 'WALK_IN' } });
    fireEvent.click(form.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(vi.mocked(createAppointment)).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'WALK_IN' }),
      );
    });
  });
});

// #218 QA follow-up: serviceCentreId is now driven by NamePicker via setValue()/watch()
// rather than a native <input {...register()}>, wired through a bare register() call for
// its `required` validation (see the page's own comment above the NamePicker). Nothing
// upstream of this test suite exercised the negative path - confirm it actually blocks.
describe('SchedulePage - create form required-field guard (no service centre picked)', () => {
  it('keeps the Create button disabled and never calls createAppointment when no service centre/slot has been picked', async () => {
    const form = await openCreateModal();

    fireEvent.change(form.getByLabelText('Customer name', { exact: false }), { target: { value: 'Jane Doe' } });
    fireEvent.change(form.getByLabelText('Customer phone', { exact: false }), { target: { value: '+971500000000' } });

    expect(form.getByRole('button', { name: 'Create' })).toBeDisabled();

    fireEvent.click(form.getByRole('button', { name: 'Create' }));

    expect(vi.mocked(createAppointment)).not.toHaveBeenCalled();
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

// Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 2, req. 1) - Job Type, City,
// Country, and the Appliance Model picker replacing the old free-text brand/model inputs.
describe('SchedulePage - Phase 2 New Appointment popup fields', () => {
  it('defaults Job type to REPAIR and Country to UAE, and submits a picked City/Appliance Model by id', async () => {
    vi.mocked(createAppointment).mockResolvedValue(makeAppointment());
    const form = await openCreateModal();
    await fillRequiredCreateFields(form);

    expect(form.getByLabelText('Job type', { exact: false })).toHaveValue('REPAIR');
    expect(form.getByLabelText('Country', { exact: false })).toHaveValue('UAE');

    fireEvent.change(form.getByLabelText('Job type', { exact: false }), { target: { value: 'INSTALLATION' } });

    // Label-scoped (not positional) - City/Appliance Model/Service centre are all
    // NamePickers on this form, so a getAllByTestId index is fragile to reordering.
    fireEvent.focus(form.getByLabelText('City (optional)', { exact: false }));
    fireEvent.click(await form.findByText('Dubai'));

    fireEvent.focus(form.getByLabelText('Brand / Model (optional)', { exact: false }));
    fireEvent.click(await form.findByText('Samsung — WA80J5710'));

    fireEvent.click(form.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(vi.mocked(createAppointment)).toHaveBeenCalledWith(
        expect.objectContaining({ jobType: 'INSTALLATION', cityId: 'city-1', applianceModelId: 'model-1' }),
      );
    });
  });

  // Phase 5 (2026-09-22) - the New Appointment popup's "Billing Channel" dropdown, the
  // gap the original request's point #4 asked for but Phases 1-4 never actually built.
  it('submits a picked Billing Channel by id', async () => {
    vi.mocked(createAppointment).mockResolvedValue(makeAppointment());
    const form = await openCreateModal();
    await fillRequiredCreateFields(form);

    fireEvent.focus(form.getByLabelText('Billing Channel (optional)', { exact: false }));
    fireEvent.click(await form.findByText('Corporate Interdepartment'));

    fireEvent.click(form.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(vi.mocked(createAppointment)).toHaveBeenCalledWith(
        expect.objectContaining({ billingChannelId: 'bc-1' }),
      );
    });
  });

  it('leaves billingChannelId undefined when no Billing Channel is picked', async () => {
    vi.mocked(createAppointment).mockResolvedValue(makeAppointment());
    const form = await openCreateModal();
    await fillRequiredCreateFields(form);

    fireEvent.click(form.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(vi.mocked(createAppointment)).toHaveBeenCalledWith(
        expect.objectContaining({ billingChannelId: undefined }),
      );
    });
  });

  it('lets Country be changed to KSA and submits it, purely informational (not sent as any VAT field)', async () => {
    vi.mocked(createAppointment).mockResolvedValue(makeAppointment());
    const form = await openCreateModal();
    await fillRequiredCreateFields(form);

    fireEvent.change(form.getByLabelText('Country', { exact: false }), { target: { value: 'KSA' } });
    fireEvent.click(form.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(vi.mocked(createAppointment)).toHaveBeenCalledWith(expect.objectContaining({ country: 'KSA' }));
    });
  });

  // req. 1b - reuses GET /appointments?q= (searchAppointments) rather than a new endpoint.
  it('customer lookup autofills name/phone/city/model/serial from a picked past appointment', async () => {
    vi.mocked(searchAppointments).mockResolvedValue([
      makeAppointment({
        id: 'past-1',
        appointmentNumber: 'APT-0009',
        customerName: 'Ahmed Khan',
        customerPhone: '+971509998888',
        cityId: 'city-1',
        applianceModelId: 'model-1',
        serialNumber: 'SN-OLD-1',
        jobCard: null,
      }),
    ]);
    const form = await openCreateModal();

    fireEvent.change(form.getByPlaceholderText('Start typing a name, phone, or serial number…'), {
      target: { value: 'Ahmed' },
    });
    fireEvent.click(await form.findByText('Ahmed Khan'));

    await waitFor(() => {
      expect(form.getByLabelText('Customer name', { exact: false })).toHaveValue('Ahmed Khan');
    });
    expect(form.getByLabelText('Customer phone', { exact: false })).toHaveValue('+971509998888');
    expect(form.getByLabelText('Serial number', { exact: false })).toHaveValue('SN-OLD-1');
    expect(form.getByText(/Filled in from APT-0009/)).toBeInTheDocument();
  });

  it('does not show the customer-lookup search box when editing an existing appointment', async () => {
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-1', appointmentNumber: 'APT-0010', status: 'SCHEDULED' })],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();
    await screen.findByText('APT-0010');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const heading = await screen.findByRole('heading', { name: /Edit — APT-0010/ });
    const modal = within(heading.closest('.max-w-lg') as HTMLElement);

    expect(modal.queryByPlaceholderText('Start typing a name, phone, or serial number…')).not.toBeInTheDocument();
  });
});

// #218: the Service centre/Technician filters and the Assign Technician modal are now
// name-based NamePickers instead of raw-uuid text inputs.
describe('SchedulePage - #218 name-based pickers', () => {
  it('filters by service centre name (not a pasted uuid), and the filter drives the real query param', async () => {
    vi.mocked(listAppointments).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    renderPage();
    await screen.findByText('No appointments match these filters yet.');

    // Service centre is the first of the two filter-bar NamePickers (Service centre,
    // then Technician).
    fireEvent.focus(screen.getAllByTestId('name-picker-input')[0]);
    fireEvent.click(await screen.findByText('Dubai Service Centre'));

    await waitFor(() => {
      expect(vi.mocked(listAppointments)).toHaveBeenLastCalledWith(
        expect.objectContaining({ serviceCentreId: 'sc-1' }),
      );
    });
  });

});

// Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 2, req. 2b) - Assign is gone as a
// standalone row action/modal; (re)assigning a technician now happens from inside the same
// Edit popup used for field edits, via its own scheduling grid - optional here, unlike
// Create where a slot is mandatory.
describe('SchedulePage - Edit popup (reassignment folded in, req. 2b)', () => {
  it('has no standalone Assign row action any more', async () => {
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-1', appointmentNumber: 'APT-0001', status: 'SCHEDULED' })],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();
    await screen.findByText('APT-0001');

    expect(screen.queryByRole('button', { name: 'Assign' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('opens pre-filled from the row and saves a plain field edit without touching the technician/time when no new slot is picked', async () => {
    vi.mocked(updateAppointment).mockResolvedValue(makeAppointment({ id: 'appt-1', problemDescription: 'Updated description' }));
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-1', appointmentNumber: 'APT-0001', status: 'TECHNICIAN_ASSIGNED', customerName: 'Jane Doe' })],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();
    await screen.findByText('APT-0001');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const heading = await screen.findByRole('heading', { name: /Edit — APT-0001/ });
    const modal = within(heading.closest('.max-w-lg') as HTMLElement);
    expect(modal.getByLabelText('Customer name', { exact: false })).toHaveValue('Jane Doe');

    fireEvent.change(modal.getByLabelText('Problem description', { exact: false }), { target: { value: 'Updated description' } });
    fireEvent.click(modal.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(vi.mocked(updateAppointment)).toHaveBeenCalledWith(
        'appt-1',
        expect.objectContaining({ problemDescription: 'Updated description' }),
      ),
    );
    expect(vi.mocked(assignTechnician)).not.toHaveBeenCalled();
  });

  it('reassigns via a newly-picked grid slot as a second call, awaited after the field update', async () => {
    vi.mocked(updateAppointment).mockResolvedValue(makeAppointment({ id: 'appt-1' }));
    vi.mocked(assignTechnician).mockResolvedValue(makeAppointment({ id: 'appt-1' }));
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-1', appointmentNumber: 'APT-0001', status: 'TECHNICIAN_ASSIGNED', serviceCentreId: 'sc-1' })],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();
    await screen.findByText('APT-0001');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const heading = await screen.findByRole('heading', { name: /Edit — APT-0001/ });
    const modal = within(heading.closest('.max-w-lg') as HTMLElement);

    fireEvent.click(await modal.findByTestId('chip-tech-1-08:00'));
    fireEvent.click(modal.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(vi.mocked(assignTechnician)).toHaveBeenCalledWith('appt-1', 'tech-1', '2026-09-09T08:00:00.000Z'),
    );
    expect(vi.mocked(updateAppointment)).toHaveBeenCalled();
  });
});

// 2026-09-14 (Group B): Assign/Confirm/Mark on-site/Complete/Cancel/+ New Appointment used
// to render for every logged-in user regardless of role, only 403ing on click - each now
// also requires the specific backend capability that guards its action
// (AppointmentsController: assign-technician -> SCHEDULE_ASSIGN_TECHNICIAN, confirm/cancel/
// create -> SCHEDULE_CCE_MANAGE, on-site/complete -> SCHEDULE_FIELD_VISIT).
describe('SchedulePage - Group B capability gating', () => {
  it('hides every row action and + New Appointment for a caller with no schedule capabilities, even though appointment status would otherwise allow them', async () => {
    mockCapabilities([]);
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-1', appointmentNumber: 'APT-0001', status: 'SCHEDULED', jobCard: null })],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();
    await screen.findByText('APT-0001');

    expect(screen.queryByRole('button', { name: '+ New Appointment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark on-site' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark collected to WS' })).not.toBeInTheDocument();
  });

  // Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 2, req. 2b) - Edit is now gated
  // on SCHEDULE_VIEW_UPDATE (the same capability the invoice-number Add/Edit control
  // already used), independent of SCHEDULE_CCE_MANAGE (Confirm/Cancel) - a role could hold
  // either, both, or neither.
  it('shows only Edit (not Confirm/Cancel/+ New Appointment) for a caller holding just SCHEDULE_VIEW_UPDATE', async () => {
    mockCapabilities(['SCHEDULE_VIEW_UPDATE']);
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-1', appointmentNumber: 'APT-0001', status: 'SCHEDULED', jobCard: null })],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();
    await screen.findByText('APT-0001');

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ New Appointment' })).not.toBeInTheDocument();
  });

  it('shows Confirm, Cancel, and + New Appointment (not Edit) for a caller holding just SCHEDULE_CCE_MANAGE - the whole point being this is independent of role name, e.g. a role granted it only via Designation access', async () => {
    mockCapabilities(['SCHEDULE_CCE_MANAGE']);
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-1', appointmentNumber: 'APT-0001', status: 'SCHEDULED', jobCard: null })],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();
    await screen.findByText('APT-0001');

    expect(screen.getByRole('button', { name: '+ New Appointment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  // Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 2, decision #2) - Edit is only
  // ever offered pre-visit (SCHEDULED/CONFIRMED/TECHNICIAN_ASSIGNED); once real field work
  // has started the row becomes read-only via View, even for a caller who otherwise has
  // SCHEDULE_VIEW_UPDATE.
  it('hides Edit for an ON_SITE row even with SCHEDULE_VIEW_UPDATE - editable window is pre-visit only', async () => {
    mockCapabilities(['SCHEDULE_VIEW_UPDATE']);
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-onsite', appointmentNumber: 'APT-0006', status: 'ON_SITE' })],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();
    await screen.findByText('APT-0006');

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  // Same SCHEDULE_FIELD_VISIT capability markOnSite already used - Mark collected to WS is
  // the new peer action (decision #2/#3), not a separately-gated one.
  it('shows Mark collected to WS for a TECHNICIAN_ASSIGNED row once SCHEDULE_FIELD_VISIT is granted, and calls the endpoint on click', async () => {
    mockCapabilities(['SCHEDULE_FIELD_VISIT']);
    vi.mocked(markAppointmentCollectedToWorkshop).mockResolvedValue(makeAppointment({ status: 'COLLECTED_TO_WS' }));
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-collect', appointmentNumber: 'APT-0007', status: 'TECHNICIAN_ASSIGNED' })],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();
    await screen.findByText('APT-0007');

    fireEvent.click(screen.getByRole('button', { name: 'Mark collected to WS' }));

    await waitFor(() => expect(vi.mocked(markAppointmentCollectedToWorkshop)).toHaveBeenCalledWith('appt-collect'));
  });

  it('hides Complete for an ON_SITE row without SCHEDULE_FIELD_VISIT', async () => {
    mockCapabilities([]);
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-onsite', appointmentNumber: 'APT-0005', status: 'ON_SITE', type: 'OUT_OF_WARRANTY' })],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();
    await screen.findByText('APT-0005');
    expect(screen.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument();
  });

  it('shows Complete for an ON_SITE row once SCHEDULE_FIELD_VISIT is granted', async () => {
    mockCapabilities(['SCHEDULE_FIELD_VISIT']);
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-onsite', appointmentNumber: 'APT-0005', status: 'ON_SITE', type: 'OUT_OF_WARRANTY' })],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Complete' })).toBeInTheDocument();
  });

  it('hides the dashboard-stats widget and the invoice number Add control without SCHEDULE_VIEW_UPDATE', async () => {
    mockCapabilities([]);
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-no-invoice', appointmentNumber: 'APT-0300', status: 'COMPLETED', invoiceNumber: null })],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();
    await screen.findByText('APT-0300');
    expect(screen.queryByText('Today at a glance')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByText('APT-0300').closest('tr')!).getByRole('button', { name: 'View' }));
    await screen.findByRole('heading', { name: /APT-0300/ });
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
  });

  it('shows the dashboard-stats widget and the invoice number Add control once SCHEDULE_VIEW_UPDATE is granted', async () => {
    mockCapabilities(['SCHEDULE_VIEW_UPDATE']);
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-no-invoice', appointmentNumber: 'APT-0300', status: 'COMPLETED', invoiceNumber: null })],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();
    await screen.findByText('Today at a glance');
    fireEvent.click(within(screen.getByText('APT-0300').closest('tr')!).getByRole('button', { name: 'View' }));
    await screen.findByRole('heading', { name: /APT-0300/ });
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });
});

// Appointment/Mobile/Job Card overhaul (2026-09-16 Phase 4, req. 3e/3.4) - live-tested bug
// fix: a COLLECTED_TO_WS appointment used to have no way forward at all from this page (no
// row action, and its View modal's "Technician visit" box just 404'd and said "No visit
// started for this appointment yet" - a real visit never happens for a collected unit). See
// WorkshopIntakeModal.test.tsx for the intake screen's own step-by-step behavior; these
// tests cover only this page's wiring into it.
describe('SchedulePage - Mark Received (Phase 4 workshop intake)', () => {
  it('hides Mark Received for a COLLECTED_TO_WS row without WORKSHOP_INTAKE_SN_VALIDATE', async () => {
    mockCapabilities([]);
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-ws', appointmentNumber: 'APT-0008', status: 'COLLECTED_TO_WS' })],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();
    await screen.findByText('APT-0008');
    expect(screen.queryByRole('button', { name: 'Mark Received →' })).not.toBeInTheDocument();
  });

  it('shows Mark Received for a COLLECTED_TO_WS row once WORKSHOP_INTAKE_SN_VALIDATE is granted, and opens the verify-details popup', async () => {
    mockCapabilities(['WORKSHOP_INTAKE_SN_VALIDATE']);
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-ws', appointmentNumber: 'APT-0008', status: 'COLLECTED_TO_WS' })],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();
    await screen.findByText('APT-0008');

    fireEvent.click(screen.getByRole('button', { name: 'Mark Received →' }));

    await screen.findByRole('heading', { name: /Verify before workshop intake — APT-0008/ });
    expect(screen.getByRole('button', { name: 'Save & continue to intake' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip — details are correct' })).toBeInTheDocument();
  });

  it('Skip routes straight to the workshop intake screen without calling updateAppointment', async () => {
    mockCapabilities(['WORKSHOP_INTAKE_SN_VALIDATE']);
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-ws', appointmentNumber: 'APT-0008', status: 'COLLECTED_TO_WS' })],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();
    await screen.findByText('APT-0008');
    fireEvent.click(screen.getByRole('button', { name: 'Mark Received →' }));
    await screen.findByRole('button', { name: 'Skip — details are correct' });

    fireEvent.click(screen.getByRole('button', { name: 'Skip — details are correct' }));

    await screen.findByRole('heading', { name: /Workshop intake — APT-0008/ });
    expect(vi.mocked(updateAppointment)).not.toHaveBeenCalled();
  });

  it('saving the verify-details popup updates the appointment, then opens the workshop intake screen', async () => {
    mockCapabilities(['WORKSHOP_INTAKE_SN_VALIDATE']);
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-ws', appointmentNumber: 'APT-0008', status: 'COLLECTED_TO_WS' })],
      total: 1,
      page: 1,
      limit: 20,
    });
    vi.mocked(updateAppointment).mockResolvedValue(makeAppointment({ id: 'appt-ws', status: 'COLLECTED_TO_WS' }));
    renderPage();
    await screen.findByText('APT-0008');
    fireEvent.click(screen.getByRole('button', { name: 'Mark Received →' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Save & continue to intake' }));

    await waitFor(() => expect(vi.mocked(updateAppointment)).toHaveBeenCalledWith('appt-ws', expect.anything()));
    await screen.findByRole('heading', { name: /Workshop intake — APT-0008/ });
  });

  it('the View modal shows a Workshop intake box (not the misleading "No visit started") for a COLLECTED_TO_WS row, with its own Mark Received button', async () => {
    mockCapabilities(['WORKSHOP_INTAKE_SN_VALIDATE']);
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-ws', appointmentNumber: 'APT-0008', status: 'COLLECTED_TO_WS' })],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();
    await screen.findByText('APT-0008');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    const heading = await screen.findByRole('heading', { name: /APT-0008/ });
    const modal = heading.closest('[role="dialog"]')!;
    expect(within(modal).getByText('Workshop intake')).toBeInTheDocument();
    expect(within(modal).queryByText('No visit started for this appointment yet.')).not.toBeInTheDocument();
    expect(getVisit).not.toHaveBeenCalled();
    fireEvent.click(within(modal).getByRole('button', { name: 'Mark Received →' }));
    await screen.findByRole('heading', { name: /Verify before workshop intake — APT-0008/ });
  });
});

// req.txt (2026-09-17) Issues A/B/C/D - "Today at a Glance" counters, the newly-created/
// sub-status list visibility gap, and click-to-filter interactivity.
describe('SchedulePage - req.txt fixes: dashboard-stats recount, sub-status filter, click-to-filter', () => {
  it('Issue A: a successful mutation (Confirm) recounts "Today at a Glance", not just the appointment list', async () => {
    mockCapabilities([], true);
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-1', appointmentNumber: 'APT-0001', status: 'SCHEDULED' })],
      total: 1,
      page: 1,
      limit: 20,
    });
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(makeAppointmentDashboardStats());
    renderPage();
    await screen.findByText('APT-0001');
    await waitFor(() => expect(getAppointmentDashboardStats).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    // invalidateQueries on ['appointment-dashboard-stats'] re-triggers the widget's own
    // query, same as invalidating ['appointments'] already re-triggers the list - both
    // funnel through the one shared invalidate().
    await waitFor(() => expect(getAppointmentDashboardStats).toHaveBeenCalledTimes(2));
  });

  it('Issue B: the Status dropdown lists Marked Received and Pending Job Creation alongside the real statuses', async () => {
    mockCapabilities([], true);
    vi.mocked(listAppointments).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    renderPage();
    await waitFor(() => expect(listAppointments).toHaveBeenCalled());

    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toContain('Marked Received');
    expect(optionLabels).toContain('Pending Job Creation');
  });

  it('Issue B/C: the Status column shows the resolved sub-stage, not a generic "Collected to WS", for a row the backend marked effectiveStatus on', async () => {
    mockCapabilities([], true);
    vi.mocked(listAppointments).mockResolvedValue({
      data: [
        makeAppointment({
          id: 'appt-ws',
          appointmentNumber: 'APT-0009',
          status: 'COLLECTED_TO_WS',
          effectiveStatus: 'PENDING_JOB_CREATION',
        }),
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();

    const row = (await screen.findByText('APT-0009')).closest('tr')!;
    expect(within(row).getByText('PENDING JOB CREATION')).toBeInTheDocument();
    expect(within(row).queryByText('COLLECTED TO WS')).not.toBeInTheDocument();
  });

  it('Issue D: clicking a glance tile sets the Status filter, updates the URL, and refetches the list with that status', async () => {
    mockCapabilities([], true);
    vi.mocked(listAppointments).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(makeAppointmentDashboardStats());
    renderPage();
    await screen.findByText('Completed');

    fireEvent.click(screen.getByText('Completed'));

    await waitFor(() =>
      expect(vi.mocked(listAppointments)).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'COMPLETED' }),
      ),
    );
    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    expect(select.value).toBe('COMPLETED');
  });

  it('Issue D: clicking the same glance tile again clears the filter back to "All"', async () => {
    mockCapabilities([], true);
    vi.mocked(listAppointments).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(makeAppointmentDashboardStats());
    renderPage();
    await screen.findByText('Completed');

    fireEvent.click(screen.getByText('Completed'));
    await waitFor(() =>
      expect(vi.mocked(listAppointments)).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'COMPLETED' })),
    );

    fireEvent.click(screen.getByText('Completed'));

    await waitFor(() =>
      expect(vi.mocked(listAppointments)).toHaveBeenLastCalledWith(expect.objectContaining({ status: undefined })),
    );
    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    expect(select.value).toBe('');
  });

  it('Issue D: picking a status from the dropdown also drives the glance widget\'s active tile and the "Clear filter" chip', async () => {
    mockCapabilities([], true);
    vi.mocked(listAppointments).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    vi.mocked(getAppointmentDashboardStats).mockResolvedValue(makeAppointmentDashboardStats());
    renderPage();
    await screen.findByText('Completed');

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'CANCELLED' } });

    await waitFor(() =>
      expect(vi.mocked(listAppointments)).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'CANCELLED' })),
    );
    expect(await screen.findByText(/Clear filter/)).toBeInTheDocument();
  });
});

// req.txt Issue E - Previous/Today/Next Day quick-nav buttons next to the From/To date
// pickers; each sets BOTH dates to the same computed day and re-runs the query (same
// setPage(1)+setFilters pattern every other filter control already uses).
describe('SchedulePage - req.txt Issue E: date quick-nav buttons', () => {
  beforeEach(() => {
    // Only Date is faked (not setTimeout/setInterval) - React Query's internals and RTL's
    // own waitFor/findBy* polling both rely on real timers, and faking those too just hangs
    // every async assertion below until the 5s test timeout.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-17T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('"Today" sets both From and To to today\'s date and refetches with it', async () => {
    vi.mocked(listAppointments).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    renderPage();
    await screen.findByText('No appointments match these filters yet.');

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));

    await waitFor(() =>
      expect(vi.mocked(listAppointments)).toHaveBeenLastCalledWith(
        expect.objectContaining({ dateFrom: '2026-09-17', dateTo: '2026-09-17' }),
      ),
    );
    expect(screen.getByLabelText('From')).toHaveValue('2026-09-17');
    expect(screen.getByLabelText('To')).toHaveValue('2026-09-17');
  });

  it('"Next ▶" steps From/To one day forward from whatever From is currently set to', async () => {
    vi.mocked(listAppointments).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    renderPage();
    await screen.findByText('No appointments match these filters yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue('2026-09-17'));

    fireEvent.click(screen.getByRole('button', { name: 'Next ▶' }));

    await waitFor(() =>
      expect(vi.mocked(listAppointments)).toHaveBeenLastCalledWith(
        expect.objectContaining({ dateFrom: '2026-09-18', dateTo: '2026-09-18' }),
      ),
    );
  });

  it('"◀ Prev" steps one day back, defaulting off today when no date filter is set yet', async () => {
    vi.mocked(listAppointments).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    renderPage();
    await screen.findByText('No appointments match these filters yet.');

    fireEvent.click(screen.getByRole('button', { name: '◀ Prev' }));

    await waitFor(() =>
      expect(vi.mocked(listAppointments)).toHaveBeenLastCalledWith(
        expect.objectContaining({ dateFrom: '2026-09-16', dateTo: '2026-09-16' }),
      ),
    );
    expect(screen.getByLabelText('From')).toHaveValue('2026-09-16');
    expect(screen.getByLabelText('To')).toHaveValue('2026-09-16');
  });
});

// req.txt Issue F - a row JobCardsService.findEligibleForJobCardCreation() would accept
// (fetched via getEligibleAppointmentsForJobCard, same endpoint JobCardsPage's own picker
// uses) with no Job Card yet gets a "+ Create Job" pill linking straight into Job Cards,
// pre-filled via ?appointmentId=; it disappears once a Job Card exists or the row isn't in
// the eligible set. Widened 2026-09-21 from an effectiveStatus-only check (workshop sub-
// stages only) to the shared eligible-set check, so on-site jobs get the pill too.
describe('SchedulePage - req.txt Issue F: "+ Create Job" pill', () => {
  it('shows the pill for a Marked Received row with no Job Card yet, linking to Job Cards pre-filled with the appointment', async () => {
    vi.mocked(listAppointments).mockResolvedValue({
      data: [
        makeAppointment({
          id: 'appt-mr-1',
          appointmentNumber: 'APT-0400',
          status: 'COLLECTED_TO_WS',
          effectiveStatus: 'MARKED_RECEIVED',
          jobCard: null,
        }),
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    vi.mocked(getEligibleAppointmentsForJobCard).mockResolvedValue([
      { id: 'appt-mr-1', appointmentNumber: 'APT-0400', customerName: 'Ali', customerPhone: '0500000000', status: 'COLLECTED_TO_WS', scheduledAt: '2026-09-17T09:00:00Z' },
    ] as any);
    renderPage();

    const row = (await screen.findByText('APT-0400')).closest('tr')!;
    const pill = within(row).getByRole('link', { name: '+ Create Job' });
    expect(pill).toHaveAttribute('href', '/job-cards?appointmentId=appt-mr-1');
  });

  it('shows the pill for a Pending Job Creation row too', async () => {
    vi.mocked(listAppointments).mockResolvedValue({
      data: [
        makeAppointment({
          id: 'appt-pjc-1',
          appointmentNumber: 'APT-0401',
          status: 'COLLECTED_TO_WS',
          effectiveStatus: 'PENDING_JOB_CREATION',
          jobCard: null,
        }),
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    vi.mocked(getEligibleAppointmentsForJobCard).mockResolvedValue([
      { id: 'appt-pjc-1', appointmentNumber: 'APT-0401', customerName: 'Ali', customerPhone: '0500000000', status: 'COLLECTED_TO_WS', scheduledAt: '2026-09-17T09:00:00Z' },
    ] as any);
    renderPage();

    const row = (await screen.findByText('APT-0401')).closest('tr')!;
    expect(within(row).getByRole('link', { name: '+ Create Job' })).toBeInTheDocument();
  });

  it('shows the pill for an on-site row too, once its field visit is fully captured and no Job Card exists yet', async () => {
    // Real gap this closes: an on-site appointment never gets rewritten to MARKED_RECEIVED/
    // PENDING_JOB_CREATION (those are COLLECTED_TO_WS-only synthetic sub-stages), so under
    // the old effectiveStatus-only check this row never got the pill even though
    // JobCardsService.create() would already accept it (technician_visits fully captured +
    // invoice on file). It's eligible per the backend's own rule - eligibleAppointmentIds
    // is what now decides this, not the appointment's real/effective status.
    vi.mocked(listAppointments).mockResolvedValue({
      data: [
        makeAppointment({
          id: 'appt-onsite-1',
          appointmentNumber: 'APT-0404',
          status: 'COMPLETED',
          jobCard: null,
        }),
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    vi.mocked(getEligibleAppointmentsForJobCard).mockResolvedValue([
      { id: 'appt-onsite-1', appointmentNumber: 'APT-0404', customerName: 'Sara', customerPhone: '0500000001', status: 'COMPLETED', scheduledAt: '2026-09-17T09:00:00Z' },
    ] as any);
    renderPage();

    const row = (await screen.findByText('APT-0404')).closest('tr')!;
    const pill = within(row).getByRole('link', { name: '+ Create Job' });
    expect(pill).toHaveAttribute('href', '/job-cards?appointmentId=appt-onsite-1');
  });

  it('hides the pill once a Job Card already exists, even if the row is still in the eligible set', async () => {
    vi.mocked(listAppointments).mockResolvedValue({
      data: [
        makeAppointment({
          id: 'appt-has-jc',
          appointmentNumber: 'APT-0402',
          status: 'COLLECTED_TO_WS',
          effectiveStatus: 'PENDING_JOB_CREATION',
          jobCard: { id: 'jc-9', jobCardNumber: 'JC-0009' },
        }),
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    vi.mocked(getEligibleAppointmentsForJobCard).mockResolvedValue([
      { id: 'appt-has-jc', appointmentNumber: 'APT-0402', customerName: 'Ali', customerPhone: '0500000000', status: 'COLLECTED_TO_WS', scheduledAt: '2026-09-17T09:00:00Z' },
    ] as any);
    renderPage();

    const row = (await screen.findByText('APT-0402')).closest('tr')!;
    expect(within(row).queryByRole('link', { name: '+ Create Job' })).not.toBeInTheDocument();
  });

  it('does not show the pill for a row that is not in the eligible set (e.g. still SCHEDULED, nothing captured yet)', async () => {
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-sched', appointmentNumber: 'APT-0403', status: 'SCHEDULED', jobCard: null })],
      total: 1,
      page: 1,
      limit: 20,
    });
    vi.mocked(getEligibleAppointmentsForJobCard).mockResolvedValue([]);
    renderPage();

    const row = (await screen.findByText('APT-0403')).closest('tr')!;
    expect(within(row).queryByRole('link', { name: '+ Create Job' })).not.toBeInTheDocument();
  });

  // 2026-09-21 live finding: a row can be captured (Pending Job Creation, or on-site fully
  // captured) and still never get the pill, with nothing on the row saying why. This is
  // the fix - a "Job card blocked" badge with the reason, instead of a silent absence.
  it('shows a "Job card blocked" badge with the reason, instead of the pill, for a row that is captured but blocked', async () => {
    vi.mocked(listAppointments).mockResolvedValue({
      data: [
        makeAppointment({
          id: 'appt-blocked-1',
          appointmentNumber: 'APT-0405',
          status: 'COLLECTED_TO_WS',
          effectiveStatus: 'PENDING_JOB_CREATION',
          jobCard: null,
        }),
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    vi.mocked(getEligibleAppointmentsForJobCard).mockResolvedValue([]);
    vi.mocked(getBlockedAppointmentsForJobCard).mockResolvedValue([
      { id: 'appt-blocked-1', appointmentNumber: 'APT-0405', customerName: 'Fatima', customerPhone: '0500000002', status: 'COLLECTED_TO_WS', scheduledAt: '2026-09-21T09:00:00Z', reason: 'MISSING_INVOICE_NUMBER' },
    ] as any);
    renderPage();

    const row = (await screen.findByText('APT-0405')).closest('tr')!;
    expect(within(row).queryByRole('link', { name: '+ Create Job' })).not.toBeInTheDocument();
    const badge = within(row).getByText('Job card blocked ⓘ');
    expect(badge).toHaveAttribute('title', expect.stringContaining('Missing invoice number'));
  });
});


// Master-Data/New-Appointment billing modification Phase 2 (2026-09-22), req. 1 - the New
// Appointment popup's dynamic mandatory-field enforcement, driven by listAppointmentFieldConfigs.
describe('SchedulePage - New Appointment dynamic mandatory fields', () => {
  it('asterisks the label for a config-mandatory optional field, and leaves an unconfigured one as "(optional)"', async () => {
    vi.mocked(listAppointmentFieldConfigs).mockResolvedValue([
      { id: 'cfg-1', fieldKey: 'notes', fieldLabel: 'Notes', isMandatory: true, createdAt: '', updatedAt: '' },
    ] as any);
    const form = await openCreateModal();

    expect(await form.findByText('Notes *')).toBeInTheDocument();
    expect(form.queryByText('Notes (optional)')).not.toBeInTheDocument();
    // Email has no config row in this test - stays plainly optional.
    expect(form.getByText('Email (optional)')).toBeInTheDocument();
  });

  it('blocks submit with a clear message when a config-mandatory field is empty, and never calls createAppointment', async () => {
    vi.mocked(listAppointmentFieldConfigs).mockResolvedValue([
      { id: 'cfg-1', fieldKey: 'invoiceNumber', fieldLabel: 'Invoice Number', isMandatory: true, createdAt: '', updatedAt: '' },
    ] as any);
    const form = await openCreateModal();
    await fillRequiredCreateFields(form);

    fireEvent.click(form.getByRole('button', { name: 'Create' }));

    expect(await form.findByText(/Missing mandatory field\(s\): Invoice Number/)).toBeInTheDocument();
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it('submits successfully once the config-mandatory field is filled in', async () => {
    vi.mocked(listAppointmentFieldConfigs).mockResolvedValue([
      { id: 'cfg-1', fieldKey: 'invoiceNumber', fieldLabel: 'Invoice Number', isMandatory: true, createdAt: '', updatedAt: '' },
    ] as any);
    vi.mocked(createAppointment).mockResolvedValue(makeAppointment());
    const form = await openCreateModal();
    await fillRequiredCreateFields(form);
    fireEvent.change(form.getByLabelText('Invoice number', { exact: false }), { target: { value: 'INV-2026-1' } });

    fireEvent.click(form.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(createAppointment).toHaveBeenCalledWith(expect.objectContaining({ invoiceNumber: 'INV-2026-1' })),
    );
  });

  it('never asterisks or blocks on type/customerType - those stay permanently hard-required regardless of config', async () => {
    // Per the entity's own doc comment, a config row should never exist for these - proves
    // the popup doesn't accidentally treat a stray row for them as the toggle mechanism.
    vi.mocked(listAppointmentFieldConfigs).mockResolvedValue([
      { id: 'cfg-1', fieldKey: 'type', fieldLabel: 'Type', isMandatory: false, createdAt: '', updatedAt: '' },
      { id: 'cfg-2', fieldKey: 'customerType', fieldLabel: 'Customer Type', isMandatory: false, createdAt: '', updatedAt: '' },
    ] as any);
    vi.mocked(createAppointment).mockResolvedValue(makeAppointment());
    const form = await openCreateModal();
    await fillRequiredCreateFields(form);

    fireEvent.click(form.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createAppointment).toHaveBeenCalled());
  });

  it('does not run the mandatory-field check in edit mode', async () => {
    vi.mocked(listAppointmentFieldConfigs).mockResolvedValue([
      { id: 'cfg-1', fieldKey: 'invoiceNumber', fieldLabel: 'Invoice Number', isMandatory: true, createdAt: '', updatedAt: '' },
    ] as any);
    vi.mocked(updateAppointment).mockResolvedValue(makeAppointment());
    vi.mocked(listAppointments).mockResolvedValue({
      data: [makeAppointment({ id: 'appt-1', appointmentNumber: 'APT-0001', status: 'SCHEDULED', jobCard: null, invoiceNumber: null })],
      total: 1,
      page: 1,
      limit: 20,
    });
    renderPage();
    await screen.findByText('APT-0001');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByRole('heading', { name: /Edit/ });

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateAppointment).toHaveBeenCalled());
  });
});
