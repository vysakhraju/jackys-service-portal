import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ServiceCentre } from '../../lib/masterDataTypes';
import type { User } from '../../lib/types';

vi.mock('../../lib/masterDataApi', () => ({
  listServiceCentres: vi.fn(),
  createServiceCentre: vi.fn(),
  updateServiceCentre: vi.fn(),
  deleteServiceCentre: vi.fn(),
}));
vi.mock('../../lib/usersApi', () => ({ listUsers: vi.fn() }));

import { listServiceCentres, createServiceCentre, updateServiceCentre } from '../../lib/masterDataApi';
import { listUsers } from '../../lib/usersApi';
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

function fieldTech(id: string, firstName: string, lastName: string, status: User['status'] = 'ACTIVE'): User {
  return {
    id,
    firstName,
    lastName,
    email: `${firstName.toLowerCase()}@jackys.com`,
    employeeId: null,
    phone: null,
    status,
    role: { id: 'r-field', name: 'TECHNICIAN_FIELD', displayName: 'Field Technician', description: null, permissions: [], isSystem: true },
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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
  vi.mocked(listUsers).mockReset().mockResolvedValue([
    fieldTech('tech-1', 'Ravi', 'Kumar'),
    fieldTech('tech-2', 'Fahad', 'Noor'),
    fieldTech('tech-3', 'Inactive', 'Tech', 'INACTIVE'),
    {
      ...fieldTech('tech-4', 'Wasim', 'Workshop'),
      role: { id: 'r-workshop', name: 'TECHNICIAN_WORKSHOP', displayName: 'Workshop Technician', description: null, permissions: [], isSystem: true },
    },
  ]);
});

describe('ServiceCentresPage - field technician assignment', () => {
  it('lists a table column flagging a centre with no technicians assigned', async () => {
    renderPage();

    expect(await screen.findByText('None assigned')).toBeInTheDocument();
  });

  it('shows only active Field Technicians in the assignment picker, not workshop or inactive ones', async () => {
    renderPage();
    fireEvent.click(screen.getByText('+ New Service Centre'));

    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('Fahad Noor')).toBeInTheDocument();
    expect(screen.queryByText('Inactive Tech')).not.toBeInTheDocument();
    expect(screen.queryByText('Wasim Workshop')).not.toBeInTheDocument();
  });

  it('shows a helpful empty state when there are no active field technicians at all', async () => {
    vi.mocked(listUsers).mockResolvedValue([]);
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
