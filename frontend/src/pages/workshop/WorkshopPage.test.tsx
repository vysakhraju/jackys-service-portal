import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeJobCard, makeReservation, makeWorkshopState } from '../../test/fixtures';
import { WorkshopInventoryLayout } from './WorkshopInventoryLayout';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/workshopApi', () => ({
  assignWorkshopTechnician: vi.fn(),
  startWip: vi.fn(),
  requestSpare: vi.fn(),
  completeWorkshop: vi.fn(),
  getWorkshopState: vi.fn(),
  listReworkApprovers: vi.fn(), // #218
}));
vi.mock('../../lib/inventoryApi', () => ({
  requestReturn: vi.fn(),
  reviewReservation: vi.fn(),
}));
vi.mock('../../lib/masterDataApi', () => ({
  listSpareParts: vi.fn(),
}));
// #218: the assign-technician form is now a NamePicker backed by this.
vi.mock('../../lib/technicianScheduleApi', () => ({
  getGanttBoard: vi.fn(),
}));
// #218/#251: the top-of-page "paste the job card's id" input is now an AsyncSearchPicker
// backed by this.
vi.mock('../../lib/jobCardJourneyApi', () => ({
  searchJobCardJourney: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { assignWorkshopTechnician, getWorkshopState, listReworkApprovers, requestSpare } from '../../lib/workshopApi';
import { requestReturn, reviewReservation } from '../../lib/inventoryApi';
import { listSpareParts } from '../../lib/masterDataApi';
import { getGanttBoard } from '../../lib/technicianScheduleApi';
import { searchJobCardJourney } from '../../lib/jobCardJourneyApi';
import { WorkshopPage } from './WorkshopPage';

function renderPage(jobCardId = 'jc-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/workshop-inventory/workshop?jobCardId=${jobCardId}`]}>
        <WorkshopPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockUser(overrides: { id?: string; roleName?: string } = {}) {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      id: overrides.id ?? 'user-1',
      firstName: 'Test',
      lastName: 'User',
      email: 't@example.com',
      employeeId: 'E1',
      status: 'ACTIVE',
      lastLoginAt: null,
      role: { id: 'r1', name: overrides.roleName ?? 'SUPER_ADMIN', displayName: overrides.roleName ?? 'Super Admin' },
    },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
  } as any);
}

// 2026-09-14: canAssign/canReview/canConfirmReturn now check the real capability
// (useMyCapabilities) instead of a hardcoded role array - see WorkshopPage.tsx's own
// comments. Defaults to full access so every test not specifically about capability
// gating (ownership gating, tab-switch persistence, the assign-technician picker's own
// behavior, etc.) keeps working unchanged; the dedicated capability-gating tests below
// override this with mockCapabilities([...], false).
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

beforeEach(() => {
  mockCapabilities([], true);
  vi.mocked(getWorkshopState).mockReset();
  vi.mocked(listSpareParts).mockReset();
  vi.mocked(listSpareParts).mockResolvedValue([]);
  vi.mocked(assignWorkshopTechnician).mockReset();
  vi.mocked(requestSpare).mockReset();
  vi.mocked(listReworkApprovers).mockReset().mockResolvedValue([{ id: 'tl-1', name: 'Fatima Noor' }]);
  vi.mocked(getGanttBoard).mockReset().mockResolvedValue({
    date: '2026-09-14',
    rows: [
      { technicianId: 'wt-1', technicianName: 'Sanjay Rao', role: 'TECHNICIAN_WORKSHOP', blocks: [], hasConflict: false },
      { technicianId: 'ft-1', technicianName: 'Ahmed Al Farsi', role: 'TECHNICIAN_FIELD', blocks: [], hasConflict: false },
    ],
    unassignedAppointments: [],
    unassignedJobCards: [],
  } as any);
  vi.mocked(searchJobCardJourney).mockReset().mockResolvedValue([]);
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

// #218/#251: covers the search-then-select path for the top-of-page job card lookup,
// distinct from every other test in this file which deep-links straight in via ?jobCardId=.
describe('WorkshopPage - #218 name-based job card picker', () => {
  it('searches and selects a job card, then loads its workshop state', async () => {
    mockUser({ roleName: 'TECHNICAL_TEAM_LEADER' });
    vi.mocked(searchJobCardJourney).mockResolvedValue([
      {
        jobCardId: 'jc-99',
        jobCardNumber: 'JC-0099',
        jobCardStatus: 'WORKSHOP_ASSIGNED',
        appointmentNumber: 'APT-0099',
        customerName: 'Layla Hassan',
        customerPhone: '050-9998888',
        deliveryNumber: null,
      },
    ]);
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({ jobCard: makeJobCard({ id: 'jc-99', jobCardNumber: 'JC-0099' }) }),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/workshop-inventory/workshop']}>
          <WorkshopPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.focus(screen.getByTestId('async-search-picker-input'));
    fireEvent.change(screen.getByTestId('async-search-picker-input'), { target: { value: 'JC-0099' } });
    fireEvent.click(await screen.findByText('JC-0099'));

    await waitFor(() => expect(getWorkshopState).toHaveBeenCalledWith('jc-99'));
  });
});

// 2026-09-14 live-tested bug: switching to a sibling tab (Inventory & Stock / Need Spare
// Requests) under WorkshopInventoryLayout's <Outlet /> fully unmounts this page, and the
// loaded job card was silently lost on return because activeJobCardId was never written
// back into the URL. These tests cover the fix - the URL now tracks the picked job card,
// so a remount (which is exactly what a tab switch does) re-seeds from it.
describe('WorkshopPage - job card survives a tab-switch remount (URL stays in sync)', () => {
  it('writes the picked job card into the URL as soon as it is selected via search', async () => {
    mockUser({ roleName: 'TECHNICAL_TEAM_LEADER' });
    vi.mocked(searchJobCardJourney).mockResolvedValue([
      {
        jobCardId: 'jc-99',
        jobCardNumber: 'JC-0099',
        jobCardStatus: 'WORKSHOP_ASSIGNED',
        appointmentNumber: 'APT-0099',
        customerName: 'Layla Hassan',
        customerPhone: '050-9998888',
        deliveryNumber: null,
      },
    ]);
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({ jobCard: makeJobCard({ id: 'jc-99', jobCardNumber: 'JC-0099' }) }),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/workshop-inventory/workshop']}>
          <WorkshopPage />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.focus(screen.getByTestId('async-search-picker-input'));
    fireEvent.change(screen.getByTestId('async-search-picker-input'), { target: { value: 'JC-0099' } });
    fireEvent.click(await screen.findByText('JC-0099'));

    await waitFor(() => expect(getWorkshopState).toHaveBeenCalledWith('jc-99'));
    expect(screen.getByTestId('location-search')).toHaveTextContent('?jobCardId=jc-99');
  });

  it('re-seeds the same job card after an unmount+remount at the URL it just wrote (simulating a tab switch and back)', async () => {
    mockUser({ roleName: 'TECHNICAL_TEAM_LEADER' });
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({ jobCard: makeJobCard({ id: 'jc-99', jobCardNumber: 'JC-0099' }) }),
    );

    // The URL WorkshopPage would have written after picking JC-0099 (per the test above) -
    // WorkshopInventoryLayout's sibling-route <Outlet /> unmounts WorkshopPage entirely on
    // tab switch and mounts a fresh instance on return, so this is a faithful simulation.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/workshop-inventory/workshop?jobCardId=jc-99']}>
          <WorkshopPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(getWorkshopState).toHaveBeenCalledWith('jc-99'));
    expect(await screen.findAllByText('JC-0099')).not.toHaveLength(0);
  });

  it('clears the URL job card param when the selection is cleared ("Change")', async () => {
    mockUser({ roleName: 'TECHNICAL_TEAM_LEADER' });
    vi.mocked(getWorkshopState).mockResolvedValue(makeWorkshopState());

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/workshop-inventory/workshop?jobCardId=jc-1']}>
          <WorkshopPage />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText('Request a spare part (FR-09: reserves, does not deduct)');
    expect(screen.getByTestId('location-search')).toHaveTextContent('?jobCardId=jc-1');

    fireEvent.click(screen.getByText('Change'));
    expect(screen.getByTestId('location-search')).toHaveTextContent('');
  });
});

// 2026-09-14 live-tested finding, ROUND 2: the URL-sync fix above (tested via rendering
// WorkshopPage in isolation) did NOT actually fix the reported bug - you confirmed by
// logging in as a workshop technician, loading a job, clicking "Inventory & Stock", then
// clicking back to "Workshop" and finding the job gone again. The reason: the "Workshop"
// tab's <NavLink> target is a bare path with no ?jobCardId= at all, so switching tabs via
// the real nav (not a simulated same-url remount) drops the query string entirely - no
// amount of THIS page echoing its own selection into ITS OWN url survives that. These tests
// render the actual WorkshopInventoryLayout with its real <Outlet /> and click the real
// tab links, which is what the isolated tests above could not catch.
describe('WorkshopPage - job card survives switching tabs via the real WorkshopInventoryLayout (round 2 fix)', () => {
  // "JC-0001" always matches both the AsyncSearchPicker's own selected-label span AND the
  // job card detail header - findByText correctly refuses to guess between them, so every
  // check in this block uses this instead of asserting a single match.
  async function findJobCardShown() {
    expect((await screen.findAllByText('JC-0001')).length).toBeGreaterThan(0);
  }

  function renderWithLayout(initialEntry: string) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/workshop-inventory" element={<WorkshopInventoryLayout />}>
              <Route path="workshop" element={<WorkshopPage />} />
              <Route path="inventory" element={<div>Inventory & Stock placeholder</div>} />
              <Route path="need-spare" element={<div>Need Spare Requests placeholder</div>} />
            </Route>
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('keeps the job loaded after clicking to Inventory & Stock and back to Workshop', async () => {
    mockUser({ roleName: 'TECHNICAL_TEAM_LEADER' });
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({ jobCard: makeJobCard({ id: 'jc-1', jobCardNumber: 'JC-0001', status: 'SECTION_ASSIGNED', section: 'WORKSHOP' }) }),
    );
    renderWithLayout('/workshop-inventory/workshop?jobCardId=jc-1');

    await waitFor(() => expect(getWorkshopState).toHaveBeenCalledWith('jc-1'));
    await findJobCardShown();
    expect(getWorkshopState).toHaveBeenCalledTimes(1);

    // Exactly what was reported: click the "Inventory & Stock" tab...
    fireEvent.click(screen.getByRole('link', { name: 'Inventory & Stock' }));
    expect(await screen.findByText('Inventory & Stock placeholder')).toBeInTheDocument();

    // ...then click back to "Workshop".
    fireEvent.click(screen.getByRole('link', { name: 'Workshop' }));

    // The job must still be there - not a blank search box again.
    await findJobCardShown();
    expect(screen.queryByTestId('async-search-picker-input')).not.toBeInTheDocument();
  });

  it('also survives a trip through Need Spare Requests, not just Inventory & Stock', async () => {
    mockUser({ roleName: 'TECHNICAL_TEAM_LEADER' });
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({ jobCard: makeJobCard({ id: 'jc-1', jobCardNumber: 'JC-0001', status: 'SECTION_ASSIGNED', section: 'WORKSHOP' }) }),
    );
    renderWithLayout('/workshop-inventory/workshop?jobCardId=jc-1');

    await findJobCardShown();
    fireEvent.click(screen.getByRole('link', { name: 'Need Spare Requests' }));
    expect(await screen.findByText('Need Spare Requests placeholder')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Workshop' }));
    await findJobCardShown();
  });

  it('restores ?jobCardId= into the url after switching back, so a refresh at that point still works', async () => {
    mockUser({ roleName: 'TECHNICAL_TEAM_LEADER' });
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({ jobCard: makeJobCard({ id: 'jc-1', jobCardNumber: 'JC-0001', status: 'SECTION_ASSIGNED', section: 'WORKSHOP' }) }),
    );
    renderWithLayout('/workshop-inventory/workshop?jobCardId=jc-1');
    await findJobCardShown();

    fireEvent.click(screen.getByRole('link', { name: 'Inventory & Stock' }));
    await screen.findByText('Inventory & Stock placeholder');
    fireEvent.click(screen.getByRole('link', { name: 'Workshop' }));
    await findJobCardShown();

    expect(screen.getByTestId('location-search')).toHaveTextContent('?jobCardId=jc-1');
  });
});

