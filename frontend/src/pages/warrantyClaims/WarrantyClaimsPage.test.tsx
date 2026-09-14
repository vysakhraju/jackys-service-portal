import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeRecoveryRate, makeWarrantyClaim, makeWarrantyClaimLine } from '../../test/fixtures';

vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/warrantyClaimsApi', () => ({
  aggregateWarrantyClaim: vi.fn(),
  listWarrantyClaims: vi.fn(),
  getWarrantyClaim: vi.fn(),
  submitWarrantyClaim: vi.fn(),
  cancelWarrantyClaim: vi.fn(),
  recordWarrantyClaimCreditNote: vi.fn(),
  getWarrantyClaimRecoveryRate: vi.fn(),
}));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import {
  aggregateWarrantyClaim,
  cancelWarrantyClaim,
  getWarrantyClaim,
  getWarrantyClaimRecoveryRate,
  listWarrantyClaims,
  recordWarrantyClaimCreditNote,
  submitWarrantyClaim,
} from '../../lib/warrantyClaimsApi';
import { WarrantyClaimsPage } from './WarrantyClaimsPage';

// 2026-09-14: WarrantyClaimsPage now gates on the real capability (useMyCapabilities)
// rather than three hardcoded role arrays - see warrantyClaimsTypes.ts's own comment.
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

function renderPage(initialEntry = '/warranty-claims') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <WarrantyClaimsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(aggregateWarrantyClaim).mockReset();
  vi.mocked(listWarrantyClaims).mockReset().mockResolvedValue([]);
  vi.mocked(getWarrantyClaim).mockReset();
  vi.mocked(submitWarrantyClaim).mockReset();
  vi.mocked(cancelWarrantyClaim).mockReset();
  vi.mocked(recordWarrantyClaimCreditNote).mockReset();
  vi.mocked(getWarrantyClaimRecoveryRate).mockReset().mockResolvedValue(makeRecoveryRate());
  mockCapabilities([], true);
});

describe('WarrantyClaimsPage - capability gate (2026-09-14: converted from three hardcoded role arrays)', () => {
  it('shows a restricted message and fires no queries for a caller with no WARRANTY_CLAIMS_VIEW capability', async () => {
    mockCapabilities([]);
    renderPage();

    expect(await screen.findByText(/restricted to Warranty Clerk/)).toBeInTheDocument();
    expect(listWarrantyClaims).not.toHaveBeenCalled();
    expect(getWarrantyClaimRecoveryRate).not.toHaveBeenCalled();
  });

  it.each([
    ['a caller holding WARRANTY_CLAIMS_VIEW', ['WARRANTY_CLAIMS_VIEW'], false],
    ['a full-access caller (SUPER_ADMIN/SERVICE_HEAD bypass)', [], true],
  ])('permits %s to view', async (_label, capabilities, fullAccess) => {
    mockCapabilities(capabilities as string[], fullAccess as boolean);
    renderPage();
    await screen.findByText('Warranty Claims');
    expect(screen.queryByText(/restricted to Warranty Clerk/)).not.toBeInTheDocument();
  });

  it('permits view for a role granted WARRANTY_CLAIMS_VIEW via Designation access, not just a default role', async () => {
    // The whole point of this round's fix: a role with no default membership in
    // WARRANTY_CLAIMS_VIEW sees the page once Super Admin ticks the capability for them -
    // proven here by mocking the capability directly, independent of role name.
    mockCapabilities(['WARRANTY_CLAIMS_VIEW']);
    renderPage();
    await screen.findByText('Warranty Claims');
    expect(screen.queryByText(/restricted to Warranty Clerk/)).not.toBeInTheDocument();
  });
});

