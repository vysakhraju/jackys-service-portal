import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BillingChannel } from '../../lib/masterDataTypes';

vi.mock('../../lib/masterDataApi', () => ({
  listBillingChannels: vi.fn(),
  createBillingChannel: vi.fn(),
  updateBillingChannel: vi.fn(),
  deleteBillingChannel: vi.fn(),
}));
vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));

import { listBillingChannels, createBillingChannel, updateBillingChannel, deleteBillingChannel } from '../../lib/masterDataApi';
import { useAuth } from '../../lib/auth';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { BillingChannelsPage } from './BillingChannelsPage';

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

function billingChannel(overrides: Partial<BillingChannel> = {}): BillingChannel {
  return {
    id: 'bc-1',
    name: 'Corporate Interdepartment',
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
      <BillingChannelsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listBillingChannels).mockReset().mockResolvedValue([billingChannel()]);
  vi.mocked(createBillingChannel).mockReset();
  vi.mocked(updateBillingChannel).mockReset();
  vi.mocked(deleteBillingChannel).mockReset();
  mockUser('SUPER_ADMIN');
  mockCapabilities([], true);
});

describe('BillingChannelsPage - action visibility by capability/role', () => {
  it('hides Edit/Delete for a role with none of the relevant grants and isn\'t SUPER_ADMIN', async () => {
    mockUser('CCE');
    mockCapabilities([]);
    renderPage();

    await screen.findByText('Corporate Interdepartment');
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('shows Edit once MASTER_DATA_BILLING_CHANNEL_MANAGE is granted, but never shows Delete for a non-SUPER_ADMIN role', async () => {
    mockUser('CCE');
    mockCapabilities(['MASTER_DATA_BILLING_CHANNEL_MANAGE']);
    renderPage();

    expect(await screen.findByText('Edit')).toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('shows Delete for SUPER_ADMIN even with zero explicit capability grants', async () => {
    mockUser('SUPER_ADMIN');
    mockCapabilities([], false);
    renderPage();

    await screen.findByText('Corporate Interdepartment');
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });
});

describe('BillingChannelsPage - create/edit/delete', () => {
  it('creates a new billing channel via the modal form', async () => {
    vi.mocked(createBillingChannel).mockResolvedValue(billingChannel({ id: 'bc-2', name: 'Retail Direct' }));
    renderPage();

    fireEvent.click(await screen.findByText('+ New Billing Channel'));
    fireEvent.change(screen.getByPlaceholderText('Corporate Interdepartment'), { target: { value: 'Retail Direct' } });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() =>
      expect(createBillingChannel).toHaveBeenCalledWith({ name: 'Retail Direct', isActive: true }),
    );
  });

  it('opens pre-filled from the row and saves an edit via updateBillingChannel', async () => {
    vi.mocked(updateBillingChannel).mockResolvedValue(billingChannel({ name: 'Corporate Interdepartment (Renamed)' }));
    renderPage();

    fireEvent.click(await screen.findByText('Edit'));
    expect(await screen.findByDisplayValue('Corporate Interdepartment')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Corporate Interdepartment'), {
      target: { value: 'Corporate Interdepartment (Renamed)' },
    });
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() =>
      expect(updateBillingChannel).toHaveBeenCalledWith(
        'bc-1',
        expect.objectContaining({ name: 'Corporate Interdepartment (Renamed)' }),
      ),
    );
  });

  it('deletes (soft) after the confirm dialog is accepted', async () => {
    vi.mocked(deleteBillingChannel).mockResolvedValue(undefined as any);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    fireEvent.click(await screen.findByText('Delete'));

    await waitFor(() => expect(deleteBillingChannel).toHaveBeenCalledWith('bc-1'));
  });

  it('does not delete when the confirm dialog is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();

    fireEvent.click(await screen.findByText('Delete'));

    expect(deleteBillingChannel).not.toHaveBeenCalled();
  });
});
