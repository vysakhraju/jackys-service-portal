import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeAppointment, makeJobCard } from '../../test/fixtures';

vi.mock('../../lib/jobCardJourneyApi', () => ({
  searchJobCardJourney: vi.fn(),
  getJobCardJourney: vi.fn(),
}));
vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));

import { getJobCardJourney, searchJobCardJourney } from '../../lib/jobCardJourneyApi';
import { useAuth } from '../../lib/auth';
import { JobCardJourneyPage } from './JobCardJourneyPage';
import type { JobCardJourney } from '../../lib/jobCardJourneyTypes';

function mockUser(roleName: string) {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      id: 'user-1',
      firstName: 'Test',
      lastName: 'User',
      email: 't@example.com',
      employeeId: 'E1',
      status: 'ACTIVE',
      lastLoginAt: null,
      role: { id: 'r1', name: roleName, displayName: roleName },
    },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
  } as any);
}

function renderPage(initialPath = '/job-cards/journey') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <JobCardJourneyPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function makeJourney(overrides: Partial<JobCardJourney> = {}): JobCardJourney {
  return {
    jobCard: makeJobCard({ id: 'jc-120', jobCardNumber: 'JC-0120', status: 'QC_PASSED' }),
    appointment: makeAppointment(),
    visit: null,
    taskPauses: [],
    spareRequest: null,
    estimates: [],
    invoice: null,
    delivery: {
      id: 'dlv-1',
      deliveryNumber: 'DLV-0099',
      status: 'CANCELLED',
      dispatcherUserId: 'user-1',
      driverUserId: null,
      dispatchedAt: null,
      deliveredAt: null,
      podRecipientName: null,
      podNotes: null,
      cancellationReason: null,
      createdAt: '2026-09-05T10:00:00Z',
      updatedAt: '2026-09-05T10:00:00Z',
    },
    steps: [
      { key: 'scheduled', label: 'Appointment scheduled', state: 'done', at: '2026-09-01T08:00:00Z' },
      { key: 'qc_passed', label: 'QC passed', state: 'done', at: null },
      {
        key: 'delivery_cancelled',
        label: 'Delivery cancelled',
        state: 'cancelled',
        at: null,
        detail: 'This Job Card is back in the Ready for Delivery pool.',
      },
    ],
    editLock: { locked: false, allowedRoles: [], reason: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(searchJobCardJourney).mockReset();
  vi.mocked(getJobCardJourney).mockReset();
  vi.mocked(useAuth).mockReset();
  mockUser('SUPER_ADMIN');
});

describe('JobCardJourneyPage', () => {
  it('loads and renders the journey directly when a jobCardId is prefilled in the URL (e.g. from a "Journey →" link elsewhere)', async () => {
    vi.mocked(getJobCardJourney).mockResolvedValue(makeJourney());

    renderPage('/job-cards/journey?jobCardId=jc-120');

    expect(await screen.findByText('JC-0120')).toBeInTheDocument();
    expect(getJobCardJourney).toHaveBeenCalledWith('jc-120');
    // The stepper renders every step, including the cancelled-delivery marker - this is
    // the JC-0120-shaped case (QC_PASSED, delivery cancelled) the user reported.
    expect(screen.getByText('Delivery cancelled')).toBeInTheDocument();
    expect(screen.getByText(/back in the Ready for Delivery pool/)).toBeInTheDocument();
  });

  it('shows no edit-lock banner when the journey is unlocked', async () => {
    vi.mocked(getJobCardJourney).mockResolvedValue(makeJourney());

    renderPage('/job-cards/journey?jobCardId=jc-120');

    await screen.findByText('JC-0120');
    expect(screen.queryByText(/Late-stage job card/)).not.toBeInTheDocument();
  });

  it("shows the 'still editable' banner variant for a role in editLock.allowedRoles", async () => {
    mockUser('SERVICE_HEAD');
    vi.mocked(getJobCardJourney).mockResolvedValue(
      makeJourney({
        editLock: {
          locked: true,
          allowedRoles: ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER', 'ACCOUNTANT', 'FINANCE_MANAGER'],
          reason: 'This job card is QC_PASSED - further changes need Super Admin, Service Head, ...',
        },
      }),
    );

    renderPage('/job-cards/journey?jobCardId=jc-120');

    expect(await screen.findByText('Late-stage job card')).toBeInTheDocument();
    expect(screen.getByText(/This job card is QC_PASSED/)).toBeInTheDocument();
    expect(screen.queryByText('Read-only — late-stage job card')).not.toBeInTheDocument();
  });

  it("shows the read-only banner variant for a role NOT in editLock.allowedRoles", async () => {
    mockUser('TECHNICIAN_WORKSHOP');
    vi.mocked(getJobCardJourney).mockResolvedValue(
      makeJourney({
        editLock: {
          locked: true,
          allowedRoles: ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER', 'ACCOUNTANT', 'FINANCE_MANAGER'],
          reason: 'This job card is DELIVERED - further changes need Super Admin, Service Head, ...',
        },
      }),
    );

    renderPage('/job-cards/journey?jobCardId=jc-120');

    expect(await screen.findByText('Read-only — late-stage job card')).toBeInTheDocument();
  });

  it('searches by free text and lets the user pick a result to load its journey', async () => {
    const user = userEvent.setup();
    vi.mocked(searchJobCardJourney).mockResolvedValue([
      {
        jobCardId: 'jc-120',
        jobCardNumber: 'JC-0120',
        jobCardStatus: 'QC_PASSED',
        appointmentNumber: 'APT-0031',
        customerName: 'Jane Doe',
        customerPhone: '9999999999',
        deliveryNumber: 'DLV-0099',
      },
    ]);
    vi.mocked(getJobCardJourney).mockResolvedValue(makeJourney());

    renderPage();

    await user.type(screen.getByPlaceholderText(/JC-0120, APT-0031/i), '0120');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText(/APT-0031/)).toBeInTheDocument();
    await user.click(screen.getByText(/APT-0031/));

    await waitFor(() => expect(getJobCardJourney).toHaveBeenCalledWith('jc-120'));
  });

  it('shows a no-matches message for a search with no results', async () => {
    const user = userEvent.setup();
    vi.mocked(searchJobCardJourney).mockResolvedValue([]);

    renderPage();
    await user.type(screen.getByPlaceholderText(/JC-0120, APT-0031/i), 'nobody');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText(/No matches for "nobody"/)).toBeInTheDocument();
  });

  it('surfaces an error notice (not a blank page) when the journey fetch itself fails, e.g. a 404 for a bad or stale id', async () => {
    vi.mocked(getJobCardJourney).mockRejectedValue({
      isAxiosError: true,
      response: { status: 404, data: { message: 'Job Card jc-999 not found' } },
      message: 'Request failed with status code 404',
    });

    renderPage('/job-cards/journey?jobCardId=jc-999');

    expect(await screen.findByText(/Job Card jc-999 not found/)).toBeInTheDocument();
    // Never silently renders nothing, and never crashes into a blank tree - this is the
    // exact class of bug the 2026-09-08 NUMERIC-decimal fix was about avoiding elsewhere.
    expect(screen.queryByText('JC-0120')).not.toBeInTheDocument();
  });

  it('surfaces a search error notice when the search request itself fails', async () => {
    const user = userEvent.setup();
    vi.mocked(searchJobCardJourney).mockRejectedValue({
      isAxiosError: true,
      response: { status: 500, data: { message: 'Something broke' } },
      message: 'Request failed with status code 500',
    });

    renderPage();
    await user.type(screen.getByPlaceholderText(/JC-0120, APT-0031/i), 'anything');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText(/Something broke/)).toBeInTheDocument();
  });
});
