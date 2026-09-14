import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeReservation, makeWorkshopState } from '../../test/fixtures';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
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

import { useAuth } from '../../lib/auth';
import { assignWorkshopTechnician, getWorkshopState, listReworkApprovers, requestSpare } from '../../lib/workshopApi';
import { listSpareParts } from '../../lib/masterDataApi';
import { getGanttBoard } from '../../lib/technicianScheduleApi';
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

beforeEach(() => {
  vi.mocked(getWorkshopState).mockReset();
  vi.mocked(listSpareParts).mockReset();
  vi.mocked(listSpareParts).mockResolvedValue([]);
  vi.mocked(assignWorkshopTechnician).mockReset();
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
    vi.mocked(getWorkshopState).mockResolvedValue({
      jobCard: { ...makeWorkshopState().jobCard, status: 'READY_FOR_QC' },
      staleReservations: [],
    });
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
    vi.mocked(getWorkshopState).mockResolvedValue({
      jobCard: { ...makeWorkshopState().jobCard, qcRejectionCount: 1 },
      staleReservations: [],
    });
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
    vi.mocked(getWorkshopState).mockResolvedValue({
      jobCard: { ...makeWorkshopState().jobCard, qcRejectionCount: 1 },
      staleReservations: [],
    });
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
  it('lists a stale reservation with its age and explains the visibility limit (finding #2)', async () => {
    mockUser({ id: 'tech-1', roleName: 'TECHNICIAN_WORKSHOP' });
    vi.mocked(getWorkshopState).mockResolvedValue(
      makeWorkshopState({ staleReservations: [makeReservation({ ageHours: 30 })] }),
    );
    renderPage();
    expect(await screen.findByText(/held 30h/i)).toBeInTheDocument();
    expect(
      screen.getByText(/won't appear until it goes stale/i),
    ).toBeInTheDocument();
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
