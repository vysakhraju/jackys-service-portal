import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AppointmentFieldConfig } from '../../lib/masterDataTypes';

vi.mock('../../lib/masterDataApi', () => ({
  listAppointmentFieldConfigs: vi.fn(),
  updateAppointmentFieldConfig: vi.fn(),
}));
vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));

import { listAppointmentFieldConfigs, updateAppointmentFieldConfig } from '../../lib/masterDataApi';
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

function config(overrides: Partial<AppointmentFieldConfig> = {}): AppointmentFieldConfig {
  return {
    id: 'cfg-1',
    fieldKey: 'jobType',
    fieldLabel: 'Job Type',
    isMandatory: true,
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
