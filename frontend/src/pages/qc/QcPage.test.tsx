import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeJobCard } from '../../test/fixtures';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/jobCardsApi', () => ({
  getJobCard: vi.fn(),
  qcApprove: vi.fn(),
  qcReject: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
import { getJobCard, qcApprove, qcReject } from '../../lib/jobCardsApi';
import { QcPage } from './QcPage';

function renderPage(jobCardId = 'jc-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/qc-permissions/qc?jobCardId=${jobCardId}`]}>
        <QcPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

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

beforeEach(() => {
  vi.mocked(getJobCard).mockReset();
  vi.mocked(qcApprove).mockReset();
  vi.mocked(qcReject).mockReset();
});

describe('QcPage - role-floor gating (the-fool pre-mortem finding #1)', () => {
  it('hides Approve/Reject and explains why for a role outside QC_GATE_ROLES', async () => {
    mockUser('TECHNICIAN_WORKSHOP');
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard({ status: 'READY_FOR_QC' }));
    renderPage();
    expect(await screen.findByText(/isn't one the backend allows to attempt QC approval\/rejection/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve → QC Passed/i })).not.toBeInTheDocument();
  });

  it('shows Approve/Reject for a QC_GATE_ROLES member (grant itself is checked server-side, not here)', async () => {
    mockUser('QC_OFFICER');
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard({ status: 'READY_FOR_QC' }));
    renderPage();
    expect(await screen.findByRole('button', { name: /Approve → QC Passed/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Reject$/i })).toBeInTheDocument();
  });
});

describe('QcPage - phase boundaries', () => {
  it('links back to Workshop for a job not yet READY_FOR_QC', async () => {
    mockUser('QC_OFFICER');
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard({ status: 'IN_PROGRESS' }));
    renderPage();
    expect(await screen.findByText(/not yet READY_FOR_QC/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve → QC Passed/i })).not.toBeInTheDocument();
  });

  it('shows a past-this-screen note for a QC_PASSED job', async () => {
    mockUser('QC_OFFICER');
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard({ status: 'QC_PASSED' }));
    renderPage();
    expect(await screen.findByText(/past what this screen covers/i)).toBeInTheDocument();
  });
});

describe('QcPage - Approve (the-fool pre-mortem finding #2: structured 409 blockers)', () => {
  it('renders each blocker from a 409 stock-shortfall response, not just the raw message', async () => {
    mockUser('QC_OFFICER');
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard({ status: 'READY_FOR_QC' }));
    vi.mocked(qcApprove).mockRejectedValue({
      response: {
        status: 409,
        data: {
          message: 'Insufficient stock to consume reservations',
          blockers: [{ reservationId: 'res-1', sparePartId: 'sp-1', quantityRequested: 3, quantityReserved: 1 }],
        },
      },
    });
    const user = userEvent.setup();
    renderPage();
    const approveButton = await screen.findByRole('button', { name: /Approve → QC Passed/i });
    await user.click(approveButton);
    expect(await screen.findByText(/Blocked - stock isn't there to consume for 1 reservation/i)).toBeInTheDocument();
    expect(screen.getByText(/reserved 1 of 3 requested/i)).toBeInTheDocument();
    expect(screen.getByText(/Go to the Workshop screen to top up or resolve/i)).toBeInTheDocument();
  });

  it('calls qcApprove with the job card id on click', async () => {
    mockUser('QC_OFFICER');
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard({ id: 'jc-42', status: 'READY_FOR_QC' }));
    vi.mocked(qcApprove).mockResolvedValue(makeJobCard({ id: 'jc-42', status: 'QC_PASSED' }));
    const user = userEvent.setup();
    renderPage('jc-42');
    const approveButton = await screen.findByRole('button', { name: /Approve → QC Passed/i });
    await user.click(approveButton);
    await waitFor(() => expect(qcApprove).toHaveBeenCalledWith('jc-42'));
  });
});

describe('QcPage - Reject (the-fool pre-mortem finding #3: no dead end)', () => {
  it('shows a link back to Workshop after a successful reject, not a dead end', async () => {
    mockUser('QC_OFFICER');
    vi.mocked(getJobCard).mockResolvedValue(makeJobCard({ id: 'jc-9', status: 'READY_FOR_QC' }));
    vi.mocked(qcReject).mockResolvedValue(makeJobCard({ id: 'jc-9', status: 'IN_PROGRESS', qcRejectionCount: 1 }));
    const user = userEvent.setup();
    renderPage('jc-9');
    const reasonInput = await screen.findByLabelText(/Rejection reason/i);
    await user.type(reasonInput, 'Drum still noisy');
    await user.click(screen.getByRole('button', { name: /^Reject$/i }));
    expect(await screen.findByText(/back to IN_PROGRESS/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Workshop screen/i })).toHaveAttribute(
      'href',
      '/workshop-inventory/workshop?jobCardId=jc-9',
    );
    expect(qcReject).toHaveBeenCalledWith('jc-9', { reason: 'Drum still noisy' });
  });
});