describe('WorkshopPage - ownership gating (the-fool pre-mortem finding #4)', () => {
  it('hides action buttons and shows a warning for a technician not assigned to this job', async () => {
    mockUser({ id: 'someone-else', roleName: 'TECHNICIAN_WORKSHOP' });
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({ jobCard: makeWorkshopState().jobCard }),
    );
    renderPage();
    expect(await screen.findByText(/You're not the technician assigned to this job/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Complete → Ready for QC/i })).not.toBeInTheDocument();
  });

  it('shows the action buttons for the assigned technician themselves', async () => {
    mockUser({ id: 'tech-1', roleName: 'TECHNICIAN_WORKSHOP' });
    vi.mocked(getWorkshopState).mockResolvedValue(makeWorkshopState());
    renderPage();
    expect(await screen.findByText('Request a spare part (FR-09: reserves, does not deduct)')).toBeInTheDocument();
    expect(screen.queryByText(/You're not the technician assigned/i)).not.toBeInTheDocument();
  });

  it('shows the action buttons for a privileged role regardless of assignment', async () => {
    mockUser({ id: 'someone-else', roleName: 'SERVICE_HEAD' });
    vi.mocked(getWorkshopState).mockResolvedValue(makeWorkshopState());
    renderPage();
    expect(await screen.findByText('Request a spare part (FR-09: reserves, does not deduct)')).toBeInTheDocument();
  });
});

describe('WorkshopPage - READY_FOR_QC stays in scope (the-fool pre-mortem finding #1)', () => {
  it('still shows the Request Spare form on a READY_FOR_QC job (top-up path), not a "past this phase" dead end', async () => {
    mockUser({ id: 'tech-1', roleName: 'TECHNICIAN_WORKSHOP' });
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({ jobCard: { ...makeWorkshopState().jobCard, status: 'READY_FOR_QC' } }),
    );
    renderPage();
    expect(await screen.findByText('Request a spare part (FR-09: reserves, does not deduct)')).toBeInTheDocument();
    // Complete is NOT offered on a READY_FOR_QC job (it's already complete) - only the
    // top-up request and the informational note should show.
    expect(screen.queryByRole('button', { name: /Complete → Ready for QC/i })).not.toBeInTheDocument();
    expect(screen.getByText(/waiting on QC/i)).toBeInTheDocument();
  });
});

describe('WorkshopPage - rework re-request hint', () => {
  it('shows the rework sign-off hint when the job has a prior QC rejection', async () => {
    mockUser({ id: 'tech-1', roleName: 'TECHNICIAN_WORKSHOP' });
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({ jobCard: { ...makeWorkshopState().jobCard, qcRejectionCount: 1 } }),
    );
    renderPage();
    expect(await screen.findByText(/QC-rejected before \(1x\)/i)).toBeInTheDocument();
  });

  it('does not show the rework hint on a job with no prior QC rejection', async () => {
    mockUser({ id: 'tech-1', roleName: 'TECHNICIAN_WORKSHOP' });
    vi.mocked(getWorkshopState).mockResolvedValue(makeWorkshopState());
    renderPage();
    await screen.findByText('Request a spare part (FR-09: reserves, does not deduct)');
    expect(screen.queryByText(/QC-rejected before/i)).not.toBeInTheDocument();
  });

  // #218: the rework sign-off "Approver" field is now a NamePicker (backed by
  // GET /workshop/rework-approvers), not a raw-paste user id.
  it('picks the rework approver by name and submits their real id', async () => {
    mockUser({ id: 'tech-1', roleName: 'TECHNICIAN_WORKSHOP' });
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({ jobCard: { ...makeWorkshopState().jobCard, qcRejectionCount: 1 } }),
    );
    vi.mocked(listSpareParts).mockResolvedValue([{ id: 'sp-1', code: 'SP-001', name: 'Compressor', active: true } as any]);
    vi.mocked(requestSpare).mockResolvedValue(makeReservation());
    renderPage();

    await screen.findByText(/QC-rejected before \(1x\)/i);
    await screen.findByText('SP-001 — Compressor'); // wait for the spare-parts query to resolve
    fireEvent.click(screen.getByText(/Rework sign-off/));

    fireEvent.change(screen.getByLabelText('Spare part'), { target: { value: 'sp-1' } });
    fireEvent.focus(screen.getByTestId('name-picker-input'));
    fireEvent.click(await screen.findByText('Fatima Noor'));
    fireEvent.click(screen.getByRole('button', { name: 'Request Spare' }));

    await waitFor(() =>
      expect(vi.mocked(requestSpare)).toHaveBeenCalledWith('jc-1', expect.objectContaining({ approverId: 'tl-1' })),
    );
  });
});

