import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  makeAppointment,
  makeApplianceModel,
  makeBlockedAppointmentForJobCard,
  makeEligibleActivityAppointmentForJobCard,
  makeEligibleAppointmentForJobCard,
  makeJobCard,
  makeJobCardActivityLineItem,
} from '../../test/fixtures';

vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/appointmentsApi', () => ({
  getAppointment: vi.fn(),
}));
vi.mock('../../lib/masterDataApi', () => ({
  listApplianceModels: vi.fn(),
}));
vi.mock('../../lib/jobCardsApi', () => ({
  approveCustomer: vi.fn(),
  assignSection: vi.fn(),
  cancelJobCard: vi.fn(),
  createActivityJobCard: vi.fn(),
  createJobCard: vi.fn(),
  getBlockedAppointmentsForJobCard: vi.fn(),
  getEligibleActivityAppointmentsForJobCard: vi.fn(),
  getEligibleAppointmentsForJobCard: vi.fn(),
  getJobCardByAppointment: vi.fn(),
  getTaskPauses: vi.fn(),
  pauseTask: vi.fn(),
  resumeTask: vi.fn(),
  validateSn: vi.fn(),
  warrantyOverride: vi.fn(),
}));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { getAppointment } from '../../lib/appointmentsApi';
import { listApplianceModels } from '../../lib/masterDataApi';
import {
  createActivityJobCard,
  getBlockedAppointmentsForJobCard,
  getEligibleActivityAppointmentsForJobCard,
  getEligibleAppointmentsForJobCard,
  getJobCardByAppointment,
  getTaskPauses,
} from '../../lib/jobCardsApi';
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
  vi.mocked(getEligibleAppointmentsForJobCard).mockReset().mockResolvedValue([]);
  vi.mocked(getBlockedAppointmentsForJobCard).mockReset().mockResolvedValue([]);
  vi.mocked(getJobCardByAppointment).mockReset();
  vi.mocked(getTaskPauses).mockReset().mockResolvedValue([]);
  vi.mocked(getEligibleActivityAppointmentsForJobCard).mockReset().mockResolvedValue([]);
  vi.mocked(createActivityJobCard).mockReset();
  vi.mocked(listApplianceModels).mockReset().mockResolvedValue([]);
});

