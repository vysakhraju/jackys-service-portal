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
// #218/#253 follow-up (2026-09-14): the page now hides Create/Edit/Delete based on the
// caller's actual capabilities/role rather than always rendering them - see
// 'ServiceCentresPage - action visibility by capability/role' below for the gating itself.
// Every other describe block in this file exercises the page's actual field-technician
// behaviour and isn't about access control, so it defaults both mocks to "full access"
// (a SUPER_ADMIN) to keep those tests' focus unchanged.
vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));

import { listServiceCentres, createServiceCentre, updateServiceCentre, listFieldTechnicians } from '../../lib/masterDataApi';
import { useAuth } from '../../lib/auth';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { ServiceCentresPage } from './ServiceCentresPage';

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
  mockUser('SUPER_ADMIN');
  mockCapabilities([], true);
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

describe('ServiceCentresPage - action visibility by capability/role', () => {
  // Live-tested bug (2026-09-14): a CCE could open Master Data > Service Centres and see
  // the full list plus Create/Edit/Delete, only finding out those were blocked after
  // clicking (Delete is SUPER_ADMIN-only and was never in the capability matrix at all -
  // the backend always rejected it, the button just didn't know that). These tests pin
  // down that a role/capability lacking the relevant grant never even sees the control.
  it('hides all three actions for a role with none of the Service Centre capabilities and isn\'t SUPER_ADMIN', async () => {
    mockUser('CCE');
    mockCapabilities([]);
    renderPage();

    await screen.findByText('Dubai Service Centre');
    expect(screen.queryByText('+ New Service Centre')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('shows Create once MASTER_DATA_SERVICE_CENTRE_CREATE is granted, but not Edit or Delete', async () => {
    mockUser('CCE');
    mockCapabilities(['MASTER_DATA_SERVICE_CENTRE_CREATE']);
    renderPage();

    expect(await screen.findByText('+ New Service Centre')).toBeInTheDocument();
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('shows Edit once MASTER_DATA_SERVICE_CENTRE_UPDATE is granted, but never shows Delete for a non-SUPER_ADMIN role even with every capability granted', async () => {
    mockUser('CCE');
    mockCapabilities(['MASTER_DATA_SERVICE_CENTRE_UPDATE'], true);
    renderPage();

    expect(await screen.findByText('Edit')).toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('shows Delete for SUPER_ADMIN even with zero explicit capability grants (SUPER_ADMIN bypasses the matrix entirely)', async () => {
    mockUser('SUPER_ADMIN');
    mockCapabilities([], false);
    renderPage();

    await screen.findByText('Dubai Service Centre');
    // A real SUPER_ADMIN always has fullAccess:true from the backend - this case (role
    // SUPER_ADMIN but fullAccess:false) can't happen for real, but proves Delete is gated
    // on the ROLE name directly, independent of the capability matrix either way.
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });
});
