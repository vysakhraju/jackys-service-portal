import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApplianceModel } from '../../lib/masterDataTypes';

vi.mock('../../lib/masterDataApi', () => ({
  listApplianceModels: vi.fn(),
  createApplianceModel: vi.fn(),
  updateApplianceModel: vi.fn(),
  deleteApplianceModel: vi.fn(),
  bulkImportApplianceModels: vi.fn(),
}));
vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));

import {
  listApplianceModels,
  createApplianceModel,
  updateApplianceModel,
  deleteApplianceModel,
  bulkImportApplianceModels,
} from '../../lib/masterDataApi';
import { useAuth } from '../../lib/auth';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { ApplianceModelsPage, parseApplianceModelCsv } from './ApplianceModelsPage';

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
  vi.mocked(bulkImportApplianceModels).mockReset();
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

  it('shows Import CSV once MASTER_DATA_BULK_IMPORT is granted', async () => {
    mockUser('CCE');
    mockCapabilities(['MASTER_DATA_BULK_IMPORT']);
    renderPage();

    expect(await screen.findByText('Import CSV')).toBeInTheDocument();
  });

  it('hides Import CSV without MASTER_DATA_BULK_IMPORT', async () => {
    mockUser('CCE');
    mockCapabilities([]);
    renderPage();

    await screen.findByText('LG');
    expect(screen.queryByText('Import CSV')).not.toBeInTheDocument();
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

function csvFile(text: string) {
  return new File([text], 'models.csv', { type: 'text/csv' });
}

describe('ApplianceModelsPage - CSV import', () => {
  it('previews parsed rows from a valid CSV and imports them on click', async () => {
    vi.mocked(bulkImportApplianceModels).mockResolvedValue({ success: 2, errors: [] });
    renderPage();

    fireEvent.click(await screen.findByText('Import CSV'));
    const csv =
      'Brand,Model,Category,Description,Active\n' +
      'LG,WM-3001,Washing Machine,Front loader,Y\n' +
      'Samsung,RF-700,,,N';
    fireEvent.change(screen.getByTestId('csv-file-input'), { target: { files: [csvFile(csv)] } });

    expect(await screen.findByText('2 row(s) ready to import.')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Import 2 row(s)'));

    await waitFor(() =>
      expect(bulkImportApplianceModels).toHaveBeenCalledWith([
        { brand: 'LG', model: 'WM-3001', category: 'WASHING_MACHINE', description: 'Front loader', isActive: true },
        { brand: 'Samsung', model: 'RF-700', category: undefined, description: undefined, isActive: false },
      ]),
    );
    expect(await screen.findByText(/Imported 2 row\(s\)/)).toBeInTheDocument();
  });

  it('shows per-row errors for bad rows and does not block importing the still-valid ones', async () => {
    renderPage();
    fireEvent.click(screen.getByText('Import CSV'));

    const csv =
      'Brand,Model,Category,Active\n' +
      'LG,,WASHING_MACHINE,Y\n' +
      'Samsung,RF-700,NOT_A_CATEGORY,Y\n' +
      'Bosch,DW-100,DISHWASHER,Y';
    fireEvent.change(screen.getByTestId('csv-file-input'), { target: { files: [csvFile(csv)] } });

    expect(await screen.findByText('2 row(s) skipped:')).toBeInTheDocument();
    expect(screen.getByText(/Brand and Model are both required/)).toBeInTheDocument();
    expect(screen.getByText(/unknown category "NOT_A_CATEGORY"/)).toBeInTheDocument();
    expect(screen.getByText('1 row(s) ready to import.')).toBeInTheDocument();
  });

  it('disables the Import button when the CSV is missing a required column', async () => {
    renderPage();
    fireEvent.click(screen.getByText('Import CSV'));

    fireEvent.change(screen.getByTestId('csv-file-input'), {
      target: { files: [csvFile('Model,Category\nWM-3001,WASHING_MACHINE')] },
    });

    expect(await screen.findByText(/Header row must include/)).toBeInTheDocument();
    expect(screen.getByText('Import 0 row(s)').closest('button')).toBeDisabled();
    expect(bulkImportApplianceModels).not.toHaveBeenCalled();
  });
});

describe('parseApplianceModelCsv (pure function)', () => {
  it('defaults Active to Y (isActive: true) and leaves category/description undefined when omitted', () => {
    const result = parseApplianceModelCsv('Brand,Model\nLG,WM-3001');
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { brand: 'LG', model: 'WM-3001', category: undefined, description: undefined, isActive: true },
    ]);
  });

  it('handles quoted fields containing commas', () => {
    const result = parseApplianceModelCsv(
      'Brand,Model,Description\nLG,WM-3001,"Front loader, 8kg capacity"',
    );
    expect(result.rows[0].description).toBe('Front loader, 8kg capacity');
  });

  it('normalizes a spaced/lowercase category to the enum form', () => {
    const result = parseApplianceModelCsv('Brand,Model,Category\nLG,WM-3001,washing machine');
    expect(result.rows[0].category).toBe('WASHING_MACHINE');
  });

  it('reports an empty-file error for a blank upload', () => {
    expect(parseApplianceModelCsv('')).toEqual({ rows: [], errors: ['File is empty.'] });
  });
});