// Modification request (2026-09-17): "provide type to search similar to that of Job Card
// Journey, also list all appointments that fulfilled the criteria for job creation,
// instead now user copy paste appointment number for job creation." Replaces the old
// AsyncSearchPicker<Appointment> (which searched every appointment, and showed nothing
// until 2+ chars were typed) with EligibleAppointmentPicker, backed by GET
// /job-cards/eligible-appointments - it fetches on mount with no query (showing the whole
// eligible pool) and re-fetches with the typed value as an optional narrowing filter.
describe('JobCardsPage - eligible-appointment picker (2026-09-17)', () => {
  it('shows every eligible appointment on load, with no query typed', async () => {
    const eligible = makeEligibleAppointmentForJobCard();
    vi.mocked(getEligibleAppointmentsForJobCard).mockResolvedValue([eligible]);

    renderPage();

    expect(await screen.findByText('APT-0055')).toBeInTheDocument();
    await waitFor(() => expect(getEligibleAppointmentsForJobCard).toHaveBeenCalledWith(undefined));
  });

  it('narrows the eligible list as the user types', async () => {
    const eligible = makeEligibleAppointmentForJobCard();
    vi.mocked(getEligibleAppointmentsForJobCard).mockResolvedValueOnce([]).mockResolvedValueOnce([eligible]);

    renderPage();
    await waitFor(() => expect(getEligibleAppointmentsForJobCard).toHaveBeenCalledWith(undefined));

    fireEvent.change(screen.getByTestId('eligible-appointment-search-input'), { target: { value: 'APT-005' } });

    await waitFor(() => expect(getEligibleAppointmentsForJobCard).toHaveBeenCalledWith('APT-005'));
    expect(await screen.findByText('APT-0055')).toBeInTheDocument();
  });

  it('selecting an eligible appointment loads its job card', async () => {
    const eligible = makeEligibleAppointmentForJobCard({ customerName: 'Rashid Khan' });
    const appointment = makeAppointment({ id: 'appt-55', appointmentNumber: 'APT-0055', customerName: 'Rashid Khan' });
    vi.mocked(getEligibleAppointmentsForJobCard).mockResolvedValue([eligible]);
    vi.mocked(getAppointment).mockResolvedValue(appointment);
    vi.mocked(getJobCardByAppointment).mockResolvedValue(makeJobCard({ appointmentId: 'appt-55' }));

    renderPage();
    fireEvent.click(await screen.findByText('APT-0055'));

    await waitFor(() => expect(getJobCardByAppointment).toHaveBeenCalledWith('appt-55'));
    expect(await screen.findByText(/Rashid Khan/)).toBeInTheDocument();
    // Selecting collapses the picker back to a "Change" summary, same as the old picker.
    expect(screen.queryByTestId('eligible-appointment-search-input')).not.toBeInTheDocument();
  });

  it('shows a pool-wide empty message when nothing is eligible yet, distinct from a query-specific no-matches message', async () => {
    vi.mocked(getEligibleAppointmentsForJobCard).mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText('No appointments are ready for Job Card creation right now.')).toBeInTheDocument();
  });

  // 2026-09-21 live finding: a CCE saw the empty message above with no explanation, while
  // the exact same appointment showed "Pending Job Creation" on Appointment Scheduling.
  // Root cause was a separate invoiceNumber gate the two screens don't share (see
  // JobCardsService.findBlockedForJobCardCreation's own doc comment) - this is the fix,
  // surfacing the blocked list and its reason alongside the empty message instead of
  // leaving it a dead end.
  it('shows blocked appointments and why, alongside the empty message, once the eligible list comes back empty', async () => {
    vi.mocked(getEligibleAppointmentsForJobCard).mockResolvedValue([]);
    const blocked = makeBlockedAppointmentForJobCard({ appointmentNumber: 'APT-0060', customerName: 'Fatima Noor' });
    vi.mocked(getBlockedAppointmentsForJobCard).mockResolvedValue([blocked]);

    renderPage();

    expect(await screen.findByText('No appointments are ready for Job Card creation right now.')).toBeInTheDocument();
    expect(await screen.findByText(/APT-0060/)).toBeInTheDocument();
    expect(screen.getByText(/Fatima Noor/)).toBeInTheDocument();
    expect(screen.getByText(/Missing invoice number/)).toBeInTheDocument();
  });

  it('does not call the blocked-appointments endpoint at all when the eligible list already has results', async () => {
    const eligible = makeEligibleAppointmentForJobCard();
    vi.mocked(getEligibleAppointmentsForJobCard).mockResolvedValue([eligible]);

    renderPage();
    await screen.findByText('APT-0055');

    expect(getBlockedAppointmentsForJobCard).not.toHaveBeenCalled();
  });

  it('shows a query-specific no-matches message when a typed search comes back empty', async () => {
    const eligible = makeEligibleAppointmentForJobCard();
    vi.mocked(getEligibleAppointmentsForJobCard).mockResolvedValueOnce([eligible]).mockResolvedValueOnce([]);

    renderPage();
    await screen.findByText('APT-0055');

    fireEvent.change(screen.getByTestId('eligible-appointment-search-input'), { target: { value: 'zzz-no-such-thing' } });

    expect(await screen.findByText('No eligible appointments match "zzz-no-such-thing".')).toBeInTheDocument();
  });

  it('shows the request-failed error state, not a no-matches message, when the lookup itself fails', async () => {
    vi.mocked(getEligibleAppointmentsForJobCard).mockRejectedValue({ response: { status: 500 }, message: 'Request failed' });

    renderPage();

    expect(await screen.findByText('Request failed')).toBeInTheDocument();
    expect(screen.queryByText('No appointments are ready for Job Card creation right now.')).not.toBeInTheDocument();
  });
});

async function loadJobCard(jobCard: ReturnType<typeof makeJobCard> = makeJobCard({ appointmentId: 'appt-55' })) {
  const eligible = makeEligibleAppointmentForJobCard();
  const appointment = makeAppointment({ id: 'appt-55', appointmentNumber: 'APT-0055' });
  vi.mocked(getEligibleAppointmentsForJobCard).mockResolvedValue([eligible]);
  vi.mocked(getAppointment).mockResolvedValue(appointment);
  vi.mocked(getJobCardByAppointment).mockResolvedValue(jobCard);

  renderPage();
  fireEvent.click(await screen.findByText('APT-0055'));
  await waitFor(() => expect(getJobCardByAppointment).toHaveBeenCalledWith('appt-55'));
}

