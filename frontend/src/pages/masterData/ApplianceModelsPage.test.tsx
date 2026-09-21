import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApplianceModel } from '../../lib/masterDataTypes';

vi.mock('../../lib/masterDataApi', () => ({
  listApplianceModels: vi.fn(),
  createApplianceModel: vi.fn(),
  updateApplianceModel: vi.fn(),
  deleteApplianceModel: vi.fn(),
}));
vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));

import {
  listApplianceModels,
  createApplianceModel,
  updateApplianceModel,
  deleteApplianceModel,
} from '../../lib/masterDataApi';
import { useAuth } from '../../lib/auth';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { ApplianceModelsPage } from './ApplianceModelsPage';

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

function applianceModel(overrides: Partial<ApplianceModel> = {}): ApplianceModel {
  return {
    id: 'am-1',
    brand: 'LG',
    model: 'WM-2401',
    description: null,
    category: 'WASHING_MACHINE',
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
      <ApplianceModelsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listApplianceModels).mockReset().mockResolvedValue([applianceModel()]);
  vi.mocked(createApplianceModel).mockReset();
  vi.mocked(updateApplianceModel).mockReset();
  vi.mocked(deleteApplianceModel).mockReset();
  mockUser('SUPER_ADMIN');
  mockCapabilities([], true);
});

describe('ApplianceModelsPage - action visibility by capability/role', () => {
  it('hides Edit/Delete for a role with none of the relevant grants and isn\'t SUPER_ADMIN', async () => {
    mockUser('CCE');
    mockCapabilities([]);
    renderPage();

    await screen.findByText('LG');
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('shows Edit once MASTER_DATA_APPLIANCE_MODEL_MANAGE is granted, but never shows Delete for a non-SUPER_ADMIN role', async () => {
    mockUser('CCE');
    mockCapabilities(['MASTER_DATA_APPLIANCE_MODEL_MANAGE']);
    renderPage();

    expect(await screen.findByText('Edit')).toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('shows Delete for SUPER_ADMIN even with zero explicit capability grants', async () => {
    mockUser('SUPER_ADMIN');
    mockCapabilities([], false);
    renderPage();

    await screen.findByText('LG');
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });
});

describe('ApplianceModelsPage - category display and null handling', () => {
  it('renders the category with underscores replaced by spaces', async () => {
    renderPage();
    expect(await screen.findByText('WASHING MACHINE')).toBeInTheDocument();
  });

  it('shows "Not set" for a model with no category, and edit form defaults to the blank option', async () => {
    vi.mocked(listApplianceModels).mockResolvedValue([applianceModel({ category: null })]);
    renderPage();

    expect(await screen.findByText('Not set')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Edit'));
    expect(await screen.findByDisplayValue('LG')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Not set')).toBeInTheDocument();
  });
});

describe('ApplianceModelsPage - create/edit/delete', () => {
  it('creates a new model via the modal form, omitting category when left unset', async () => {
    vi.mocked(createApplianceModel).mockResolvedValue(applianceModel({ id: 'am-2', brand: 'Samsung', category: null }));
    renderPage();

    fireEvent.click(await screen.findByText('+ New Appliance Model'));
    fireEvent.change(screen.getByPlaceholderText('LG'), { target: { value: 'Samsung' } });
    fireEvent.change(screen.getByPlaceholderText('WM-2401'), { target: { value: 'RF-500' } });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() =>
      expect(createApplianceModel).toHaveBeenCalledWith({
        brand: 'Samsung',
        model: 'RF-500',
        description: undefined,
        category: undefined,
        isActive: true,
      }),
    );
  });

  it('opens pre-filled from the row and saves an edit via updateApplianceModel', async () => {
    vi.mocked(updateApplianceModel).mockResolvedValue(applianceModel({ model: 'WM-2500' }));
    renderPage();

    fireEvent.click(await screen.findByText('Edit'));
    expect(await screen.findByDisplayValue('WM-2401')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('WM-2401'), { target: { value: 'WM-2500' } });
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() =>
      expect(updateApplianceModel).toHaveBeenCalledWith('am-1', expect.objectContaining({ model: 'WM-2500' })),
    );
  });

  it('deletes (soft) after the confirm dialog is accepted', async () => {
    vi.mocked(deleteApplianceModel).mockResolvedValue(undefined as any);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    fireEvent.click(await screen.findByText('Delete'));

    await waitFor(() => expect(deleteApplianceModel).toHaveBeenCalledWith('am-1'));
  });

  it('does not delete when the confirm dialog is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();

    fireEvent.click(await screen.findByText('Delete'));

    expect(deleteApplianceModel).not.toHaveBeenCalled();
  });
});
