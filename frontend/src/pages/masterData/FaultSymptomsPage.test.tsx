import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FaultSymptom } from '../../lib/masterDataTypes';

vi.mock('../../lib/masterDataApi', () => ({
  listFaultSymptoms: vi.fn(),
  createFaultSymptom: vi.fn(),
  updateFaultSymptom: vi.fn(),
  deleteFaultSymptom: vi.fn(),
  bulkImportFaultSymptoms: vi.fn(),
}));
vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));

import {
  listFaultSymptoms,
  createFaultSymptom,
  updateFaultSymptom,
  deleteFaultSymptom,
  bulkImportFaultSymptoms,
} from '../../lib/masterDataApi';
import { useAuth } from '../../lib/auth';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { FaultSymptomsPage, parseFaultSymptomCsv } from './FaultSymptomsPage';

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

function faultSymptom(overrides: Partial<FaultSymptom> = {}): FaultSymptom {
  return {
    id: 'fs-1',
    faultCode: 'FLT-0001',
    faultDescription: 'Not draining',
    symptomCode: 'SYM-0001',
    symptomDescription: 'Water remains in drum',
    category: 'WASHING_MACHINE',
    requiresWorkshop: false,
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
      <FaultSymptomsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listFaultSymptoms).mockReset().mockResolvedValue([faultSymptom()]);
  vi.mocked(createFaultSymptom).mockReset();
  vi.mocked(updateFaultSymptom).mockReset();
  vi.mocked(deleteFaultSymptom).mockReset();
  vi.mocked(bulkImportFaultSymptoms).mockReset();
  mockUser('SUPER_ADMIN');
  mockCapabilities([], true);
});

