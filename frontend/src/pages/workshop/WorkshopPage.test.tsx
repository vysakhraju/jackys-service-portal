import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
}));
vi.mock('../../lib/inventoryApi', () => ({
  requestReturn: vi.fn(),
  reviewReservation: vi.fn(),
}));
vi.mock('../../lib/masterDataApi', () => ({
  listSpareParts: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
import { getWorkshopState } from '../../lib/workshopApi';
import { listSpareParts } from '../../lib/masterDataApi';
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