describe('WorkshopPage - stale reservation visibility gap is documented', () => {
  it('lists a stale reservation with its age and points to the always-current Active reservations section for anything fresh', async () => {
    mockUser({ id: 'tech-1', roleName: 'TECHNICIAN_WORKSHOP' });
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({ staleReservations: [makeReservation({ ageHours: 30 })] }),
    );
    renderPage();
    expect(await screen.findByText(/held 30h/i)).toBeInTheDocument();
    expect(screen.getByText(/shows in "Active reservations on this job" above instead/i)).toBeInTheDocument();
  });
});

// 2026-09-14 live-tested finding: a technician requested a spare, switched to the
// Inventory & Stock tab and back (a full remount of this screen), and the reservation
// looked gone even though it was still HELD in the database - staleReservations only ever
// shows something once it's idle 24h+. activeReservations (fetched fresh on every
// getWorkshopState call, same as jobCard itself) is the fix - these tests simulate the
// exact remount and prove the reservation survives it.
describe('WorkshopPage - Active reservations on this job (persists across a remount, unlike the old justReserved-only banner)', () => {
  it('shows a fresh HELD reservation from activeReservations even on a fresh page load - not only right after submitting the form', async () => {
    mockUser({ id: 'tech-1', roleName: 'TECHNICIAN_WORKSHOP' });
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({
        activeReservations: [makeReservation({ id: 'res-fresh', status: 'HELD', quantityReserved: 1, quantityRequested: 1 })],
      }),
    );
    renderPage();

    expect(await screen.findByText(/Active reservations on this job \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Reservation id: res-fresh/i)).toBeInTheDocument();
    expect(screen.getByText(/1\/1 reserved/)).toBeInTheDocument();
  });

  it('shows "nothing currently reserved" when activeReservations is empty, rather than hiding the section', async () => {
    mockUser({ id: 'tech-1', roleName: 'TECHNICIAN_WORKSHOP' });
    vi.mocked(getWorkshopState).mockResolvedValue(makeWorkshopState({ activeReservations: [] }));
    renderPage();

    expect(await screen.findByText(/Active reservations on this job \(0\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing currently reserved for this job/i)).toBeInTheDocument();
  });

  it('lets the custodian technician request a return on their own active reservation, and refetches state on success', async () => {
    mockUser({ id: 'tech-1', roleName: 'TECHNICIAN_WORKSHOP' });
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({
        activeReservations: [makeReservation({ id: 'res-fresh', status: 'HELD', custodianUserId: 'tech-1' })],
      }),
    );
    vi.mocked(requestReturn).mockResolvedValue(makeReservation({ id: 'res-fresh', status: 'RETURN_PENDING' }));
    renderPage();

    await screen.findByText(/Active reservations on this job \(1\)/i);
    fireEvent.click(screen.getByRole('button', { name: 'Not needed - request return' }));

    await waitFor(() => expect(vi.mocked(requestReturn)).toHaveBeenCalledWith('res-fresh'));
    await waitFor(() => expect(vi.mocked(getWorkshopState)).toHaveBeenCalledTimes(2)); // onChanged() re-fetched state
  });

  it('does not let a different, non-privileged technician request a return on a reservation they are not the custodian of', async () => {
    mockUser({ id: 'tech-2', roleName: 'TECHNICIAN_WORKSHOP' });
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({
        jobCard: { ...makeWorkshopState().jobCard, assignedWorkshopTechnicianId: 'tech-2' },
        activeReservations: [makeReservation({ id: 'res-fresh', status: 'HELD', custodianUserId: 'tech-1' })],
      }),
    );
    renderPage();

    await screen.findByText(/Active reservations on this job \(1\)/i);
    expect(screen.queryByRole('button', { name: 'Not needed - request return' })).not.toBeInTheDocument();
  });
});

