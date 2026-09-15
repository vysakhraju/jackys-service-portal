import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../lib/toast';

// 2026-09-14 live-tested finding: the capacity-edit gate moved from a hardcoded
// CAPACITY_EDIT_ROLES role list to the designation permission matrix's WORKSHOP_ASSIGN
// capability (useMyCapabilities()) - a Designation-access grant to a new role had no
// effect against the static list. See ServiceCentresPage.test.tsx / ReportsPage.test.tsx
// for the same class of fix elsewhere.
vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/technicianScheduleApi', () => ({
  getWorkshopQueue: vi.fn(),
  setWorkshopCapacity: vi.fn(),
}));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
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

// Modification Request 2026-09-16: same reasoning as OperationalReportsPage.test.tsx's own
// helper of the same shape - a real destination route is needed to prove a whole-row click
// actually navigates, not just that the inner Link has the right href.
function renderPageWithJourneyRoute() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <ToastProvider>
          <Routes>
            <Route path="/" element={<WorkshopQueuePage />} />
            <Route path="/job-cards/journey" element={<div>Journey destination reached</div>} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
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
  mockCapabilities(['WORKSHOP_QUEUE_VIEW', 'WORKSHOP_ASSIGN']);
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

  it('hides the capacity edit control for a role lacking WORKSHOP_ASSIGN, while still able to view the board', async () => {
    mockCapabilities(['WORKSHOP_QUEUE_VIEW']);
    vi.mocked(getWorkshopQueue).mockResolvedValue(board());
    renderPage();

    await screen.findByText('Ali Hassan');
    expect(screen.queryByRole('button', { name: 'Edit capacity' })).not.toBeInTheDocument();
  });

  it('shows the capacity edit control once WORKSHOP_ASSIGN is granted to any role via Designation access', async () => {
    mockCapabilities(['WORKSHOP_QUEUE_VIEW', 'WORKSHOP_ASSIGN']);
    vi.mocked(getWorkshopQueue).mockResolvedValue(board());
    renderPage();

    await screen.findByText('Ali Hassan');
    expect(screen.getByRole('button', { name: 'Edit capacity' })).toBeInTheDocument();
  });

  // 2026-09-14 (Group B): the board itself used to render for every logged-in user - now
  // gated on WORKSHOP_QUEUE_VIEW, mirroring GET /workshop-queue's own
  // @RequiresCapability('WORKSHOP_QUEUE_VIEW').
  it('shows a restricted notice and never fetches the board for a caller with no WORKSHOP_QUEUE_VIEW capability', async () => {
    mockCapabilities([]);
    renderPage();

    expect(await screen.findByText(/Workshop Queue is restricted to Technical Team Leader/i)).toBeInTheDocument();
    expect(getWorkshopQueue).not.toHaveBeenCalled();
  });

  it('fetches the board for a role granted WORKSHOP_QUEUE_VIEW via Designation access, not just a default role', async () => {
    mockCapabilities(['WORKSHOP_QUEUE_VIEW']);
    vi.mocked(getWorkshopQueue).mockResolvedValue(board());
    renderPage();

    expect(await screen.findByText('Ali Hassan')).toBeInTheDocument();
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

// Modification Request 2026-09-16: "the card that shows number of jobs are now not
// clickable, make the same clickable and load like what we do for the report and
// dashboard section, clickable card with highlights also show TAT [hours pending]".
// No system-time mocking for the first three tests (real clock, real timers) - RTL's
// findBy/waitFor polling relies on real setTimeout, and the fixtures' fixed-in-the-past
// workshopAssignedAt values already guarantee a positive, plausible elapsed time without
// needing to pin "now".
describe('WorkshopQueuePage - clickable job rows with a live TAT badge (Modification Request 2026-09-16)', () => {
  it('shows an hours-pending TAT badge computed from workshopAssignedAt', async () => {
    vi.mocked(getWorkshopQueue).mockResolvedValue(board()); // JC-0001 assigned 2026-09-08 (well in the past)
    renderPage();

    await screen.findByText('JC-0001');
    expect(screen.getAllByText(/^\d+h(\s\d+m)?$/).length).toBeGreaterThan(0);
  });

  it('clicking anywhere on a job row (not just the job-card-number link) navigates to its Journey view', async () => {
    vi.mocked(getWorkshopQueue).mockResolvedValue(board());
    renderPageWithJourneyRoute();
    const user = userEvent.setup();

    // Click the fault/symptom line - not the JC-0001 link itself.
    const detailLine = await screen.findByText(/F001\/S001/);
    await user.click(detailLine);

    expect(await screen.findByText('Journey destination reached')).toBeInTheDocument();
  });

  it('the job-card-number link still carries the right href on its own', async () => {
    vi.mocked(getWorkshopQueue).mockResolvedValue(board());
    renderPage();

    const link = await screen.findByRole('link', { name: 'JC-0001' });
    expect(link).toHaveAttribute('href', '/job-cards/journey?jobCardId=jc-1');
  });

  // The "live, no refresh needed" behaviour itself (a once-a-minute setInterval driving
  // formatElapsedLabel) is a standard React ticking-clock pattern; its math is covered
  // thoroughly by elapsed-time.util.test.ts. `shouldAdvanceTime` keeps real wall-clock
  // progression alongside the fake clock, so react-query's fetch and RTL's findBy/waitFor
  // polling both still work normally - vi.advanceTimersByTime then additionally jumps the
  // clock forward by a full interval tick to prove the badge text actually changes.
  it('the TAT badge updates live without a page refresh as time passes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const startedAt = Date.now() - 90 * 60_000; // 1h30m ago
      vi.mocked(getWorkshopQueue).mockResolvedValue(
        board({
          technicians: [
            {
              id: 'wtech-1',
              name: 'Ali Hassan',
              capacity: 6,
              activeCount: 1,
              overCapacity: false,
              jobs: [
                {
                  id: 'jc-1',
                  jobCardNumber: 'JC-0001',
                  status: 'IN_PROGRESS',
                  faultCode: 'F001',
                  symptomCode: 'S001',
                  warrantyStatus: 'IN_WARRANTY',
                  workshopAssignedAt: new Date(startedAt).toISOString(),
                },
              ],
            },
          ],
        }),
      );
      renderPage();

      const badgeBefore = await screen.findByText(/^1h 3\dm$/); // "1h 30m" (± a little scheduling jitter)
      const textBefore = badgeBefore.textContent;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(screen.queryByText(textBefore!)).not.toBeInTheDocument();
      expect(screen.getByText(/^1h 3\dm$/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
