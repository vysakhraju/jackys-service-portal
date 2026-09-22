import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AppointmentFieldConfig } from '../../lib/masterDataTypes';

vi.mock('../../lib/masterDataApi', () => ({
  listAppointmentFieldConfigs: vi.fn(),
  updateAppointmentFieldConfig: vi.fn(),
  updateAppointmentFieldConfigVisibility: vi.fn(),
}));
vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));

import {
  listAppointmentFieldConfigs,
  updateAppointmentFieldConfig,
  updateAppointmentFieldConfigVisibility,
} from '../../lib/masterDataApi';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { AppointmentFieldConfigPage } from './AppointmentFieldConfigPage';

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

// Job Type split (requested 2026-09-22), Phase 6 - jobType/isVisible default to the
// pre-Phase-6 shape (global row, always shown) so every test written before this phase
// keeps passing unchanged; only the new tests below override them.
function config(overrides: Partial<AppointmentFieldConfig> = {}): AppointmentFieldConfig {
  return {
    id: 'cfg-1',
    fieldKey: 'jobType',
    fieldLabel: 'Job Type',
    isMandatory: true,
    jobType: null,
    isVisible: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AppointmentFieldConfigPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listAppointmentFieldConfigs)
    .mockReset()
    .mockResolvedValue([config(), config({ id: 'cfg-2', fieldKey: 'channel', fieldLabel: 'Channel', isMandatory: false })]);
  vi.mocked(updateAppointmentFieldConfig).mockReset();
  vi.mocked(updateAppointmentFieldConfigVisibility).mockReset();
});

describe('AppointmentFieldConfigPage', () => {
  it('renders every row with its current mandatory/optional state', async () => {
    mockCapabilities(['MASTER_DATA_APPOINTMENT_FIELD_CONFIG_MANAGE']);
    renderPage();

    expect(await screen.findByText('Job Type')).toBeInTheDocument();
    expect(screen.getByText('jobType')).toBeInTheDocument();
    expect(screen.getByText('Channel')).toBeInTheDocument();
    expect(screen.getAllByText('Mandatory')).toHaveLength(1);
    expect(screen.getAllByText('Optional')).toHaveLength(1);
  });

  it('never lists type or customerType - those stay permanently hard-required', async () => {
    mockCapabilities(['MASTER_DATA_APPOINTMENT_FIELD_CONFIG_MANAGE']);
    renderPage();

    await screen.findByText('Job Type');
    expect(screen.queryByText('type')).not.toBeInTheDocument();
    expect(screen.queryByText('customerType')).not.toBeInTheDocument();
  });

  it('toggles a field mandatory via the switch when the caller can manage', async () => {
    vi.mocked(updateAppointmentFieldConfig).mockResolvedValue(config({ id: 'cfg-2', fieldKey: 'channel', fieldLabel: 'Channel', isMandatory: true }));
    mockCapabilities(['MASTER_DATA_APPOINTMENT_FIELD_CONFIG_MANAGE']);
    renderPage();

    const channelSwitch = await screen.findByLabelText('Mandatory: Channel');
    fireEvent.click(channelSwitch);

    await waitFor(() => expect(updateAppointmentFieldConfig).toHaveBeenCalledWith('cfg-2', true));
  });

  it('disables every switch and shows a view-only note for a caller without the manage capability', async () => {
    mockCapabilities([]);
    renderPage();

    const jobTypeSwitch = await screen.findByLabelText('Mandatory: Job Type');
    expect(jobTypeSwitch).toBeDisabled();
    expect(screen.getByText(/view-only access/i)).toBeInTheDocument();
  });

  it('shows the empty-seed message when no rows exist', async () => {
    vi.mocked(listAppointmentFieldConfigs).mockResolvedValue([]);
    mockCapabilities([]);
    renderPage();

    expect(await screen.findByText(/run the seed script/i)).toBeInTheDocument();
  });
});

// Job Type split (requested 2026-09-22), Phase 6 - Job Type column/filter and the
// separate Visible/Hidden toggle.
describe('AppointmentFieldConfigPage - Job Type matrix', () => {
  function jobTypeScopedRows() {
    return [
      config({ id: 'cfg-global', fieldKey: 'invoiceNumber', fieldLabel: 'Invoice Number', isMandatory: false, jobType: null, isVisible: true }),
      config({
        id: 'cfg-installation',
        fieldKey: 'invoiceNumber',
        fieldLabel: 'Invoice Number',
        isMandatory: false,
        jobType: 'INSTALLATION',
        isVisible: false,
      }),
    ];
  }

  it('shows "All job types" for a global row and the Job Type name for a scoped row', async () => {
    vi.mocked(listAppointmentFieldConfigs).mockResolvedValue(jobTypeScopedRows());
    mockCapabilities(['MASTER_DATA_APPOINTMENT_FIELD_CONFIG_MANAGE']);
    renderPage();

    expect(await screen.findAllByText('All job types')).toHaveLength(1);
    expect(screen.getByText('INSTALLATION')).toBeInTheDocument();
  });

  it('filters to only the selected Job Type\'s override rows', async () => {
    vi.mocked(listAppointmentFieldConfigs).mockResolvedValue(jobTypeScopedRows());
    mockCapabilities(['MASTER_DATA_APPOINTMENT_FIELD_CONFIG_MANAGE']);
    renderPage();
    await screen.findAllByText('Invoice Number');

    fireEvent.change(screen.getByLabelText('Filter: Job Type'), { target: { value: 'INSTALLATION' } });

    expect(screen.getAllByText('Invoice Number')).toHaveLength(1);
    expect(screen.getByText('Hidden')).toBeInTheDocument();
  });

  it('shows the row as Hidden and disables its Mandatory switch when isVisible is false', async () => {
    vi.mocked(listAppointmentFieldConfigs).mockResolvedValue(jobTypeScopedRows());
    mockCapabilities(['MASTER_DATA_APPOINTMENT_FIELD_CONFIG_MANAGE']);
    renderPage();

    const mandatorySwitch = await screen.findByLabelText('Mandatory: Invoice Number (INSTALLATION)');
    expect(mandatorySwitch).toBeDisabled();
    expect(screen.getByText('Hidden')).toBeInTheDocument();
  });

  it('toggles isVisible via the Visible/Hidden switch when the caller can manage', async () => {
    vi.mocked(listAppointmentFieldConfigs).mockResolvedValue(jobTypeScopedRows());
    vi.mocked(updateAppointmentFieldConfigVisibility).mockResolvedValue(jobTypeScopedRows()[1]);
    mockCapabilities(['MASTER_DATA_APPOINTMENT_FIELD_CONFIG_MANAGE']);
    renderPage();

    const visibilitySwitch = await screen.findByLabelText('Visible: Invoice Number (INSTALLATION)');
    fireEvent.click(visibilitySwitch);

    await waitFor(() => expect(updateAppointmentFieldConfigVisibility).toHaveBeenCalledWith('cfg-installation', true));
  });
});