// 2026-09-14 live-tested finding: a technician requesting a spare part that already has
// an outstanding (non-terminal) reservation on this exact job card used to go straight
// through, silently doubling up a hold on Main Store. Now it's confirmed first - checked
// against the same activeReservations list "Active reservations on this job" renders from.
describe('WorkshopPage - confirm before requesting the same spare part again', () => {
  it('asks for confirmation instead of submitting when the part already has an active reservation on this job', async () => {
    mockUser({ id: 'tech-1', roleName: 'TECHNICIAN_WORKSHOP' });
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({
        activeReservations: [
          makeReservation({
            id: 'res-existing',
            sparePartId: 'sp-1',
            status: 'HELD',
            quantityReserved: 2,
            sparePart: { id: 'sp-1', code: 'SP-001', name: 'Compressor' },
          }),
        ],
      }),
    );
    vi.mocked(listSpareParts).mockResolvedValue([{ id: 'sp-1', code: 'SP-001', name: 'Compressor', active: true } as any]);
    renderPage();

    await screen.findByText('SP-001 — Compressor');
    fireEvent.change(screen.getByLabelText('Spare part'), { target: { value: 'sp-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request Spare' }));

    expect(await screen.findByText('Request more of the same spare?')).toBeInTheDocument();
    expect(
      screen.getByText(/SP-001 — Compressor already has an outstanding request on this job card \(HELD, 2 unit\(s\)\)/i),
    ).toBeInTheDocument();
    expect(vi.mocked(requestSpare)).not.toHaveBeenCalled();
  });

  it('only proceeds with the request once the technician confirms Yes', async () => {
    mockUser({ id: 'tech-1', roleName: 'TECHNICIAN_WORKSHOP' });
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({
        activeReservations: [makeReservation({ id: 'res-existing', sparePartId: 'sp-1', status: 'HELD' })],
      }),
    );
    vi.mocked(listSpareParts).mockResolvedValue([{ id: 'sp-1', code: 'SP-001', name: 'Compressor', active: true } as any]);
    vi.mocked(requestSpare).mockResolvedValue(makeReservation({ sparePartId: 'sp-1' }));
    renderPage();

    await screen.findByText('SP-001 — Compressor');
    fireEvent.change(screen.getByLabelText('Spare part'), { target: { value: 'sp-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request Spare' }));

    await screen.findByText('Request more of the same spare?');
    fireEvent.click(screen.getByRole('button', { name: 'Yes, request again' }));

    await waitFor(() =>
      expect(vi.mocked(requestSpare)).toHaveBeenCalledWith('jc-1', expect.objectContaining({ sparePartId: 'sp-1' })),
    );
  });

  it('submits nothing when the technician clicks No, cancel', async () => {
    mockUser({ id: 'tech-1', roleName: 'TECHNICIAN_WORKSHOP' });
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({
        activeReservations: [makeReservation({ id: 'res-existing', sparePartId: 'sp-1', status: 'HELD' })],
      }),
    );
    vi.mocked(listSpareParts).mockResolvedValue([{ id: 'sp-1', code: 'SP-001', name: 'Compressor', active: true } as any]);
    renderPage();

    await screen.findByText('SP-001 — Compressor');
    fireEvent.change(screen.getByLabelText('Spare part'), { target: { value: 'sp-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request Spare' }));

    await screen.findByText('Request more of the same spare?');
    fireEvent.click(screen.getByRole('button', { name: 'No, cancel' }));

    expect(screen.queryByText('Request more of the same spare?')).not.toBeInTheDocument();
    expect(vi.mocked(requestSpare)).not.toHaveBeenCalled();
  });

  it('submits immediately, no confirmation, when the part has no active reservation on this job yet', async () => {
    mockUser({ id: 'tech-1', roleName: 'TECHNICIAN_WORKSHOP' });
    vi.mocked(getWorkshopState).mockResolvedValue(makeWorkshopState({ activeReservations: [] }));
    vi.mocked(listSpareParts).mockResolvedValue([{ id: 'sp-1', code: 'SP-001', name: 'Compressor', active: true } as any]);
    vi.mocked(requestSpare).mockResolvedValue(makeReservation({ sparePartId: 'sp-1' }));
    renderPage();

    await screen.findByText('SP-001 — Compressor');
    fireEvent.change(screen.getByLabelText('Spare part'), { target: { value: 'sp-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request Spare' }));

    expect(screen.queryByText('Request more of the same spare?')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(vi.mocked(requestSpare)).toHaveBeenCalledWith('jc-1', expect.objectContaining({ sparePartId: 'sp-1' })),
    );
  });

  it('does not confirm against a different spare part that happens to also be active on this job', async () => {
    mockUser({ id: 'tech-1', roleName: 'TECHNICIAN_WORKSHOP' });
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({
        activeReservations: [makeReservation({ id: 'res-existing', sparePartId: 'sp-OTHER', status: 'HELD' })],
      }),
    );
    vi.mocked(listSpareParts).mockResolvedValue([{ id: 'sp-1', code: 'SP-001', name: 'Compressor', active: true } as any]);
    vi.mocked(requestSpare).mockResolvedValue(makeReservation({ sparePartId: 'sp-1' }));
    renderPage();

    await screen.findByText('SP-001 — Compressor');
    fireEvent.change(screen.getByLabelText('Spare part'), { target: { value: 'sp-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request Spare' }));

    expect(screen.queryByText('Request more of the same spare?')).not.toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(requestSpare)).toHaveBeenCalled());
  });
});

