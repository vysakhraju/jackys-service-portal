import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ServicePriceList } from '../../lib/masterDataTypes';

vi.mock('../../lib/masterDataApi', () => ({
  listPriceLists: vi.fn(),
  createPriceList: vi.fn(),
  updatePriceList: vi.fn(),
  deletePriceList: vi.fn(),
  importPriceLists: vi.fn(),
  listBillingChannels: vi.fn(),
}));
vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));

import {
  listPriceLists,
  createPriceList,
  updatePriceList,
  deletePriceList,
  importPriceLists,
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

// Super-admin pricing matrix rebuild (2026-09-25) - one row per (category, jobType,
// customerType, billingChannelId), single `price` column instead of
// priceB2B/priceB2C/billingChannelRate.
function priceRow(overrides: Partial<ServicePriceList> = {}): ServicePriceList {
  return {
    id: 'pl-1',
    category: 'REFRIGERATOR',
    jobType: 'REPAIR',
    customerType: 'B2C',
    price: 100,
    billingChannelId: null,
    billingChannel: null,
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
  vi.mocked(importPriceLists).mockReset();
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
  it('refetches with the chosen category/job type/customer type filters', async () => {
    renderPage();
    await screen.findByText('100.00');

    fireEvent.change(screen.getByDisplayValue('All categories'), { target: { value: 'AC' } });
    await waitFor(() => expect(listPriceLists).toHaveBeenCalledWith('AC', undefined, undefined));

    // Job Type split (2026-09-22) Phase 6 - MAINTENANCE is soft-hidden out of every
    // NEW-pick dropdown, including this filter (ACTIVE_JOB_TYPES, not the full JobType
    // enum), so this filter test now exercises an active job type instead. MAINTENANCE
    // stays a valid stored value on any pre-existing row; this filter just can no longer
    // pick it (no live ServicePriceList rows reference it today, so nothing to filter to).
    fireEvent.change(screen.getByDisplayValue('All job types'), { target: { value: 'INSTALLATION' } });
    await waitFor(() => expect(listPriceLists).toHaveBeenCalledWith('AC', 'INSTALLATION', undefined));

    fireEvent.change(screen.getByDisplayValue('All customer types'), { target: { value: 'B2B' } });
    await waitFor(() => expect(listPriceLists).toHaveBeenCalledWith('AC', 'INSTALLATION', 'B2B'));
  });
});

describe('PriceListsPage - create/edit/delete', () => {
  it('creates a new price row via the modal form, including customer type and an optional billing channel', async () => {
    vi.mocked(createPriceList).mockResolvedValue(priceRow({ id: 'pl-2' }));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '+ New Price Row' }));

    fireEvent.change(screen.getByLabelText('Customer Type'), { target: { value: 'B2B' } });
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '200' } });

    const billingChannelPicker = (await screen.findAllByTestId('name-picker-input'))[0];
    fireEvent.focus(billingChannelPicker);
    fireEvent.click(await screen.findByText('Corporate Interdepartment'));

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(createPriceList).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'REFRIGERATOR',
          jobType: 'REPAIR',
          customerType: 'B2B',
          price: 200,
          billingChannelId: 'bc-1',
        }),
      ),
    );
  });

  it('opens pre-filled from the row and saves an edit via updatePriceList', async () => {
    vi.mocked(updatePriceList).mockResolvedValue(priceRow({ price: 175 }));
    renderPage();

    fireEvent.click(await screen.findByText('Edit'));
    expect(await screen.findByDisplayValue('100')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('100'), { target: { value: '175' } });
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() =>
      expect(updatePriceList).toHaveBeenCalledWith('pl-1', expect.objectContaining({ price: 175 })),
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

// CSV import/export - super-admin pricing matrix rebuild (2026-09-25) - lets
// MASTER_DATA_PRICE_LIST_MANAGE fill in real rates from a spreadsheet instead of the
// one-row-at-a-time modal above.
describe('PriceListsPage - CSV import/export', () => {
  function csvFile(text: string) {
    return new File([text], 'price-list.csv', { type: 'text/csv' });
  }

  beforeEach(() => {
    // jsdom doesn't implement the Blob-URL APIs the download path touches.
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  it('shows Download Template even for a role with no manage capability', async () => {
    mockUser('CCE');
    mockCapabilities([]);
    renderPage();

    expect(await screen.findByRole('button', { name: 'Download Template' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload CSV' })).not.toBeInTheDocument();
  });

  it('fetches the full unfiltered list and triggers a download when Download Template is clicked', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderPage();
    await screen.findByText('100.00');
    vi.mocked(listPriceLists).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Download Template' }));

    await waitFor(() => expect(listPriceLists).toHaveBeenCalledWith());
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
  });

  it('parses the uploaded CSV into rows and shows the created/updated summary on success', async () => {
    vi.mocked(importPriceLists).mockResolvedValue({ created: 1, updated: 2, errors: [] });
    renderPage();
    await screen.findByText('100.00');

    const csv = 'Category,Job Type,Customer Type,Billing Channel,Price,Warranty Labor Cost,Currency,Active\n' +
      'AC,REPAIR,B2C,,120,0,AED,Y\n';
    const input = screen.getByLabelText('Upload Price List CSV');
    fireEvent.change(input, { target: { files: [csvFile(csv)] } });

    await waitFor(() =>
      expect(importPriceLists).toHaveBeenCalledWith([
        {
          category: 'AC',
          jobType: 'REPAIR',
          customerType: 'B2C',
          billingChannel: '',
          price: '120',
          warrantyLaborCost: '0',
          currency: 'AED',
          isActive: 'Y',
        },
      ]),
    );
    expect(await screen.findByText('Import complete — 1 created, 2 updated.')).toBeInTheDocument();
  });

  it('shows row-level errors returned by the backend without treating the import as failed', async () => {
    vi.mocked(importPriceLists).mockResolvedValue({
      created: 0,
      updated: 1,
      errors: ['Row 3: unknown Category "TOASTER"'],
    });
    renderPage();
    await screen.findByText('100.00');

    const csv = 'Category,Job Type,Customer Type,Price\nAC,REPAIR,B2C,120\nTOASTER,REPAIR,B2C,50\n';
    fireEvent.change(screen.getByLabelText('Upload Price List CSV'), { target: { files: [csvFile(csv)] } });

    expect(await screen.findByText('Row 3: unknown Category "TOASTER"')).toBeInTheDocument();
    expect(screen.getByText(/1 updated, 1 row\(s\) skipped:/)).toBeInTheDocument();
  });
});
