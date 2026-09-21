import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CancellationReason } from '../../lib/masterDataTypes';

vi.mock('../../lib/masterDataApi', () => ({
  listCancellationReasons: vi.fn(),
  createCancellationReason: vi.fn(),
  updateCancellationReason: vi.fn(),
  deleteCancellationReason: vi.fn(),
}));
vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));

import {
  listCancellationReasons,
  createCancellationReason,
  updateCancellationReason,
  deleteCancellationReason,
} from '../../lib/masterDataApi';
import { useAuth } from '../../lib/auth';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { CancellationReasonsPage } from './CancellationReasonsPage';

function mockUser(roleName: string) {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      id: 'u1',
      firstName: 'Test',
      lastName: 'User',
      email: 'test@jackys.com',
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

function cancellationReason(overrides: Partial<CancellationReason> = {}): CancellationReason {
  return {
    id: 'cr-1',
    label: 'Customer no longer needs the service',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CancellationReasonsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listCancellationReasons).mockReset().mockResolvedValue([cancellationReason()]);
  vi.mocked(createCancellationReason).mockReset();
  vi.mocked(updateCancellationReason).mockReset();
  vi.mocked(deleteCancellationReason).mockReset();
  mockUser('SUPER_ADMIN');
  mockCapabilities([], true);
});

describe('CancellationReasonsPage - action visibility by capability/role', () => {
  it('hides Edit/Delete for a role with none of the relevant grants and isn\'t SUPER_ADMIN', async () => {
    mockUser('CCE');
    mockCapabilities([]);
    renderPage();

    await screen.findByText('Customer no longer needs the service');
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('shows Edit once MASTER_DATA_CANCELLATION_REASON_MANAGE is granted, but never shows Delete for a non-SUPER_ADMIN role', async () => {
    mockUser('CCE');
    mockCapabilities(['MASTER_DATA_CANCELLATION_REASON_MANAGE']);
    renderPage();

    expect(await screen.findByText('Edit')).toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('shows Delete for SUPER_ADMIN even with zero explicit capability grants', async () => {
    mockUser('SUPER_ADMIN');
    mockCapabilities([], false);
    renderPage();

    await screen.findByText('Customer no longer needs the service');
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });
});

describe('CancellationReasonsPage - create/edit/delete', () => {
  it('creates a new reason via the modal form', async () => {
    vi.mocked(createCancellationReason).mockResolvedValue(cancellationReason({ id: 'cr-2', label: 'Duplicate booking' }));
    renderPage();

    fireEvent.click(await screen.findByText('+ New Reason'));
    fireEvent.change(screen.getByPlaceholderText('Customer no longer needs the service'), {
      target: { value: 'Duplicate booking' },
    });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() =>
      expect(createCancellationReason).toHaveBeenCalledWith({ label: 'Duplicate booking', isActive: true }),
    );
  });

  it('opens pre-filled from the row and saves an edit via updateCancellationReason', async () => {
    vi.mocked(updateCancellationReason).mockResolvedValue(cancellationReason({ label: 'Rescheduled by customer' }));
    renderPage();

    fireEvent.click(await screen.findByText('Edit'));
    expect(await screen.findByDisplayValue('Customer no longer needs the service')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Customer no longer needs the service'), {
      target: { value: 'Rescheduled by customer' },
    });
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() =>
      expect(updateCancellationReason).toHaveBeenCalledWith(
        'cr-1',
        expect.objectContaining({ label: 'Rescheduled by customer' }),
      ),
    );
  });

  it('deletes (soft) after the confirm dialog is accepted', async () => {
    vi.mocked(deleteCancellationReason).mockResolvedValue(undefined as any);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    fireEvent.click(await screen.findByText('Delete'));

    await waitFor(() => expect(deleteCancellationReason).toHaveBeenCalledWith('cr-1'));
  });

  it('does not delete when the confirm dialog is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();

    fireEvent.click(await screen.findByText('Delete'));

    expect(deleteCancellationReason).not.toHaveBeenCalled();
  });
});