describe('FaultSymptomsPage - action visibility by capability/role', () => {
  it('hides Edit/Delete/Import for a role with none of the relevant grants and isn\'t SUPER_ADMIN', async () => {
    mockUser('CCE');
    mockCapabilities([]);
    renderPage();

    await screen.findByText('FLT-0001');
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    expect(screen.queryByText('Import CSV')).not.toBeInTheDocument();
  });

  it('shows Edit once MASTER_DATA_FAULT_SYMPTOM_MANAGE is granted, but never shows Delete for a non-SUPER_ADMIN role even with every capability granted', async () => {
    mockUser('CCE');
    mockCapabilities(['MASTER_DATA_FAULT_SYMPTOM_MANAGE'], true);
    renderPage();

    expect(await screen.findByText('Edit')).toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('shows Delete for SUPER_ADMIN even with zero explicit capability grants', async () => {
    mockUser('SUPER_ADMIN');
    mockCapabilities([], false);
    renderPage();

    await screen.findByText('FLT-0001');
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('shows Import CSV once MASTER_DATA_BULK_IMPORT is granted', async () => {
    mockUser('CCE');
    mockCapabilities(['MASTER_DATA_BULK_IMPORT']);
    renderPage();

    expect(await screen.findByText('Import CSV')).toBeInTheDocument();
  });
});

describe('FaultSymptomsPage - edit/delete', () => {
  it('opens pre-filled from the row and saves an edit via updateFaultSymptom', async () => {
    vi.mocked(updateFaultSymptom).mockResolvedValue(faultSymptom({ faultDescription: 'Compressor failure' }));
    renderPage();

    fireEvent.click(await screen.findByText('Edit'));
    expect(await screen.findByDisplayValue('Not draining')).toBeInTheDocument();
    expect(screen.getByDisplayValue('FLT-0001')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Not draining'), { target: { value: 'Compressor failure' } });
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() =>
      expect(updateFaultSymptom).toHaveBeenCalledWith(
        'fs-1',
        expect.objectContaining({ faultDescription: 'Compressor failure' }),
      ),
    );
  });

  it('deletes (soft) after the confirm dialog is accepted', async () => {
    vi.mocked(deleteFaultSymptom).mockResolvedValue(undefined as any);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    fireEvent.click(await screen.findByText('Delete'));

    await waitFor(() => expect(deleteFaultSymptom).toHaveBeenCalledWith('fs-1'));
  });

  it('does not delete when the confirm dialog is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();

    fireEvent.click(await screen.findByText('Delete'));

    expect(deleteFaultSymptom).not.toHaveBeenCalled();
  });
});

describe('FaultSymptomsPage - CSV import', () => {
  function csvFile(text: string) {
    return new File([text], 'faults.csv', { type: 'text/csv' });
  }

  it('previews parsed rows from a valid CSV and imports them on click', async () => {
    vi.mocked(bulkImportFaultSymptoms).mockResolvedValue({ success: 2, errors: [] });
    renderPage();

    fireEvent.click(screen.getByText('Import CSV'));
    const csv =
      'Category,Symptom,Fault,Active\n' +
      'WASHING_MACHINE,Water remains in drum,Not draining,Y\n' +
      'REFRIGERATOR,No cooling,Compressor failure,N';
    fireEvent.change(screen.getByTestId('csv-file-input'), { target: { files: [csvFile(csv)] } });

    expect(await screen.findByText('2 row(s) ready to import.')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Import 2 row(s)'));

    await waitFor(() =>
      expect(bulkImportFaultSymptoms).toHaveBeenCalledWith([
        {
          category: 'WASHING_MACHINE',
          symptomDescription: 'Water remains in drum',
          faultDescription: 'Not draining',
          isActive: true,
        },
        {
          category: 'REFRIGERATOR',
          symptomDescription: 'No cooling',
          faultDescription: 'Compressor failure',
          isActive: false,
        },
      ]),
    );
    expect(await screen.findByText(/Imported 2 row\(s\)/)).toBeInTheDocument();
  });

  it('shows per-row errors for bad rows and does not block importing the still-valid ones', async () => {
    renderPage();
    fireEvent.click(screen.getByText('Import CSV'));

    const csv =
      'Category,Symptom,Fault,Active\n' +
      'NOT_A_CATEGORY,Some symptom,Some fault,Y\n' +
      'WASHING_MACHINE,Water remains in drum,Not draining,Y';
    fireEvent.change(screen.getByTestId('csv-file-input'), { target: { files: [csvFile(csv)] } });

    expect(await screen.findByText('1 row(s) skipped:')).toBeInTheDocument();
    expect(screen.getByText(/unknown category "NOT_A_CATEGORY"/)).toBeInTheDocument();
    expect(screen.getByText('1 row(s) ready to import.')).toBeInTheDocument();
  });

  it('disables the Import button when the CSV is missing a required column', async () => {
    renderPage();
    fireEvent.click(screen.getByText('Import CSV'));

    fireEvent.change(screen.getByTestId('csv-file-input'), {
      target: { files: [csvFile('Category,Symptom,Active\nWASHING_MACHINE,Water remains,Y')] },
    });

    expect(await screen.findByText(/Header row must include/)).toBeInTheDocument();
    expect(screen.getByText('Import 0 row(s)').closest('button')).toBeDisabled();
    expect(bulkImportFaultSymptoms).not.toHaveBeenCalled();
  });
});

describe('parseFaultSymptomCsv (pure function)', () => {
  it('defaults Active to Y (isActive: true) when the column is omitted entirely', () => {
    const result = parseFaultSymptomCsv('Category,Symptom,Fault\nAC,No cold air,Gas leak');
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { category: 'AC', symptomDescription: 'No cold air', faultDescription: 'Gas leak', isActive: true },
    ]);
  });

  it('handles quoted fields containing commas', () => {
    const result = parseFaultSymptomCsv(
      'Category,Symptom,Fault,Active\nOVEN,"Uneven heating, smells burnt",Heating element failure,Y',
    );
    expect(result.rows[0].symptomDescription).toBe('Uneven heating, smells burnt');
  });

  it('normalizes a spaced/lowercase category to the enum form', () => {
    const result = parseFaultSymptomCsv('Category,Symptom,Fault,Active\nwashing machine,Leaks,Seal worn,Y');
    expect(result.rows).toEqual([
      { category: 'WASHING_MACHINE', symptomDescription: 'Leaks', faultDescription: 'Seal worn', isActive: true },
    ]);
  });

  it('reports an empty-file error for a blank upload', () => {
    expect(parseFaultSymptomCsv('')).toEqual({ rows: [], errors: ['File is empty.'] });
  });
});
