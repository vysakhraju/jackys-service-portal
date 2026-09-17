import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeAppointment, makeEligibleAppointmentForJobCard, makeJobCard } from '../../test/fixtures';

vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/appointmentsApi', () => ({
  getAppointment: vi.fn(),
}));
vi.mock('../../lib/jobCardsApi', () => ({
  approveCustomer: vi.fn(),
  assignSection: vi.fn(),
  cancelJobCard: vi.fn(),
  createJobCard: vi.fn(),
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
import { getEligibleAppointmentsForJobCard, getJobCardByAppointment, getTaskPauses } from '../../lib/jobCardsApi';
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
  vi.mocked(getJobCardByAppointment).mockReset();
  vi.mocked(getTaskPauses).mockReset().mockResolvedValue([]);
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
