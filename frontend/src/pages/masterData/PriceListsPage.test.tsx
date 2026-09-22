import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ServicePriceList } from '../../lib/masterDataTypes';

vi.mock('../../lib/masterDataApi', () => ({
  listPriceLists: vi.fn(),
  createPriceList: vi.fn(),
  updatePriceList: vi.fn(),
  deletePriceList: vi.fn(),
  listBillingChannels: vi.fn(),
}));
vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));

import {
  listPriceLists,
  createPriceList,
  updatePriceList,
  deletePriceList,
  listBillingChannels,
} from '../../lib/masterDataApi';
import { useAuth } from '../../lib/auth';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { PriceListsPage } from './PriceListsPage';

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

function priceRow(overrides: Partial<ServicePriceList> = {}): ServicePriceList {
  return {
    id: 'pl-1',
    category: 'REFRIGERATOR',
    jobType: 'REPAIR',
    priceB2B: 100,
    priceB2C: 150,
    billingChannelId: null,
    billingChannel: null,
    billingChannelRate: 0,
    warrantyLaborCost: 20,
    currency: 'AED',
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
      <PriceListsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listPriceLists).mockReset().mockResolvedValue([priceRow()]);
  vi.mocked(createPriceList).mockReset();
  vi.mocked(updatePriceList).mockReset();
  vi.mocked(deletePriceList).mockReset();
  vi.mocked(listBillingChannels)
    .mockReset()
    .mockResolvedValue([
      { id: 'bc-1', name: 'Corporate Interdepartment', isActive: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ] as any);
  mockUser('SUPER_ADMIN');
  mockCapabilities([], true);
});

describe('PriceListsPage - action visibility by capability/role', () => {
  it("hides Edit/Delete for a role with none of the relevant grants and isn't SUPER_ADMIN", async () => {
    mockUser('CCE');
    mockCapabilities([]);
    renderPage();

    await screen.findByText('100.00');
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('shows Edit once MASTER_DATA_PRICE_LIST_MANAGE is granted, but never shows Delete for a non-SUPER_ADMIN role', async () => {
    mockUser('CCE');
    mockCapabilities(['MASTER_DATA_PRICE_LIST_MANAGE']);
    renderPage();

    expect(await screen.findByText('Edit')).toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('shows Delete for SUPER_ADMIN even with zero explicit capability grants', async () => {
    mockUser('SUPER_ADMIN');
    mockCapabilities([], false);
    renderPage();

    await screen.findByText('100.00');
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });
});

describe('PriceListsPage - list filters', () => {
  it('refetches with the chosen category/job type filters', async () => {
    renderPage();
    await screen.findByText('100.00');

    fireEvent.change(screen.getByDisplayValue('All categories'), { target: { value: 'AC' } });
    await waitFor(() => expect(listPriceLists).toHaveBeenCalledWith('AC', undefined));

    // Job Type split (2026-09-22) Phase 6 - MAINTENANCE is soft-hidden out of every
    // NEW-pick dropdown, including this filter (ACTIVE_JOB_TYPES, not the full JobType
    // enum), so this filter test now exercises an active job type instead. MAINTENANCE
    // stays a valid stored value on any pre-existing row; this filter just can no longer
    // pick it (no live ServicePriceList rows reference it today, so nothing to filter to).
    fireEvent.change(screen.getByDisplayValue('All job types'), { target: { value: 'INSTALLATION' } });
    await waitFor(() => expect(listPriceLists).toHaveBeenCalledWith('AC', 'INSTALLATION'));
  });
});

describe('PriceListsPage - create/edit/delete', () => {
  it('creates a new price row via the modal form, including an optional billing channel', async () => {
    vi.mocked(createPriceList).mockResolvedValue(priceRow({ id: 'pl-2' }));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '+ New Price Row' }));

    fireEvent.change(screen.getByLabelText('B2B Price'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('B2C Price'), { target: { value: '250' } });

    const billingChannelPicker = (await screen.findAllByTestId('name-picker-input'))[0];
    fireEvent.focus(billingChannelPicker);
    fireEvent.click(await screen.findByText('Corporate Interdepartment'));

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(createPriceList).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'REFRIGERATOR',
          jobType: 'REPAIR',
          priceB2B: 200,
          priceB2C: 250,
          billingChannelId: 'bc-1',
        }),
      ),
    );
  });

  it('opens pre-filled from the row and saves an edit via updatePriceList', async () => {
    vi.mocked(updatePriceList).mockResolvedValue(priceRow({ priceB2B: 175 }));
    renderPage();

    fireEvent.click(await screen.findByText('Edit'));
    expect(await screen.findByDisplayValue('100')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('100'), { target: { value: '175' } });
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() =>
      expect(updatePriceList).toHaveBeenCalledWith('pl-1', expect.objectContaining({ priceB2B: 175 })),
    );
  });

  it('deletes (soft) after the confirm dialog is accepted', async () => {
    vi.mocked(deletePriceList).mockResolvedValue(undefined as any);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    fireEvent.click(await screen.findByText('Delete'));

    await waitFor(() => expect(deletePriceList).toHaveBeenCalledWith('pl-1'));
  });

  it('does not delete when the confirm dialog is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();

    fireEvent.click(await screen.findByText('Delete'));

    expect(deletePriceList).not.toHaveBeenCalled();
  });
});