// #218: the "Assign a workshop technician" form is now a NamePicker (workshop technicians
// only), not a raw-paste text input.
describe('WorkshopPage - #218 name-based assign-technician picker', () => {
  it('shows only TECHNICIAN_WORKSHOP options (not field technicians) and submits the real id', async () => {
    mockUser({ roleName: 'SUPER_ADMIN' });
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({ jobCard: { ...makeWorkshopState().jobCard, status: 'SECTION_ASSIGNED', section: 'WORKSHOP', assignedWorkshopTechnicianId: null } }),
    );
    renderPage();

    await screen.findByText('Assign a workshop technician');
    expect(screen.queryByText(/paste the technician's/)).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId('name-picker-input')).not.toBeDisabled());
    fireEvent.focus(screen.getByTestId('name-picker-input'));
    expect(screen.getByText('Sanjay Rao')).toBeInTheDocument();
    expect(screen.queryByText('Ahmed Al Farsi')).not.toBeInTheDocument(); // field technician, filtered out

    fireEvent.click(screen.getByText('Sanjay Rao'));
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() => expect(vi.mocked(assignWorkshopTechnician)).toHaveBeenCalledWith('jc-1', { technicianId: 'wt-1' }));
  });

  it('falls back to a raw-paste input when the technician name list 403s', async () => {
    vi.mocked(getGanttBoard).mockRejectedValue(new Error('Forbidden'));
    mockUser({ roleName: 'SUPER_ADMIN' });
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({ jobCard: { ...makeWorkshopState().jobCard, status: 'SECTION_ASSIGNED', section: 'WORKSHOP', assignedWorkshopTechnicianId: null } }),
    );
    renderPage();

    await screen.findByText(/name list needs Team Leader access/);
    expect(screen.queryByTestId('name-picker-input')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Technician')).toBeInTheDocument();
  });
});

