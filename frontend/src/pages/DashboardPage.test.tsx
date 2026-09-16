import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/dashboardApi', () => ({ getDashboardOverview: vi.fn() }));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

import { useAuth } from '../lib/auth';
import { getDashboardOverview } from '../lib/dashboardApi';
import { DashboardPage } from './DashboardPage';

beforeAll(() => {
  (global as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  navigate.mockReset();
  vi.mocked(useAuth).mockReturnValue({
    user: { firstName: 'Priya', lastName: 'Nair' },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
  } as any);
});

describe('DashboardPage', () => {
  it('greets the user by first name', async () => {
    vi.mocked(getDashboardOverview).mockResolvedValue({ widgets: {} });
    renderPage();
    expect(screen.getByText('Welcome, Priya')).toBeInTheDocument();
  });

  it('shows an empty-widgets notice when the caller holds no dashboard widget capability', async () => {
    vi.mocked(getDashboardOverview).mockResolvedValue({ widgets: {} });
    renderPage();
    expect(await screen.findByText(/No dashboard widgets are enabled for your role yet/)).toBeInTheDocument();
  });

  it('renders only the widgets present in the response, not the ones absent from it', async () => {
    vi.mocked(getDashboardOverview).mockResolvedValue({
      widgets: {
        jobsByStatus: { columns: [{ key: 'WIP', label: 'WIP', count: 3 }], totalActiveJobs: 3 },
      },
    });
    renderPage();

    expect(await screen.findByText('Jobs by Status')).toBeInTheDocument();
    expect(screen.queryByText('Workshop Queue')).not.toBeInTheDocument();
    expect(screen.queryByText('SLA Breach')).not.toBeInTheDocument();
    expect(screen.queryByText('Spare Parts Consumption')).not.toBeInTheDocument();
  });

  it('navigates to the Job Status Board when the Jobs by Status widget action is clicked', async () => {
    vi.mocked(getDashboardOverview).mockResolvedValue({
      widgets: { jobsByStatus: { columns: [{ key: 'WIP', label: 'WIP', count: 3 }], totalActiveJobs: 3 } },
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Open Job Status Board →' }));
    expect(navigate).toHaveBeenCalledWith('/reports');
  });

  it('navigates to the Workshop Queue when that widget action is clicked', async () => {
    vi.mocked(getDashboardOverview).mockResolvedValue({
      widgets: { workshopQueue: { technicians: [], totalActive: 0, unassignedCount: 0 } },
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Open Workshop Queue →' }));
    expect(navigate).toHaveBeenCalledWith('/technician-schedule/workshop-queue');
  });

  it('navigates to a job card journey when an SLA breach row is clicked', async () => {
    vi.mocked(getDashboardOverview).mockResolvedValue({
      widgets: {
        slaBreach: {
          asOf: '2026-09-15T00:00:00Z',
          thresholdHours: 48,
          breachedCount: 1,
          topItems: [{ jobCardId: 'jc-1', jobCardNumber: 'JC-0001', hoursOverThreshold: 4 }],
        },
      },
    });
    renderPage();

    fireEvent.click(await screen.findByText('JC-0001'));
    expect(navigate).toHaveBeenCalledWith('/job-cards/journey?jobCardId=jc-1');
  });

  it('navigates to AMC Contracts when the AMC Status widget action is clicked', async () => {
    vi.mocked(getDashboardOverview).mockResolvedValue({
      widgets: {
        amcStatus: { activeCount: 12, expiringSoonCount: 2, expiringSoonWithinDays: 30, upsellCandidatesCount: 1 },
      },
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Open AMC Contracts →' }));
    expect(navigate).toHaveBeenCalledWith('/amc/contracts');
  });

  it('routes the Delivery & Invoicing widget to its own two destinations', async () => {
    vi.mocked(getDashboardOverview).mockResolvedValue({
      widgets: { deliveryInvoicing: { readyForDeliveryCount: 4, b2bOutstandingAmount: 500 } },
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Open Ready for Delivery →' }));
    expect(navigate).toHaveBeenCalledWith('/delivery/ready');

    fireEvent.click(screen.getByText('AED 500.00'));
    expect(navigate).toHaveBeenCalledWith('/finance/aging');
  });

  it('navigates to Finance Reports when the Finance Summary widget action is clicked', async () => {
    vi.mocked(getDashboardOverview).mockResolvedValue({
      widgets: { financeSummary: { totalServiceRevenue: 1000, totalAmcRevenue: 200, activeAmcContracts: 3 } },
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Open Finance Reports →' }));
    expect(navigate).toHaveBeenCalledWith('/reports/finance');
  });
});
