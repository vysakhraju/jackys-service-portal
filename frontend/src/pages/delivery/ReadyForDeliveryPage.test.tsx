import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeReadyRow } from '../../test/fixtures';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/deliveryApi', () => ({
  getReadyForDelivery: vi.fn(),
  createDelivery: vi.fn(),
}));
vi.mock('../../lib/invoicingApi', () => ({
  getInvoiceByJobCard: vi.fn(),
  getInvoice: vi.fn(),
  recordPayment: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
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
  vi.mocked(getReadyForDelivery).mockReset();
  vi.mocked(createDelivery).mockReset();
});

describe('ReadyForDeliveryPage - role gate', () => {
  it('shows a read-only notice and no Create Delivery button for a role outside DELIVERY_ROLES', async () => {
    mockUser('ACCOUNTANT');
    vi.mocked(getReadyForDelivery).mockResolvedValue([makeReadyRow()]);
    renderPage();
    expect(await screen.findByText(/can't create or manage deliveries/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create Delivery/i })).not.toBeInTheDocument();
  });

  it('shows the Create Delivery button for a DELIVERY_ROLES member', async () => {
    mockUser('LOGISTICS_DISPATCHER');
    vi.mocked(getReadyForDelivery).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByRole('button', { name: /Create Delivery/i })).toBeInTheDocument();
  });
});

describe('ReadyForDeliveryPage - IW/OOW tabs', () => {
  it('requests IN_WARRANTY jobs as "IW" and does not show an Invoice column', async () => {
    mockUser('LOGISTICS_DISPATCHER');
    vi.mocked(getReadyForDelivery).mockResolvedValue([
      makeReadyRow({ jobCard: makeReadyRow().jobCard, invoiceStatus: null, payable: true }),
    ]);
    renderPage('IW');
    await screen.findByText(/JC-0001/);
    expect(getReadyForDelivery).toHaveBeenCalledWith('IW');
    expect(screen.queryByText(/Check invoice/i)).not.toBeInTheDocument();
  });

  it('requests OUT_OF_WARRANTY jobs as "OOW" and shows invoice status per row', async () => {
    mockUser('LOGISTICS_DISPATCHER');
    vi.mocked(getReadyForDelivery).mockResolvedValue([makeReadyRow({ invoiceStatus: 'PAID', payable: true })]);
    renderPage('OOW');
    await screen.findByText(/JC-0001/);
    expect(getReadyForDelivery).toHaveBeenCalledWith('OOW');
    expect(screen.getByText('PAID')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View \/ pay/i })).toBeInTheDocument();
  });

  it('switching tabs re-queries with the new warranty status', async () => {
    mockUser('LOGISTICS_DISPATCHER');
    vi.mocked(getReadyForDelivery).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage('IW');
    await user.click(screen.getByRole('button', { name: /Out of Warranty/i }));
    expect(getReadyForDelivery).toHaveBeenCalledWith('OOW');
  });
});

describe('ReadyForDeliveryPage - batch select and create', () => {
  it('disables Create Delivery until at least one row is selected, then posts the selected ids', async () => {
    mockUser('LOGISTICS_DISPATCHER');
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

    const createButton = screen.getByRole('button', { name: /Create Delivery/i });
    expect(createButton).toBeDisabled();

    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);
    expect(createButton).not.toBeDisabled();

    await user.click(createButton);
    expect(createDelivery).toHaveBeenCalledWith({ jobCardIds: ['jc-1'] });
    expect(await screen.findByText(/Created/)).toBeInTheDocument();
    expect(screen.getByText(/DLV-0001/)).toBeInTheDocument();
  });

  it('renders each blocker from a 409 unpaid-OOW response with an amount and a Record payment action', async () => {
    mockUser('LOGISTICS_DISPATCHER');
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
    await user.click(screen.getByRole('button', { name: /Create Delivery/i }));

    expect(await screen.findByText(/1 out-of-warranty job is unpaid/i)).toBeInTheDocument();
    expect(screen.getByText(/DRAFT, AED 367.50 owed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Record payment/i })).toBeInTheDocument();
  });
});