// 2026-09-14: canAssign/canReview/canConfirmReturn converted from hardcoded role arrays
// (ASSIGN_ROLES/RETURN_CONFIRM_ROLES, and canReview used to just be isPrivileged) to real
// capability checks via useMyCapabilities - same round as InventoryPage's equivalent fix.
// isPrivileged/canAct (the ownership bypass on start-wip/request-spare/complete/request-
// return) stays a hardcoded role array on purpose - see WorkshopPage.tsx's own comment -
// so those are NOT covered here, only the 3 capability-backed gates.
describe('WorkshopPage - capability gating (2026-09-14: converted from hardcoded role arrays)', () => {
  it('shows "Assign a workshop technician" to a non-privileged role holding WORKSHOP_ASSIGN via Designation access', async () => {
    mockUser({ roleName: 'CCE' });
    mockCapabilities(['WORKSHOP_ASSIGN']);
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({
        jobCard: { ...makeWorkshopState().jobCard, status: 'SECTION_ASSIGNED', section: 'WORKSHOP', assignedWorkshopTechnicianId: null },
      }),
    );
    renderPage();

    expect(await screen.findByText('Assign a workshop technician')).toBeInTheDocument();
  });

  it('hides "Assign a workshop technician" from a caller with no WORKSHOP_ASSIGN capability', async () => {
    mockUser({ roleName: 'CCE' });
    mockCapabilities([]);
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({
        jobCard: { ...makeWorkshopState().jobCard, status: 'SECTION_ASSIGNED', section: 'WORKSHOP', assignedWorkshopTechnicianId: null },
      }),
    );
    renderPage();

    await screen.findByText('Stale reservations on this job (0)');
    expect(screen.queryByText('Assign a workshop technician')).not.toBeInTheDocument();
  });

  it('shows Approve reallocation/Reject on a stale reservation to a non-privileged role holding INVENTORY_REVIEW', async () => {
    mockUser({ roleName: 'CCE' });
    mockCapabilities(['INVENTORY_REVIEW']);
    vi.mocked(getWorkshopState).mockResolvedValue(makeWorkshopState({ staleReservations: [makeReservation({ ageHours: 30 })] }));
    renderPage();

    expect(await screen.findByRole('button', { name: 'Approve reallocation' })).toBeInTheDocument();
  });

  it('hides Approve reallocation/Reject on a stale reservation from a caller with no INVENTORY_REVIEW capability', async () => {
    mockUser({ roleName: 'CCE' });
    mockCapabilities([]);
    vi.mocked(getWorkshopState).mockResolvedValue(makeWorkshopState({ staleReservations: [makeReservation({ ageHours: 30 })] }));
    renderPage();

    await screen.findByText(/held 30h/i);
    expect(screen.queryByRole('button', { name: 'Approve reallocation' })).not.toBeInTheDocument();
  });

  it('tells a reviewer who also holds INVENTORY_STAFF to confirm the return themselves on the Inventory tab', async () => {
    mockUser({ roleName: 'CCE' });
    mockCapabilities(['INVENTORY_REVIEW', 'INVENTORY_STAFF']);
    vi.mocked(getWorkshopState).mockResolvedValue(makeWorkshopState({ staleReservations: [makeReservation({ ageHours: 30 })] }));
    vi.mocked(reviewReservation).mockResolvedValue(makeReservation({ status: 'RETURN_PENDING' }));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Approve reallocation' }));

    expect(await screen.findByText(/Confirm the physical return on the Inventory tab/i)).toBeInTheDocument();
  });

  it('tells a reviewer without INVENTORY_STAFF that an Inventory Clerk still needs to confirm it', async () => {
    mockUser({ roleName: 'CCE' });
    mockCapabilities(['INVENTORY_REVIEW']);
    vi.mocked(getWorkshopState).mockResolvedValue(makeWorkshopState({ staleReservations: [makeReservation({ ageHours: 30 })] }));
    vi.mocked(reviewReservation).mockResolvedValue(makeReservation({ status: 'RETURN_PENDING' }));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Approve reallocation' }));

    expect(await screen.findByText(/An Inventory Clerk still needs to confirm it physically arrived back/i)).toBeInTheDocument();
  });
});
