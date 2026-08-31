import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeDelivery, makeJobCard } from '../../test/fixtures';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/deliveryApi', () => ({
  listDeliveries: vi.fn(),
  getDelivery: vi.fn(),
  getDeliveryJobCards: vi.fn(),
  dispatchDelivery: vi.fn(),
  capturePod: vi.fn(),
  cancelDelivery: vi.fn(),
}));
vi.mock('../../lib/invoicingApi', () => ({
  getInvoiceByJobCard: vi.fn(),
  getInvoice: vi.fn(),
  recordPayment: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
import {
  cancelDelivery,
  capturePod,
  dispatchDelivery,
  getDelivery,
  getDeliveryJobCards,
  listDeliveries,
} from '../../lib/deliveryApi';
import { DeliveriesPage } from './DeliveriesPage';

function renderPage(initialPath = '/delivery/deliveries') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <DeliveriesPage />
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
  vi.mocked(listDeliveries).mockReset();
  vi.mocked(getDelivery).mockReset();
  vi.mocked(getDeliveryJobCards).mockReset();
  vi.mocked(dispatchDelivery).mockReset();
  vi.mocked(capturePod).mockReset();
  vi.mocked(cancelDelivery).mockReset();
});

describe('DeliveriesPage - list and status filter', () => {
  it('lists deliveries and re-queries with the selected status filter', async () => {
    mockUser('LOGISTICS_DISPATCHER');
    vi.mocked(listDeliveries).mockResolvedValue([makeDelivery()]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('DLV-0001');
    expect(listDeliveries).toHaveBeenCalledWith(undefined);

    await user.click(screen.getByRole('button', { name: 'Dispatched' }));
    expect(listDeliveries).toHaveBeenCalledWith('DISPATCHED');
  });

  it('selecting a delivery sets ?deliveryId= and renders its detail', async () => {
    mockUser('LOGISTICS_DISPATCHER');
    vi.mocked(listDeliveries).mockResolvedValue([makeDelivery({ id: 'del-9', deliveryNumber: 'DLV-0009' })]);
    vi.mocked(getDelivery).mockResolvedValue(makeDelivery({ id: 'del-9', deliveryNumber: 'DLV-0009' }));
    vi.mocked(getDeliveryJobCards).mockResolvedValue([makeJobCard()]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('DLV-0009');
    await user.click(screen.getByRole('button', { name: 'View' }));
    expect(await screen.findByText(/Job cards in this delivery/i)).toBeInTheDocument();
    expect(getDelivery).toHaveBeenCalledWith('del-9');
    expect(getDeliveryJobCards).toHaveBeenCalledWith('del-9');
  });
});

describe('DeliveriesPage - PENDING delivery: dispatch', () => {
  it('dispatches with the entered driver id', async () => {
    mockUser('LOGISTICS_DISPATCHER');
    vi.mocked(listDeliveries).mockResolvedValue([]);
    vi.mocked(getDelivery).mockResolvedValue(makeDelivery({ id: 'del-1', status: 'PENDING' }));
    vi.mocked(getDeliveryJobCards).mockResolvedValue([makeJobCard()]);
    vi.mocked(dispatchDelivery).mockResolvedValue(makeDelivery({ id: 'del-1', status: 'DISPATCHED' }));
    const user = userEvent.setup();
    renderPage('/delivery/deliveries?deliveryId=del-1');

    await screen.findByText(/Job cards in this delivery/i);
    await user.type(screen.getByLabelText(/Driver user id/i), 'driver-7');
    await user.click(screen.getByRole('button', { name: 'Dispatch' }));

    expect(dispatchDelivery).toHaveBeenCalledWith('del-1', { driverUserId: 'driver-7' });
  });

  it('cancels with the entered reason', async () => {
    mockUser('LOGISTICS_DISPATCHER');
    vi.mocked(listDeliveries).mockResolvedValue([]);
    vi.mocked(getDelivery).mockResolvedValue(makeDelivery({ id: 'del-1', status: 'PENDING' }));
    vi.mocked(getDeliveryJobCards).mockResolvedValue([makeJobCard()]);
    vi.mocked(cancelDelivery).mockResolvedValue(makeDelivery({ id: 'del-1', status: 'CANCELLED' }));
    const user = userEvent.setup();
    renderPage('/delivery/deliveries?deliveryId=del-1');

    await screen.findByText(/Job cards in this delivery/i);
    await user.type(screen.getByLabelText(/Reason/i), 'Customer changed mind');
    await user.click(screen.getByRole('button', { name: 'Cancel Delivery' }));

    expect(cancelDelivery).toHaveBeenCalledWith('del-1', { reason: 'Customer changed mind' });
  });
});

describe('DeliveriesPage - DISPATCHED delivery: capture POD (AC-12)', () => {
  it('keeps Mark Delivered disabled until a recipient name AND a signature or photo are both present', async () => {
    mockUser('LOGISTICS_DISPATCHER');
    vi.mocked(listDeliveries).mockResolvedValue([]);
    vi.mocked(getDelivery).mockResolvedValue(makeDelivery({ id: 'del-2', status: 'DISPATCHED' }));
    vi.mocked(getDeliveryJobCards).mockResolvedValue([makeJobCard()]);
    const user = userEvent.setup();
    renderPage('/delivery/deliveries?deliveryId=del-2');

    await screen.findByText(/Capture Proof of Delivery/i);
    const submitButton = screen.getByRole('button', { name: /Mark Delivered/i });
    expect(submitButton).toBeDisabled();

    await user.type(screen.getByLabelText(/Recipient name/i), 'Jane Doe');
    expect(submitButton).toBeDisabled(); // name alone isn't enough - AC-12 needs sig OR photo too

    const photoInput = screen.getByLabelText(/^Photo/i);
    const file = new File(['fake-image-bytes'], 'proof.png', { type: 'image/png' });
    await user.upload(photoInput, file);

    expect(submitButton).not.toBeDisabled();
  });

  it('renders the defensive re-check blockers if payment lapsed since delivery creation', async () => {
    mockUser('LOGISTICS_DISPATCHER');
    vi.mocked(listDeliveries).mockResolvedValue([]);
    vi.mocked(getDelivery).mockResolvedValue(makeDelivery({ id: 'del-2', status: 'DISPATCHED' }));
    vi.mocked(getDeliveryJobCards).mockResolvedValue([makeJobCard()]);
    vi.mocked(capturePod).mockRejectedValue({
      response: {
        status: 409,
        data: {
          message: 'Cannot capture POD: one or more out-of-warranty Job Cards on this delivery are no longer paid.',
          blockers: [{ jobCardId: 'jc-1', jobCardNumber: 'JC-0001', invoiceId: 'inv-1', invoiceStatus: 'PARTIALLY_PAID', amount: 100 }],
        },
      },
    });
    const user = userEvent.setup();
    renderPage('/delivery/deliveries?deliveryId=del-2');

    await screen.findByText(/Capture Proof of Delivery/i);
    await user.type(screen.getByLabelText(/Recipient name/i), 'Jane Doe');
    const photoInput = screen.getByLabelText(/^Photo/i);
    await user.upload(photoInput, new File(['x'], 'proof.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: /Mark Delivered/i }));

    expect(await screen.findByText(/1 out-of-warranty job is unpaid/i)).toBeInTheDocument();
    expect(screen.getByText(/Re-checked at hand-back time/i)).toBeInTheDocument();
  });
});

describe('DeliveriesPage - DELIVERED / CANCELLED', () => {
  it('shows the POD summary for a DELIVERED delivery', async () => {
    mockUser('LOGISTICS_DISPATCHER');
    vi.mocked(listDeliveries).mockResolvedValue([]);
    vi.mocked(getDelivery).mockResolvedValue(
      makeDelivery({ id: 'del-3', status: 'DELIVERED', podRecipientName: 'Jane Doe', deliveredAt: '2026-08-05T10:00:00Z' }),
    );
    vi.mocked(getDeliveryJobCards).mockResolvedValue([makeJobCard()]);
    renderPage('/delivery/deliveries?deliveryId=del-3');
    expect(await screen.findByText(/Received by/i)).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('shows the cancellation reason for a CANCELLED delivery', async () => {
    mockUser('LOGISTICS_DISPATCHER');
    vi.mocked(listDeliveries).mockResolvedValue([]);
    vi.mocked(getDelivery).mockResolvedValue(makeDelivery({ id: 'del-4', status: 'CANCELLED', cancellationReason: 'Wrong address' }));
    vi.mocked(getDeliveryJobCards).mockResolvedValue([]);
    renderPage('/delivery/deliveries?deliveryId=del-4');
    expect(await screen.findByText(/Cancelled: Wrong address/i)).toBeInTheDocument();
  });
});
