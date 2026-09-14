import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeDelivery, makeJobCard } from '../../test/fixtures';

vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/deliveryApi', () => ({
  listDeliveries: vi.fn(),
  getDelivery: vi.fn(),
  getDeliveryJobCards: vi.fn(),
  dispatchDelivery: vi.fn(),
  capturePod: vi.fn(),
  cancelDelivery: vi.fn(),
  listDrivers: vi.fn(), // #218
}));
vi.mock('../../lib/invoicingApi', () => ({
  getInvoiceByJobCard: vi.fn(),
  getInvoice: vi.fn(),
  recordPayment: vi.fn(),
}));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import {
  cancelDelivery,
  capturePod,
  dispatchDelivery,
  getDelivery,
  getDeliveryJobCards,
  listDeliveries,
  listDrivers,
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

// 2026-09-14: DeliveriesPage now gates on the real capability (useMyCapabilities) rather
// than a hardcoded DELIVERY_ROLES role array - see DeliveriesPage.tsx's own comment.
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
  vi.mocked(listDeliveries).mockReset();
  vi.mocked(getDelivery).mockReset();
  vi.mocked(getDeliveryJobCards).mockReset();
  vi.mocked(dispatchDelivery).mockReset();
  vi.mocked(capturePod).mockReset();
  vi.mocked(cancelDelivery).mockReset();
  vi.mocked(listDrivers).mockReset().mockResolvedValue([{ id: 'driver-7', name: 'Zayed Al Nahyan' }]);
});

describe('DeliveriesPage - list and status filter', () => {
  it('lists deliveries and re-queries with the selected status filter', async () => {
    mockCapabilities(['DELIVERY_MANAGE']);
    vi.mocked(listDeliveries).mockResolvedValue([makeDelivery()]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('DLV-0001');
    expect(listDeliveries).toHaveBeenCalledWith(undefined);

    await user.click(screen.getByRole('button', { name: 'Dispatched' }));
    expect(listDeliveries).toHaveBeenCalledWith('DISPATCHED');
  });

  it('selecting a delivery sets ?deliveryId= and renders its detail', async () => {
    mockCapabilities(['DELIVERY_MANAGE']);
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
    mockCapabilities(['DELIVERY_MANAGE']);
    vi.mocked(listDeliveries).mockResolvedValue([]);
    vi.mocked(getDelivery).mockResolvedValue(makeDelivery({ id: 'del-1', status: 'PENDING' }));
    vi.mocked(getDeliveryJobCards).mockResolvedValue([makeJobCard()]);
    vi.mocked(dispatchDelivery).mockResolvedValue(makeDelivery({ id: 'del-1', status: 'DISPATCHED' }));
    const user = userEvent.setup();
    renderPage('/delivery/deliveries?deliveryId=del-1');

    await screen.findByText(/Job cards in this delivery/i);
    await user.click(screen.getByTestId('name-picker-input'));
    await user.click(await screen.findByText('Zayed Al Nahyan'));
    await user.click(screen.getByRole('button', { name: 'Dispatch' }));

    expect(dispatchDelivery).toHaveBeenCalledWith('del-1', { driverUserId: 'driver-7' });
  });

  it('dispatches with no driver at all - it is optional', async () => {
    mockCapabilities(['DELIVERY_MANAGE']);
    vi.mocked(listDeliveries).mockResolvedValue([]);
    vi.mocked(getDelivery).mockResolvedValue(makeDelivery({ id: 'del-1', status: 'PENDING' }));
    vi.mocked(getDeliveryJobCards).mockResolvedValue([makeJobCard()]);
    vi.mocked(dispatchDelivery).mockResolvedValue(makeDelivery({ id: 'del-1', status: 'DISPATCHED' }));
    const user = userEvent.setup();
    renderPage('/delivery/deliveries?deliveryId=del-1');

    await screen.findByText(/Job cards in this delivery/i);
    await user.click(screen.getByRole('button', { name: 'Dispatch' }));

    expect(dispatchDelivery).toHaveBeenCalledWith('del-1', { driverUserId: undefined });
  });

  it('cancels with the entered reason', async () => {
    mockCapabilities(['DELIVERY_MANAGE']);
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
    mockCapabilities(['DELIVERY_MANAGE']);
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

    // Pre-existing flake fix (unrelated to this round's capability-wiring work): the
    // photo input's onChange reads the file via FileReader, whose onload fires
    // asynchronously - user.upload only waits for the DOM change event itself, not that
    // callback, so a bare synchronous assertion here occasionally raced ahead of
    // setPhotoBase64 actually running.
    await waitFor(() => expect(submitButton).not.toBeDisabled());
  });

  it('renders the defensive re-check blockers if payment lapsed since delivery creation', async () => {
    mockCapabilities(['DELIVERY_MANAGE']);
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
    mockCapabilities(['DELIVERY_MANAGE']);
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
    mockCapabilities(['DELIVERY_MANAGE']);
    vi.mocked(listDeliveries).mockResolvedValue([]);
    vi.mocked(getDelivery).mockResolvedValue(makeDelivery({ id: 'del-4', status: 'CANCELLED', cancellationReason: 'Wrong address' }));
    vi.mocked(getDeliveryJobCards).mockResolvedValue([]);
    renderPage('/delivery/deliveries?deliveryId=del-4');
    expect(await screen.findByText(/Cancelled: Wrong address/i)).toBeInTheDocument();
  });
});