// 2026-09-14: canWarrantyOverride converted from a hardcoded WARRANTY_OVERRIDE_ROLES
// array to the real JOB_CARD_WARRANTY_OVERRIDE capability.
describe('JobCardsPage - Warranty Override capability gate', () => {
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

// 2026-09-14 (Group B): canValidateSn/canAssignSection/canApproveCustomer/canCancel used to
// be pure job-card-status booleans with zero capability check - every button rendered for
// every logged-in user, only 403ing on click. Now each also requires JOB_CARD_MANAGE,
// mirroring job-cards.controller.ts's @RequiresCapability('JOB_CARD_MANAGE') on all four
// actions (validate-sn/assign-section/approve-customer/cancel).
describe('JobCardsPage - JOB_CARD_MANAGE capability gate', () => {
  it('hides Assign Section, Record customer approval, and Cancel for a caller with no JOB_CARD_MANAGE capability, even though the job card status would otherwise show them', async () => {
    mockCapabilities([]);
    // Default fixture: status SN_VALIDATED (would show canAssignSection/canCancel),
    // warrantyStatus OOW + not CANCELLED (would show canApproveCustomer).
    await loadJobCard();
    expect(screen.queryByText(/Step 2 · Assign section/)).not.toBeInTheDocument();
    expect(screen.queryByText('Record customer approval (out-of-warranty jobs)')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancel this Job Card')).not.toBeInTheDocument();
  });

  it('shows Assign Section, Record customer approval, and Cancel for a role granted JOB_CARD_MANAGE via Designation access, not just a default role', async () => {
    mockCapabilities(['JOB_CARD_MANAGE']);
    await loadJobCard();
    expect(await screen.findByText(/Step 2 · Assign section/)).toBeInTheDocument();
    expect(screen.getByText('Record customer approval (out-of-warranty jobs)')).toBeInTheDocument();
    expect(screen.getByText('Cancel this Job Card')).toBeInTheDocument();
  });

  it('hides Validate Serial Number (OPEN-status job card) for a caller with no JOB_CARD_MANAGE capability', async () => {
    mockCapabilities([]);
    await loadJobCard(makeJobCard({ appointmentId: 'appt-55', status: 'OPEN', warrantyStatus: 'IW' }));
    expect(screen.queryByText(/Step 1 · Validate serial number/)).not.toBeInTheDocument();
  });

  it('shows Validate Serial Number (OPEN-status job card) once JOB_CARD_MANAGE is granted', async () => {
    mockCapabilities(['JOB_CARD_MANAGE']);
    await loadJobCard(makeJobCard({ appointmentId: 'appt-55', status: 'OPEN', warrantyStatus: 'IW' }));
    expect(await screen.findByText(/Step 1 · Validate serial number/)).toBeInTheDocument();
  });
});

// Job Type split (2026-09-22 request, Phase 10) - the new flow toggle between the REPAIR
// eligible-appointment picker (EligibleAppointmentPicker, unchanged) and the new
// Installation/Delivery Installation picker (EligibleActivityAppointmentPicker), each
// backed by its own endpoint.
describe('JobCardsPage - flow toggle (Phase 10)', () => {
  it('defaults to the Repair flow, querying only the REPAIR eligible-appointments endpoint', async () => {
    renderPage();

    expect(await screen.findByTestId('eligible-appointment-search-input')).toBeInTheDocument();
    await waitFor(() => expect(getEligibleAppointmentsForJobCard).toHaveBeenCalledWith(undefined));
    expect(getEligibleActivityAppointmentsForJobCard).not.toHaveBeenCalled();
  });

  it('switching to Installation / Delivery swaps in the activity picker and queries its own endpoint', async () => {
    renderPage();
    await screen.findByTestId('eligible-appointment-search-input');

    fireEvent.click(screen.getByText('Installation / Delivery'));

    expect(await screen.findByTestId('eligible-activity-appointment-search-input')).toBeInTheDocument();
    expect(screen.queryByTestId('eligible-appointment-search-input')).not.toBeInTheDocument();
    await waitFor(() => expect(getEligibleActivityAppointmentsForJobCard).toHaveBeenCalledWith(undefined));
  });
});

async function selectActivityAppointmentWithNoJobCard() {
  const eligible = makeEligibleActivityAppointmentForJobCard();
  const appointment = makeAppointment({ id: 'appt-70', appointmentNumber: 'APT-0070', jobType: 'INSTALLATION' });
  vi.mocked(getEligibleActivityAppointmentsForJobCard).mockResolvedValue([eligible]);
  vi.mocked(getAppointment).mockResolvedValue(appointment);
  vi.mocked(getJobCardByAppointment).mockRejectedValue({ response: { status: 404 }, message: 'Not Found' });

  renderPage();
  fireEvent.click(screen.getByText('Installation / Delivery'));
  fireEvent.click(await screen.findByText('APT-0070'));
  await waitFor(() => expect(getJobCardByAppointment).toHaveBeenCalledWith('appt-70'));
}

// Job Type split (Phase 10) - the new ERP-sourced creation path: a separate button/message
// from the plain REPAIR "Create Job Card" block, and a modal with the ERP reference number
// + repeatable line-items grid instead of a single-click create.
describe('JobCardsPage - Installation/Delivery Job Card creation flow (Phase 10)', () => {
  it('shows the ERP-flow explanation and Create Job Card button, not the REPAIR-flow invoice-gate text, once an activity-eligible appointment with no Job Card is selected', async () => {
    await selectActivityAppointmentWithNoJobCard();

    expect(
      await screen.findByText(/No Job Card exists yet for this Installation\/Delivery Installation appointment/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/requires the appointment to have an invoice number on file/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Job Card' })).toBeInTheDocument();
  });

  it('opens the Create Job Card modal on click, loading appliance models for the Brand/Model dropdown', async () => {
    vi.mocked(listApplianceModels).mockResolvedValue([makeApplianceModel()]);
    await selectActivityAppointmentWithNoJobCard();

    fireEvent.click(await screen.findByRole('button', { name: 'Create Job Card' }));

    const dialog = await screen.findByRole('dialog', { name: 'Create Job Card - Installation / Delivery Installation' });
    expect(within(dialog).getByLabelText('ERP Reference Number')).toBeInTheDocument();
    expect(await within(dialog).findByRole('option', { name: 'Samsung — RT50K' })).toBeInTheDocument();
    await waitFor(() => expect(listApplianceModels).toHaveBeenCalled());
  });

  it('submits the ERP reference number and line items as createActivityJobCard, then closes the modal on success', async () => {
    vi.mocked(listApplianceModels).mockResolvedValue([makeApplianceModel({ id: 'model-9', brand: 'LG', model: 'GR-B247' })]);
    vi.mocked(createActivityJobCard).mockResolvedValue(makeJobCard({ id: 'jc-70', status: 'COMPLETED', appointmentId: 'appt-70' }));
    await selectActivityAppointmentWithNoJobCard();

    fireEvent.click(await screen.findByRole('button', { name: 'Create Job Card' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create Job Card - Installation / Delivery Installation' });
    await within(dialog).findByRole('option', { name: 'LG — GR-B247' });

    fireEvent.change(within(dialog).getByLabelText('ERP Reference Number'), { target: { value: 'ERP-2026-04512' } });
    fireEvent.change(within(dialog).getByLabelText('Brand / Model'), { target: { value: 'model-9' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Job Card' }));

    await waitFor(() =>
      expect(createActivityJobCard).toHaveBeenCalledWith({
        appointmentId: 'appt-70',
        erpReferenceNumber: 'ERP-2026-04512',
        lineItems: [{ applianceModelId: 'model-9', jobType: 'INSTALLATION', quantity: 1, finished: true }],
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

// Job Type split (Phase 10) - a COMPLETED Job Card (ERP-sourced, created via
// createActivityJobCard) renders an entirely different detail grid and hides the
// REPAIR-flow actions that no longer make sense for it (Cancel, Warranty Override) even
// when the caller holds the capabilities that would otherwise show them.
describe('JobCardsPage - COMPLETED (ERP-sourced) Job Card detail (Phase 10)', () => {
  const completedJobCard = makeJobCard({
    status: 'COMPLETED',
    erpReferenceNumber: 'ERP-2026-04512',
    activityLineItems: [makeJobCardActivityLineItem()],
    serialNumber: null,
    faultCode: null,
    symptomCode: null,
    warrantyStatus: null,
    originalWarrantyStatus: null,
  });

  it('shows the ERP reference number and line items instead of the fault/symptom/warranty grid', async () => {
    await loadJobCard(completedJobCard);

    expect(await screen.findByText('ERP Ref ERP-2026-04512')).toBeInTheDocument();
    expect(screen.getByText('ERP Reference Number')).toBeInTheDocument();
    expect(screen.getByText(/Samsung — RT50K/)).toBeInTheDocument();
    expect(screen.getByText(/INSTALLATION · qty 1 · finished/)).toBeInTheDocument();
    expect(screen.queryByText('Fault / symptom')).not.toBeInTheDocument();
    expect(screen.queryByText('Warranty status')).not.toBeInTheDocument();
  });

  it('shows the ERP-sourced progress message instead of the OPEN→…→DELIVERED stepper', async () => {
    await loadJobCard(completedJobCard);

    expect(
      await screen.findByText(/Completed directly from ERP-sourced Installation\/Delivery paperwork/),
    ).toBeInTheDocument();
  });

  it('hides Cancel and Warranty Override even when the caller holds both capabilities', async () => {
    mockCapabilities(['JOB_CARD_MANAGE', 'JOB_CARD_WARRANTY_OVERRIDE']);
    await loadJobCard(completedJobCard);

    await screen.findByText('ERP Ref ERP-2026-04512');
    expect(screen.queryByText('Cancel this Job Card')).not.toBeInTheDocument();
    expect(screen.queryByText(/Warranty Override/)).not.toBeInTheDocument();
  });
});
