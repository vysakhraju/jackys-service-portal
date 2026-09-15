import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeReadyRow } from '../../test/fixtures';

vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/deliveryApi', () => ({
  getReadyForDelivery: vi.fn(),
  createDelivery: vi.fn(),
}));
vi.mock('../../lib/invoicingApi', () => ({
  getInvoiceByJobCard: vi.fn(),
  getInvoice: vi.fn(),
  recordPayment: vi.fn(),
}));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { createDelivery, getReadyForDelivery } from '../../lib/deliveryApi';
import { ReadyForDeliveryPage } from './ReadyForDeliveryPage';

function renderPage(warranty: 'IW' | 'OOW' = 'IW') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/delivery/ready?warranty=${warranty}`]}>
        <ReadyForDeliveryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// 2026-09-14: ReadyForDeliveryPage now gates on the real capability (useMyCapabilities)
// rather than a hardcoded DELIVERY_ROLES role array - see ReadyForDeliveryPage.tsx's own
// comment. mockCapabilities replaces the old mockUser(roleName) role-array helper.
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
  vi.mocked(getReadyForDelivery).mockReset();
  vi.mocked(createDelivery).mockReset();
});

describe('ReadyForDeliveryPage - capability gate (2026-09-14: converted from a hardcoded role array)', () => {
  it('shows a read-only notice and no Create Delivery button for a caller with no DELIVERY_MANAGE capability', async () => {
    mockCapabilities([]);
    vi.mocked(getReadyForDelivery).mockResolvedValue([makeReadyRow()]);
    renderPage();
    expect(await screen.findByText(/can't create or manage deliveries/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create Delivery/i })).not.toBeInTheDocument();
  });

  it('shows the Create Delivery button for a caller holding DELIVERY_MANAGE', async () => {
    mockCapabilities(['DELIVERY_MANAGE']);
    vi.mocked(getReadyForDelivery).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByRole('button', { name: /Create Delivery/i })).toBeInTheDocument();
  });

  it('shows the Create Delivery button for a role granted DELIVERY_MANAGE via Designation access, not just a default DELIVERY_ROLES role', async () => {
    // The whole point of this round's fix: a role with no default membership in
    // DELIVERY_MANAGE (e.g. CCE) sees the button once Super Admin ticks the capability for
    // them - proven here by mocking the capability directly, independent of role name.
    mockCapabilities(['DELIVERY_MANAGE']);
    vi.mocked(getReadyForDelivery).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByRole('button', { name: /Create Delivery/i })).toBeInTheDocument();
  });
});

const NO_FILTERS = { dateFrom: undefined, dateTo: undefined, q: undefined };

describe('ReadyForDeliveryPage - IW/OOW tabs', () => {
  it('requests IN_WARRANTY jobs as "IW" and does not show an Invoice column', async () => {
    mockCapabilities(['DELIVERY_MANAGE']);
    vi.mocked(getReadyForDelivery).mockResolvedValue([
      makeReadyRow({ jobCard: makeReadyRow().jobCard, invoiceStatus: null, payable: true }),
    ]);
    renderPage('IW');
    await screen.findByText(/JC-0001/);
    expect(getReadyForDelivery).toHaveBeenCalledWith('IW', NO_FILTERS);
    expect(screen.queryByText(/Check invoice/i)).not.toBeInTheDocument();
  });

  it('requests OUT_OF_WARRANTY jobs as "OOW" and shows invoice status per row', async () => {
    mockCapabilities(['DELIVERY_MANAGE']);
    vi.mocked(getReadyForDelivery).mockResolvedValue([makeReadyRow({ invoiceStatus: 'PAID', payable: true })]);
    renderPage('OOW');
    await screen.findByText(/JC-0001/);
    expect(getReadyForDelivery).toHaveBeenCalledWith('OOW', NO_FILTERS);
    expect(screen.getByText('PAID')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View \/ pay/i })).toBeInTheDocument();
  });

  it('switching tabs re-queries with the new warranty status', async () => {
    mockCapabilities(['DELIVERY_MANAGE']);
    vi.mocked(getReadyForDelivery).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage('IW');
    await user.click(screen.getByRole('button', { name: /Out of Warranty/i }));
    expect(getReadyForDelivery).toHaveBeenCalledWith('OOW', NO_FILTERS);
  });
});

// Modification Request (2026-09-15): date range + search filters, new columns, and the
// per-row "Create Delivery" pill (distinct from the batch button below by accessible name -
// the pill carries an aria-label with the job card number so getByRole('button', { name:
// 'Create Delivery' }) - an exact match - still finds only the batch button even with rows
// on screen).
describe('ReadyForDeliveryPage - Modification Request (2026-09-15): filters, new columns, per-row pill', () => {
  it('shows Customer Type/Brand/Model/Created columns using the job card appointment data', async () => {
    mockCapabilities(['DELIVERY_MANAGE']);
    vi.mocked(getReadyForDelivery).mockResolvedValue([makeReadyRow()]);
    renderPage('IW');

    await screen.findByText(/JC-0001/);
    expect(screen.getByText('B2C')).toBeInTheDocument();
    expect(screen.getByText('Samsung')).toBeInTheDocument();
    expect(screen.getByText('WA80J5710')).toBeInTheDocument();
    expect(screen.getByText('01-Aug-26')).toBeInTheDocument(); // jobCard.createdAt fixture: 2026-08-01
  });

  it('"Today" sets both From/To date to today and re-queries with them', async () => {
    mockCapabilities(['DELIVERY_MANAGE']);
    vi.mocked(getReadyForDelivery).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage('IW');

    await user.click(screen.getByRole('button', { name: 'Today' }));

    const today = new Date().toISOString().slice(0, 10);
    await vi.waitFor(() => {
      expect(getReadyForDelivery).toHaveBeenLastCalledWith('IW', { dateFrom: today, dateTo: today, q: undefined });
    });
  });

  it('does not search until 2+ characters are typed, then debounces the query', async () => {
    mockCapabilities(['DELIVERY_MANAGE']);
    vi.mocked(getReadyForDelivery).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage('IW');
    vi.mocked(getReadyForDelivery).mockClear();

    await user.type(screen.getByPlaceholderText('Search…'), 'J');
    await new Promise((r) => setTimeout(r, 350));
    expect(getReadyForDelivery).not.toHaveBeenCalledWith('IW', expect.objectContaining({ q: 'J' }));

    await user.type(screen.getByPlaceholderText('Search…'), 'C');
    await vi.waitFor(() => {
      expect(getReadyForDelivery).toHaveBeenCalledWith('IW', { dateFrom: undefined, dateTo: undefined, q: 'JC' });
    });
  });

  it('a row\'s Create Delivery pill posts just that one job card, independent of any checkbox selection', async () => {
    mockCapabilities(['DELIVERY_MANAGE']);
    vi.mocked(getReadyForDelivery).mockResolvedValue([
      makeReadyRow({ jobCard: makeReadyRow().jobCard }),
      makeReadyRow({ jobCard: { ...makeReadyRow().jobCard, id: 'jc-2', jobCardNumber: 'JC-0002' } }),
    ]);
    vi.mocked(createDelivery).mockResolvedValue({
      delivery: { id: 'del-2', deliveryNumber: 'DLV-0002' } as any,
      jobCards: [{ id: 'jc-2' } as any],
    });
    const user = userEvent.setup();
    renderPage('IW');
    await screen.findByText(/JC-0002/);

    await user.click(screen.getByRole('button', { name: /Create delivery for JC-0002/i }));

    expect(createDelivery).toHaveBeenCalledWith({ jobCardIds: ['jc-2'] });
    expect(await screen.findByText(/DLV-0002/)).toBeInTheDocument();
    // The batch button (exact name "Create Delivery") is untouched - no checkbox was ticked.
    expect(screen.getByRole('button', { name: 'Create Delivery' })).toBeDisabled();
  });
});

describe('ReadyForDeliveryPage - batch select and create', () => {
  it('disables Create Delivery until at least one row is selected, then posts the selected ids', async () => {
    mockCapabilities(['DELIVERY_MANAGE']);
    vi.mocked(getReadyForDelivery).mockResolvedValue([
      makeReadyRow({ jobCard: makeReadyRow().jobCard }),
      makeReadyRow({ jobCard: { ...makeReadyRow().jobCard, id: 'jc-2', jobCardNumber: 'JC-0002' } }),
    ]);
    vi.mocked(createDelivery).mockResolvedValue({
      delivery: { id: 'del-1', deliveryNumber: 'DLV-0001' } as any,
      jobCards: [{ id: 'jc-1' } as any],
    });
    const user = userEvent.setup();
    renderPage('IW');
    await screen.findByText(/JC-0001/);

    // Exact-name match: the batch button's accessible name is exactly "Create Delivery",
    // while each row's pill carries a job-card-specific aria-label (see the Modification
    // Request describe block below) - this is how the two stay distinguishable now that
    // both exist on screen at once.
    const createButton = screen.getByRole('button', { name: 'Create Delivery' });
    expect(createButton).toBeDisabled();

    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);
    expect(createButton).not.toBeDisabled();

    await user.click(createButton);
    expect(createDelivery).toHaveBeenCalledWith({ jobCardIds: ['jc-1'] });
    // Not a bare /Created/ match - the new "Created Date" column header also contains that
    // substring, so this targets the success banner's own delivery-number text instead.
    expect(await screen.findByText(/DLV-0001/)).toBeInTheDocument();
  });

  it('renders each blocker from a 409 unpaid-OOW response with an amount and a Record payment action', async () => {
    mockCapabilities(['DELIVERY_MANAGE']);
    vi.mocked(getReadyForDelivery).mockResolvedValue([makeReadyRow({ invoiceStatus: 'DRAFT', payable: false })]);
    vi.mocked(createDelivery).mockRejectedValue({
      response: {
        status: 409,
        data: {
          message: 'Cannot create delivery: one or more out-of-warranty Job Cards are unpaid',
          blockers: [{ jobCardId: 'jc-1', jobCardNumber: 'JC-0001', invoiceId: 'inv-1', invoiceStatus: 'DRAFT', amount: 367.5 }],
        },
      },
    });
    const user = userEvent.setup();
    renderPage('OOW');
    await screen.findByText(/JC-0001/);
    await user.click(screen.getAllByRole('checkbox')[0]);
    await user.click(screen.getByRole('button', { name: 'Create Delivery' }));

    expect(await screen.findByText(/1 out-of-warranty job is unpaid/i)).toBeInTheDocument();
    expect(screen.getByText(/DRAFT, AED 367.50 owed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Record payment/i })).toBeInTheDocument();
  });
});
