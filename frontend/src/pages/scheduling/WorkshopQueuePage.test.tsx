import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../lib/toast';

vi.mock('../../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/technicianScheduleApi', () => ({
  getWorkshopQueue: vi.fn(),
  setWorkshopCapacity: vi.fn(),
}));

import { useAuth } from '../../lib/auth';
import { getWorkshopQueue, setWorkshopCapacity } from '../../lib/technicianScheduleApi';
import { WorkshopQueuePage } from './WorkshopQueuePage';
import type { WorkshopQueueBoard } from '../../lib/technicianScheduleTypes';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ToastProvider>
          <WorkshopQueuePage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

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

function board(overrides: Partial<WorkshopQueueBoard> = {}): WorkshopQueueBoard {
  return {
    technicians: [
      {
        id: 'wtech-1',
        name: 'Ali Hassan',
        capacity: 6,
        activeCount: 2,
        overCapacity: false,
        jobs: [
          {
            id: 'jc-1',
            jobCardNumber: 'JC-0001',
            status: 'IN_PROGRESS',
            faultCode: 'F001',
            symptomCode: 'S001',
            warrantyStatus: 'IN_WARRANTY',
            workshopAssignedAt: '2026-09-08T08:00:00.000Z',
          },
          {
            id: 'jc-2',
            jobCardNumber: 'JC-0002',
            status: 'WORKSHOP_ASSIGNED',
            faultCode: 'F002',
            symptomCode: 'S002',
            warrantyStatus: 'OUT_OF_WARRANTY',
            workshopAssignedAt: '2026-09-09T08:00:00.000Z',
          },
        ],
      },
    ],
    unassignedJobCards: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getWorkshopQueue).mockReset();
  vi.mocked(setWorkshopCapacity).mockReset();
  mockUser('TECHNICAL_TEAM_LEADER');
});

describe('WorkshopQueuePage', () => {
  it('renders jobs in the FIFO order the backend returns them, with position numbers', async () => {
    vi.mocked(getWorkshopQueue).mockResolvedValue(board());
    renderPage();

    expect(await screen.findByText('Ali Hassan')).toBeInTheDocument();
    const numbers = screen.getAllByText(/^JC-000\d$/).map((el) => el.textContent);
    expect(numbers).toEqual(['JC-0001', 'JC-0002']);
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
  });

  it('shows the over-capacity warning without disabling or hiding anything', async () => {
    vi.mocked(getWorkshopQueue).mockResolvedValue(
      board({
        technicians: [
          {
            id: 'wtech-1',
            name: 'Ali Hassan',
            capacity: 1,
            activeCount: 2,
            overCapacity: true,
            jobs: [
              {
                id: 'jc-1',
                jobCardNumber: 'JC-0001',
                status: 'IN_PROGRESS',
                faultCode: 'F1',
                symptomCode: 'S1',
                warrantyStatus: 'IN_WARRANTY',
                workshopAssignedAt: '2026-09-08T08:00:00.000Z',
              },
              {
                id: 'jc-2',
                jobCardNumber: 'JC-0002',
                status: 'IN_PROGRESS',
                faultCode: 'F2',
                symptomCode: 'S2',
                warrantyStatus: 'IN_WARRANTY',
                workshopAssignedAt: '2026-09-09T08:00:00.000Z',
              },
            ],
          },
        ],
      }),
    );
    renderPage();

    expect(await screen.findByText(/over capacity, queuing as backlog/i)).toBeInTheDocument();
    // Both jobs still render - overCapacity never blocks anything.
    expect(screen.getByText('JC-0001')).toBeInTheDocument();
    expect(screen.getByText('JC-0002')).toBeInTheDocument();
  });

  it('lets a Team Leader edit and save a technician\'s capacity', async () => {
    const user = userEvent.setup();
    vi.mocked(getWorkshopQueue).mockResolvedValue(board());
    vi.mocked(setWorkshopCapacity).mockResolvedValue({ id: 'wtech-1', workshopDailyCapacity: 10 });
    renderPage();

    await screen.findByText('Ali Hassan');
    await user.click(screen.getByRole('button', { name: 'Edit capacity' }));
    const input = screen.getByRole('spinbutton');
    await user.clear(input);
    await user.type(input, '10');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(setWorkshopCapacity).toHaveBeenCalledWith('wtech-1', 10));
  });

  it('hides the capacity edit control for a role outside CAPACITY_EDIT_ROLES', async () => {
    mockUser('QC_OFFICER');
    vi.mocked(getWorkshopQueue).mockResolvedValue(board());
    renderPage();

    await screen.findByText('Ali Hassan');
    expect(screen.queryByRole('button', { name: 'Edit capacity' })).not.toBeInTheDocument();
  });

  it('renders the unassigned job card pool with a journey link', async () => {
    vi.mocked(getWorkshopQueue).mockResolvedValue(
      board({
        unassignedJobCards: [
          { id: 'jc-9', jobCardNumber: 'JC-0300', faultCode: 'F009', symptomCode: 'S009', warrantyStatus: 'IN_WARRANTY', createdAt: '2026-09-08T12:00:00.000Z' },
        ],
      }),
    );
    renderPage();

    expect(await screen.findByText('JC-0300')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view journey/i })).toHaveAttribute('href', '/job-cards/journey?jobCardId=jc-9');
  });

  it('shows an empty state when no active workshop technicians exist', async () => {
    vi.mocked(getWorkshopQueue).mockResolvedValue(board({ technicians: [] }));
    renderPage();

    expect(await screen.findByText(/no active workshop technicians found/i)).toBeInTheDocument();
  });
});
