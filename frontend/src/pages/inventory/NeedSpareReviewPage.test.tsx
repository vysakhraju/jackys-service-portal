import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeNeedSpareRequest } from '../../test/fixtures';

vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/inventoryApi', () => ({
  getPendingNeedSpareRequests: vi.fn(),
  reviewNeedSpare: vi.fn(),
}));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { getPendingNeedSpareRequests, reviewNeedSpare } from '../../lib/inventoryApi';
import { NeedSpareReviewPage } from './NeedSpareReviewPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NeedSpareReviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// 2026-09-14: NeedSpareReviewPage now gates on the real capability (useMyCapabilities)
// rather than a hardcoded REVIEW_ROLES array - see NeedSpareReviewPage.tsx's own comment.
// mockCapabilities replaces the old mockUser(roleName) role-array helper.
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
  vi.mocked(getPendingNeedSpareRequests).mockReset();
  vi.mocked(getPendingNeedSpareRequests).mockResolvedValue([]);
  vi.mocked(reviewNeedSpare).mockReset();
});

describe('NeedSpareReviewPage - capability gating', () => {
  it('blocks a caller with no INVENTORY_REVIEW capability with a restricted-access notice, never fetching the list', async () => {
    mockCapabilities([]);
    renderPage();
    expect(
      await screen.findByText(/Need Spare review is restricted to Technical Team Leader/i),
    ).toBeInTheDocument();
    expect(getPendingNeedSpareRequests).not.toHaveBeenCalled();
  });

  it('allows a caller holding INVENTORY_REVIEW to see the listing - the whole point of this round\'s fix being that this is independent of role name, e.g. a role granted it only via Designation access', async () => {
    mockCapabilities(['INVENTORY_REVIEW']);
    renderPage();
    expect(await screen.findByText('Nothing waiting for review right now.')).toBeInTheDocument();
  });
});

describe('NeedSpareReviewPage - listing and review actions', () => {
  it('renders a pending request with part, job card, and requester details', async () => {
    mockCapabilities([], true);
    vi.mocked(getPendingNeedSpareRequests).mockResolvedValue([makeNeedSpareRequest()]);
    renderPage();

    expect(await screen.findByText(/2 × Drum Belt/)).toBeInTheDocument();
    expect(screen.getByText(/SP-001/)).toBeInTheDocument();
    expect(screen.getByText(/Job card JC-0001/)).toBeInTheDocument();
    expect(screen.getByText(/requested by Ravi Kumar/)).toBeInTheDocument();
  });

  it('approving calls reviewNeedSpare with APPROVE and shows the reserved outcome', async () => {
    mockCapabilities([], true);
    vi.mocked(getPendingNeedSpareRequests).mockResolvedValue([makeNeedSpareRequest()]);
    vi.mocked(reviewNeedSpare).mockResolvedValue(
      makeNeedSpareRequest({ status: 'HELD', quantityReserved: 2 }) as any,
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(reviewNeedSpare).toHaveBeenCalledWith('res-need-spare-1', { decision: 'APPROVE' });
    await waitFor(() => {
      expect(screen.getByText('Approved - stock reserved.')).toBeInTheDocument();
    });
  });

  it('a partial approval shows the partially-reserved quantity outcome', async () => {
    mockCapabilities([], true);
    vi.mocked(getPendingNeedSpareRequests).mockResolvedValue([makeNeedSpareRequest()]);
    vi.mocked(reviewNeedSpare).mockResolvedValue(
      makeNeedSpareRequest({ status: 'PARTIALLY_RESERVED', quantityReserved: 1 }) as any,
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(screen.getByText(/only 1 available, partially reserved/)).toBeInTheDocument();
    });
  });

  it('rejecting calls reviewNeedSpare with REJECT and shows the rejected outcome, hiding the action buttons', async () => {
    mockCapabilities([], true);
    vi.mocked(getPendingNeedSpareRequests).mockResolvedValue([makeNeedSpareRequest()]);
    vi.mocked(reviewNeedSpare).mockResolvedValue(makeNeedSpareRequest({ status: 'REJECTED' }) as any);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Reject' }));

    expect(reviewNeedSpare).toHaveBeenCalledWith('res-need-spare-1', { decision: 'REJECT' });
    await waitFor(() => {
      expect(screen.getByText(/the technician can request again if still needed/)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('reviewing one row of several only resolves that row, leaving the other pending', async () => {
    mockCapabilities([], true);
    const first = makeNeedSpareRequest({ id: 'res-a', sparePart: { id: 'sp-a', code: 'SP-A', name: 'Part A' } });
    const second = makeNeedSpareRequest({ id: 'res-b', sparePart: { id: 'sp-b', code: 'SP-B', name: 'Part B' } });
    vi.mocked(getPendingNeedSpareRequests).mockResolvedValue([first, second]);
    vi.mocked(reviewNeedSpare).mockResolvedValue(makeNeedSpareRequest({ id: 'res-a', status: 'HELD' }) as any);
    const user = userEvent.setup();
    renderPage();

    const rows = await screen.findAllByTestId('need-spare-row');
    expect(rows).toHaveLength(2);

    const approveButtons = screen.getAllByRole('button', { name: 'Approve' });
    await user.click(approveButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Approved - stock reserved.')).toBeInTheDocument();
    });
    // The second row's own Approve/Reject buttons are still there - only res-a resolved.
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Reject' })).toHaveLength(1);
  });
});