describe('WarrantyClaimsPage - list + filters + recovery rate', () => {
  it('lists claims and shows the recovery rate widget', async () => {
    vi.mocked(listWarrantyClaims).mockResolvedValue([makeWarrantyClaim()]);
    renderPage();
    expect(await screen.findByText('WCLM-0001')).toBeInTheDocument();
    // 82.35 rounds down to 82.3 via Number.prototype.toFixed (float representation).
    expect(screen.getByText('82.3%')).toBeInTheDocument();
  });

  it('shows "—" for the recovery rate when nothing has been claimed yet', async () => {
    vi.mocked(getWarrantyClaimRecoveryRate).mockResolvedValue(makeRecoveryRate({ rate: null, totalClaimed: 0, totalRecovered: 0 }));
    renderPage();
    await screen.findByText('No warranty claims match this filter.');
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('refetches with the status filter when a status button is clicked', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No warranty claims match this filter.');
    await user.click(screen.getByRole('button', { name: 'SUBMITTED' }));
    await waitFor(() => expect(listWarrantyClaims).toHaveBeenLastCalledWith({ status: 'SUBMITTED', supplier: undefined }));
  });

  it('refetches with the supplier filter when typed', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No warranty claims match this filter.');
    await user.type(screen.getByLabelText('Supplier'), 'Samsung Gulf FZE');
    await waitFor(() => expect(listWarrantyClaims).toHaveBeenLastCalledWith({ status: undefined, supplier: 'Samsung Gulf FZE' }));
  });

  it('shows "+ New Claim" only for a clerk-level role', async () => {
    renderPage();
    await screen.findByText('No warranty claims match this filter.');
    expect(screen.getByRole('button', { name: '+ New Claim' })).toBeInTheDocument();
  });

  it('hides "+ New Claim" for a view-only role (ACCOUNTANT)', async () => {
    mockCapabilities(['WARRANTY_CLAIMS_VIEW']);
    renderPage();
    await screen.findByText('No warranty claims match this filter.');
    expect(screen.queryByRole('button', { name: '+ New Claim' })).not.toBeInTheDocument();
  });
});

