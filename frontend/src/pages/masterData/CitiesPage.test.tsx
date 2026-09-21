import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { City } from '../../lib/masterDataTypes';

vi.mock('../../lib/masterDataApi', () => ({
  listCities: vi.fn(),
  createCity: vi.fn(),
  updateCity: vi.fn(),
  deleteCity: vi.fn(),
}));
vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));

import { listCities, createCity, updateCity, deleteCity } from '../../lib/masterDataApi';
import { useAuth } from '../../lib/auth';
import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { CitiesPage } from './CitiesPage';

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

function city(overrides: Partial<City> = {}): City {
  return {
    id: 'city-1',
    name: 'Dubai',
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
      <CitiesPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listCities).mockReset().mockResolvedValue([city()]);
  vi.mocked(createCity).mockReset();
  vi.mocked(updateCity).mockReset();
  vi.mocked(deleteCity).mockReset();
  mockUser('SUPER_ADMIN');
  mockCapabilities([], true);
});

describe('CitiesPage - action visibility by capability/role', () => {
  it('hides Edit/Delete for a role with none of the relevant grants and isn\'t SUPER_ADMIN', async () => {
    mockUser('CCE');
    mockCapabilities([]);
    renderPage();

    await screen.findByText('Dubai');
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('shows Edit once MASTER_DATA_CITY_MANAGE is granted, but never shows Delete for a non-SUPER_ADMIN role', async () => {
    mockUser('CCE');
    mockCapabilities(['MASTER_DATA_CITY_MANAGE']);
    renderPage();

    expect(await screen.findByText('Edit')).toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('shows Delete for SUPER_ADMIN even with zero explicit capability grants', async () => {
    mockUser('SUPER_ADMIN');
    mockCapabilities([], false);
    renderPage();

    await screen.findByText('Dubai');
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });
});

describe('CitiesPage - create/edit/delete', () => {
  it('creates a new city via the modal form', async () => {
    vi.mocked(createCity).mockResolvedValue(city({ id: 'city-2', name: 'Abu Dhabi' }));
    renderPage();

    fireEvent.click(await screen.findByText('+ New City'));
    fireEvent.change(screen.getByPlaceholderText('Dubai'), { target: { value: 'Abu Dhabi' } });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() =>
      expect(createCity).toHaveBeenCalledWith({ name: 'Abu Dhabi', isActive: true }),
    );
  });

  it('opens pre-filled from the row and saves an edit via updateCity', async () => {
    vi.mocked(updateCity).mockResolvedValue(city({ name: 'Dubai Marina' }));
    renderPage();

    fireEvent.click(await screen.findByText('Edit'));
    expect(await screen.findByDisplayValue('Dubai')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Dubai'), { target: { value: 'Dubai Marina' } });
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() =>
      expect(updateCity).toHaveBeenCalledWith('city-1', expect.objectContaining({ name: 'Dubai Marina' })),
    );
  });

  it('deletes (soft) after the confirm dialog is accepted', async () => {
    vi.mocked(deleteCity).mockResolvedValue(undefined as any);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    fireEvent.click(await screen.findByText('Delete'));

    await waitFor(() => expect(deleteCity).toHaveBeenCalledWith('city-1'));
  });

  it('does not delete when the confirm dialog is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();

    fireEvent.click(await screen.findByText('Delete'));

    expect(deleteCity).not.toHaveBeenCalled();
  });
});
