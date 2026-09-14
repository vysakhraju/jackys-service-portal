import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ServiceCentre } from '../../lib/masterDataTypes';

vi.mock('../../lib/masterDataApi', () => ({
  listServiceCentres: vi.fn(),
  createServiceCentre: vi.fn(),
  updateServiceCentre: vi.fn(),
  deleteServiceCentre: vi.fn(),
  listFieldTechnicians: vi.fn(),
}));

import { listServiceCentres, createServiceCentre, updateServiceCentre, listFieldTechnicians } from '../../lib/masterDataApi';
import { ServiceCentresPage } from './ServiceCentresPage';

function centre(overrides: Partial<ServiceCentre> = {}): ServiceCentre {
  return {
    id: 'sc-1',
    code: 'DXB-01',
    name: 'Dubai Service Centre',
    country: 'UAE',
    address: null,
    city: 'Dubai',
    schedule: {},
    assignedTechnicianIds: [],
    isActive: true,
    vatRate: 5,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ServiceCentresPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listServiceCentres).mockReset().mockResolvedValue([centre()]);
  vi.mocked(createServiceCentre).mockReset();
  vi.mocked(updateServiceCentre).mockReset();
  // #218/#253: GET /users (admin-only) replaced with the new, CCE-reachable
  // GET /master-data/service-centres/field-technicians - already active-Field-Technician-
  // only server-side (see master-data.service.spec.ts's listActiveFieldTechnicians tests),
  // so the mock here reflects that filtering, not a client-side one anymore.
  vi.mocked(listFieldTechnicians).mockReset().mockResolvedValue([
    { id: 'tech-1', name: 'Ravi Kumar' },
    { id: 'tech-2', name: 'Fahad Noor' },
  ]);
});

describe('ServiceCentresPage - field technician assignment', () => {
  it('lists a table column flagging a centre with no technicians assigned', async () => {
    renderPage();

    expect(await screen.findByText('None assigned')).toBeInTheDocument();
  });

  it('shows the active Field Technicians the backend returns in the assignment picker', async () => {
    renderPage();
    fireEvent.click(screen.getByText('+ New Service Centre'));

    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('Fahad Noor')).toBeInTheDocument();
  });

  it('shows a helpful empty state when there are no active field technicians at all', async () => {
    vi.mocked(listFieldTechnicians).mockResolvedValue([]);
    renderPage();
    fireEvent.click(screen.getByText('+ New Service Centre'));

    expect(await screen.findByText(/No active Field Technicians exist yet/)).toBeInTheDocument();
  });

  it('submits the checked technician ids as assignedTechnicianIds on create', async () => {
    vi.mocked(createServiceCentre).mockResolvedValue(centre());
    renderPage();
    fireEvent.click(screen.getByText('+ New Service Centre'));

    fireEvent.change(screen.getByPlaceholderText('DXB-01'), { target: { value: 'SHJ-01' } });
    fireEvent.change(screen.getByPlaceholderText('Dubai Service Centre'), { target: { value: 'Sharjah Service Centre' } });
    fireEvent.click(await screen.findByText('Ravi Kumar'));
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() =>
      expect(createServiceCentre).toHaveBeenCalledWith(expect.objectContaining({ assignedTechnicianIds: ['tech-1'] })),
    );
  });

  it('pre-checks a centre\'s already-assigned technicians when editing, and unchecking one removes it on save', async () => {
    vi.mocked(listServiceCentres).mockResolvedValue([centre({ assignedTechnicianIds: ['tech-1', 'tech-2'] })]);
    vi.mocked(updateServiceCentre).mockResolvedValue(centre());
    renderPage();

    fireEvent.click(await screen.findByText('Edit'));
    const raviCheckbox = (await screen.findByText('Ravi Kumar')).closest('label')!.querySelector('input')!;
    const fahadCheckbox = screen.getByText('Fahad Noor').closest('label')!.querySelector('input')!;
    expect(raviCheckbox).toBeChecked();
    expect(fahadCheckbox).toBeChecked();

    fireEvent.click(fahadCheckbox);
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() =>
      expect(updateServiceCentre).toHaveBeenCalledWith('sc-1', expect.objectContaining({ assignedTechnicianIds: ['tech-1'] })),
    );
  });

  it('drops stale technician ids (deactivated since, or malformed) instead of resending them on save', async () => {
    // Real bug: DXB-01 still had ids from technicians deactivated in the 2026-09-09
    // cleanup (plus one non-UUID legacy value) sitting in assignedTechnicianIds. None
    // of those render as a checked box (they aren't in the active-field-tech list), but
    // without filtering they rode along in state and got resent on save, where the
    // backend's @IsUUID validator rejected the whole array - permanently blocking that
    // centre from being saved at all.
    vi.mocked(listServiceCentres).mockResolvedValue([
      centre({ assignedTechnicianIds: ['tech-1', 'deactivated-tech-id', 'not-a-uuid'] }),
    ]);
    vi.mocked(updateServiceCentre).mockResolvedValue(centre());
    renderPage();

    fireEvent.click(await screen.findByText('Edit'));
    const raviCheckbox = (await screen.findByText('Ravi Kumar')).closest('label')!.querySelector('input')!;
    expect(raviCheckbox).toBeChecked();

    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() =>
      expect(updateServiceCentre).toHaveBeenCalledWith('sc-1', expect.objectContaining({ assignedTechnicianIds: ['tech-1'] })),
    );
  });
});