describe('WarrantyClaimsPage - aggregate (create) form', () => {
  it('generates a claim and navigates ?claimId= to the new claim', async () => {
    vi.mocked(aggregateWarrantyClaim).mockResolvedValue(makeWarrantyClaim({ id: 'new-1', claimNumber: 'WCLM-0099' }));
    vi.mocked(getWarrantyClaim).mockResolvedValue(makeWarrantyClaim({ id: 'new-1', claimNumber: 'WCLM-0099' }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No warranty claims match this filter.');

    await user.click(screen.getByRole('button', { name: '+ New Claim' }));
    // The page has two "Supplier" fields at once (the list filter and this modal) - the
    // modal's own hint text ("Must match JobCard.warrantySupplier exactly") is what makes
    // its accessible name unique.
    await user.type(screen.getByLabelText(/Must match JobCard.warrantySupplier exactly/), 'LG Gulf');
    await user.type(screen.getByLabelText('Period start'), '2026-08-01');
    await user.type(screen.getByLabelText('Period end'), '2026-08-31');
    await user.click(screen.getByRole('button', { name: 'Generate Claim' }));

    expect(aggregateWarrantyClaim).toHaveBeenCalledWith({ supplier: 'LG Gulf', periodStart: '2026-08-01', periodEnd: '2026-08-31' });
    await waitFor(() => expect(getWarrantyClaim).toHaveBeenCalledWith('new-1'));
    expect(await screen.findByText('WCLM-0099')).toBeInTheDocument();
  });

  it('shows the backend error when nothing unclaimed is found for that vendor/period', async () => {
    vi.mocked(aggregateWarrantyClaim).mockRejectedValue({
      response: { data: { message: 'No unclaimed CONSUMED warranty spares found for LG Gulf in this period.' } },
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No warranty claims match this filter.');

    await user.click(screen.getByRole('button', { name: '+ New Claim' }));
    await user.type(screen.getByLabelText(/Must match JobCard.warrantySupplier exactly/), 'LG Gulf');
    await user.type(screen.getByLabelText('Period start'), '2026-08-01');
    await user.type(screen.getByLabelText('Period end'), '2026-08-31');
    await user.click(screen.getByRole('button', { name: 'Generate Claim' }));

    expect(await screen.findByText(/No unclaimed CONSUMED warranty spares found/)).toBeInTheDocument();
  });
});

describe('WarrantyClaimsPage - detail: status-gated actions', () => {
  it('shows Mark Submitted and Cancel (not Record Credit Note) on a DRAFT claim', async () => {
    vi.mocked(getWarrantyClaim).mockResolvedValue(makeWarrantyClaim({ id: 'c1', status: 'DRAFT' }));
    renderPage('/warranty-claims?claimId=c1');

    await screen.findByText('WCLM-0001');
    expect(screen.getByRole('button', { name: 'Mark Submitted' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record Credit Note' })).not.toBeInTheDocument();
  });

  it('shows Record Credit Note (not Mark Submitted or Cancel) on a SUBMITTED claim', async () => {
    // Default beforeEach is full-access (SERVICE_HEAD bypass), which is clerk-level
    // (submit/cancel) but not credit-note-level in real usage - use an explicit
    // WARRANTY_CLAIMS_VIEW + CREDIT_NOTE_POST mock so the Record Credit Note button is
    // actually permitted (and clerk-only actions are NOT, proving the split is real).
    mockCapabilities(['WARRANTY_CLAIMS_VIEW', 'CREDIT_NOTE_POST']);
    vi.mocked(getWarrantyClaim).mockResolvedValue(makeWarrantyClaim({ id: 'c1', status: 'SUBMITTED', claimReferenceNumber: 'VENDOR-1' }));
    renderPage('/warranty-claims?claimId=c1');

    await screen.findByText('WCLM-0001');
    expect(screen.getByRole('button', { name: 'Record Credit Note' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark Submitted' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('shows no action buttons at all on a CREDIT_RECEIVED claim', async () => {
    vi.mocked(getWarrantyClaim).mockResolvedValue(
      makeWarrantyClaim({ id: 'c1', status: 'CREDIT_RECEIVED', creditNoteNumber: 'CN-1', creditNoteAmount: 80 }),
    );
    renderPage('/warranty-claims?claimId=c1');

    await screen.findByText('WCLM-0001');
    expect(screen.queryByRole('button', { name: 'Mark Submitted' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record Credit Note' })).not.toBeInTheDocument();
  });

  it('never shows Record Credit Note to a clerk-only caller, even on a SUBMITTED claim', async () => {
    mockCapabilities(['WARRANTY_CLAIMS_VIEW', 'WARRANTY_CLAIMS_CLERK']);
    vi.mocked(getWarrantyClaim).mockResolvedValue(makeWarrantyClaim({ id: 'c1', status: 'SUBMITTED' }));
    renderPage('/warranty-claims?claimId=c1');

    await screen.findByText('WCLM-0001');
    expect(screen.queryByRole('button', { name: 'Record Credit Note' })).not.toBeInTheDocument();
  });

  it('never shows Mark Submitted/Cancel to a credit-note-only caller, even on a DRAFT claim', async () => {
    mockCapabilities(['WARRANTY_CLAIMS_VIEW', 'CREDIT_NOTE_POST']);
    vi.mocked(getWarrantyClaim).mockResolvedValue(makeWarrantyClaim({ id: 'c1', status: 'DRAFT' }));
    renderPage('/warranty-claims?claimId=c1');

    await screen.findByText('WCLM-0001');
    expect(screen.queryByRole('button', { name: 'Mark Submitted' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });
});

describe('WarrantyClaimsPage - submit action', () => {
  it('submits a claim reference number and closes the modal on success', async () => {
    vi.mocked(getWarrantyClaim).mockResolvedValue(makeWarrantyClaim({ id: 'c1', status: 'DRAFT' }));
    vi.mocked(submitWarrantyClaim).mockResolvedValue(makeWarrantyClaim({ id: 'c1', status: 'SUBMITTED' }));
    const user = userEvent.setup();
    renderPage('/warranty-claims?claimId=c1');

    await screen.findByText('WCLM-0001');
    await user.click(screen.getByRole('button', { name: 'Mark Submitted' }));
    await user.type(screen.getByLabelText('Vendor claim reference number'), 'VENDOR-CLM-2026-0912');
    // The trigger button behind the modal shares the same accessible name as the modal's
    // own submit button - the modal's is the one added later in the DOM.
    const submitButtons = screen.getAllByRole('button', { name: 'Mark Submitted' });
    await user.click(submitButtons[submitButtons.length - 1]);

    expect(submitWarrantyClaim).toHaveBeenCalledWith('c1', { claimReferenceNumber: 'VENDOR-CLM-2026-0912', notes: undefined });
  });

  it('disables the submit button until a reference number is entered', async () => {
    vi.mocked(getWarrantyClaim).mockResolvedValue(makeWarrantyClaim({ id: 'c1', status: 'DRAFT' }));
    const user = userEvent.setup();
    renderPage('/warranty-claims?claimId=c1');

    await screen.findByText('WCLM-0001');
    await user.click(screen.getByRole('button', { name: 'Mark Submitted' }));
    const buttons = screen.getAllByRole('button', { name: 'Mark Submitted' });
    expect(buttons[buttons.length - 1]).toBeDisabled();
  });
});

describe('WarrantyClaimsPage - credit note action', () => {
  it('records a credit note with number and amount', async () => {
    // Default beforeEach is full-access (SERVICE_HEAD bypass) - use an explicit
    // CREDIT_NOTE_POST mock so this proves the capability itself gates the action, not
    // just the bypass.
    mockCapabilities(['WARRANTY_CLAIMS_VIEW', 'CREDIT_NOTE_POST']);
    vi.mocked(getWarrantyClaim).mockResolvedValue(makeWarrantyClaim({ id: 'c1', status: 'SUBMITTED' }));
    vi.mocked(recordWarrantyClaimCreditNote).mockResolvedValue(makeWarrantyClaim({ id: 'c1', status: 'CREDIT_RECEIVED' }));
    const user = userEvent.setup();
    renderPage('/warranty-claims?claimId=c1');

    await screen.findByText('WCLM-0001');
    await user.click(screen.getByRole('button', { name: 'Record Credit Note' }));
    await user.type(screen.getByLabelText('Vendor credit note number'), 'CN-2026-4471');
    await user.type(screen.getByLabelText('Amount credited (AED)'), '70');
    // Same trigger-vs-modal-button name collision as the Mark Submitted test above.
    const recordButtons = screen.getAllByRole('button', { name: 'Record Credit Note' });
    await user.click(recordButtons[recordButtons.length - 1]);

    expect(recordWarrantyClaimCreditNote).toHaveBeenCalledWith('c1', { creditNoteNumber: 'CN-2026-4471', creditNoteAmount: 70 });
  });

  it('does not allow a zero or negative credit amount', async () => {
    mockCapabilities(['WARRANTY_CLAIMS_VIEW', 'CREDIT_NOTE_POST']);
    vi.mocked(getWarrantyClaim).mockResolvedValue(makeWarrantyClaim({ id: 'c1', status: 'SUBMITTED' }));
    const user = userEvent.setup();
    renderPage('/warranty-claims?claimId=c1');

    await screen.findByText('WCLM-0001');
    await user.click(screen.getByRole('button', { name: 'Record Credit Note' }));
    await user.type(screen.getByLabelText('Vendor credit note number'), 'CN-1');
    await user.type(screen.getByLabelText('Amount credited (AED)'), '0');
    const buttons = screen.getAllByRole('button', { name: 'Record Credit Note' });
    expect(buttons[buttons.length - 1]).toBeDisabled();
  });
});

describe('WarrantyClaimsPage - cancel action', () => {
  it('cancels a DRAFT claim with a reason', async () => {
    vi.mocked(getWarrantyClaim).mockResolvedValue(makeWarrantyClaim({ id: 'c1', status: 'DRAFT' }));
    vi.mocked(cancelWarrantyClaim).mockResolvedValue(makeWarrantyClaim({ id: 'c1', status: 'CANCELLED', cancellationReason: 'Wrong period' }));
    const user = userEvent.setup();
    renderPage('/warranty-claims?claimId=c1');

    await screen.findByText('WCLM-0001');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.type(screen.getByLabelText(/Reason/), 'Wrong period');
    await user.click(screen.getByRole('button', { name: 'Cancel claim' }));

    expect(cancelWarrantyClaim).toHaveBeenCalledWith('c1', 'Wrong period');
  });

  it('requires at least 2 characters for the cancellation reason', async () => {
    vi.mocked(getWarrantyClaim).mockResolvedValue(makeWarrantyClaim({ id: 'c1', status: 'DRAFT' }));
    const user = userEvent.setup();
    renderPage('/warranty-claims?claimId=c1');

    await screen.findByText('WCLM-0001');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.type(screen.getByLabelText(/Reason/), 'x');
    expect(screen.getByRole('button', { name: 'Cancel claim' })).toBeDisabled();
  });
});

describe('WarrantyClaimsPage - lines table', () => {
  it('renders claim lines with job card, spare part, and amounts', async () => {
    vi.mocked(getWarrantyClaim).mockResolvedValue(
      makeWarrantyClaim({ id: 'c1', lines: [makeWarrantyClaimLine({ jobCardNumber: 'JC-0042', sparePartCode: 'SP-777' })] }),
    );
    renderPage('/warranty-claims?claimId=c1');

    await screen.findByText('WCLM-0001');
    expect(screen.getByText('JC-0042')).toBeInTheDocument();
    expect(screen.getByText(/SP-777/)).toBeInTheDocument();
  });

  it('shows an empty state when a claim somehow has no lines', async () => {
    vi.mocked(getWarrantyClaim).mockResolvedValue(makeWarrantyClaim({ id: 'c1', lines: [] }));
    renderPage('/warranty-claims?claimId=c1');

    await screen.findByText('WCLM-0001');
    expect(screen.getByText('No lines on this claim.')).toBeInTheDocument();
  });
});
