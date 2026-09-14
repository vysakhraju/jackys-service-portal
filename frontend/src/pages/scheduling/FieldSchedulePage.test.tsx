import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, createEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../lib/toast';

vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));
vi.mock('../../lib/technicianScheduleApi', () => ({
  getFieldSchedule: vi.fn(),
  reorderFieldSchedule: vi.fn(),
}));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { getFieldSchedule, reorderFieldSchedule } from '../../lib/technicianScheduleApi';
import { FieldSchedulePage } from './FieldSchedulePage';
import type { FieldScheduleBoard } from '../../lib/technicianScheduleTypes';

// 2026-09-14 (Group B): this page had zero frontend capability check at all - see
// FieldSchedulePage.tsx's own comment. mockCapabilities gates it on the real
// FIELD_SCHEDULE_REORDER capability; every existing test below defaults to full access so
// the board renders exactly as it did before this round's fix.
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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ToastProvider>
          <FieldSchedulePage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function board(overrides: Partial<FieldScheduleBoard> = {}): FieldScheduleBoard {
  return {
    date: '2026-09-09',
    technicians: [
      {
        id: 'tech-1',
        name: 'Ravi Kumar',
        appointments: [
          {
            id: 'apt-1',
            appointmentNumber: 'APT-0001',
            customerName: 'Jane Doe',
            status: 'CONFIRMED',
            scheduledAt: '2026-09-09T09:00:00.000Z',
            priorityOrder: null,
            estimatedDurationMinutes: 60,
          },
          {
            id: 'apt-2',
            appointmentNumber: 'APT-0002',
            customerName: 'Amir Khan',
            status: 'CONFIRMED',
            scheduledAt: '2026-09-09T14:00:00.000Z',
            priorityOrder: null,
            estimatedDurationMinutes: 45,
          },
        ],
      },
    ],
    unassignedAppointments: [],
    ...overrides,
  };
}

// Same jsdom DataTransfer workaround as TechnicianGanttPage.test.tsx.
function fakeDataTransfer() {
  const store = new Map<string, string>();
  return {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    get types() {
      return Array.from(store.keys());
    },
    effectAllowed: 'none' as string,
    dropEffect: 'none' as string,
  };
}

function fireDrag(type: 'dragStart' | 'dragOver' | 'drop', target: Element, dataTransfer: unknown) {
  const event = createEvent[type](target, { dataTransfer });
  fireEvent(target, event);
}

function dragAndDrop(source: Element, target: Element) {
  const dataTransfer = fakeDataTransfer();
  fireDrag('dragStart', source, dataTransfer);
  fireDrag('dragOver', target, dataTransfer);
  fireDrag('drop', target, dataTransfer);
}

beforeEach(() => {
  mockCapabilities([], true);
  vi.mocked(getFieldSchedule).mockReset();
  vi.mocked(reorderFieldSchedule).mockReset();
});

describe('FieldSchedulePage', () => {
  it('renders each technician\'s appointments in the order the backend returns, as a position list', async () => {
    vi.mocked(getFieldSchedule).mockResolvedValue(board());
    renderPage();

    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.getByText('APT-0001', { exact: false })).toBeInTheDocument();
  });

  it('dragging one job onto another within the same technician calls reorderFieldSchedule with the full new order, never touching scheduledAt', async () => {
    vi.mocked(getFieldSchedule).mockResolvedValue(board());
    vi.mocked(reorderFieldSchedule).mockResolvedValue([]);
    renderPage();

    await screen.findByText('Ravi Kumar');
    const source = screen.getByTestId('field-appt-apt-1');
    const target = screen.getByTestId('field-appt-apt-2');
    dragAndDrop(source, target);

    await waitFor(() =>
      expect(reorderFieldSchedule).toHaveBeenCalledWith('tech-1', ['apt-2', 'apt-1']),
    );
  });

  it('ignores a drop from a different technician\'s list (cross-technician move is not this page\'s job)', async () => {
    vi.mocked(getFieldSchedule).mockResolvedValue(
      board({
        technicians: [
          ...board().technicians,
          {
            id: 'tech-2',
            name: 'Fahad Noor',
            appointments: [
              {
                id: 'apt-3',
                appointmentNumber: 'APT-0003',
                customerName: 'Sara Ali',
                status: 'CONFIRMED',
                scheduledAt: '2026-09-09T10:00:00.000Z',
                priorityOrder: null,
                estimatedDurationMinutes: 30,
              },
            ],
          },
        ],
      }),
    );
    renderPage();

    await screen.findByText('Fahad Noor');
    const source = screen.getByTestId('field-appt-apt-1'); // tech-1's job
    const target = screen.getByTestId('field-appt-apt-3'); // tech-2's job
    dragAndDrop(source, target);

    expect(reorderFieldSchedule).not.toHaveBeenCalled();
  });

  it('shows a saving error and refetches rather than leaving a stale order on screen', async () => {
    vi.mocked(getFieldSchedule).mockResolvedValue(board());
    vi.mocked(reorderFieldSchedule).mockRejectedValue({ response: { data: { message: 'Conflict' } } });
    renderPage();

    await screen.findByText('Ravi Kumar');
    const source = screen.getByTestId('field-appt-apt-1');
    const target = screen.getByTestId('field-appt-apt-2');
    dragAndDrop(source, target);

    expect(await screen.findByText('Conflict')).toBeInTheDocument();
    await waitFor(() => expect(getFieldSchedule).toHaveBeenCalledTimes(2));
  });

  it('renders the unassigned appointment pool', async () => {
    vi.mocked(getFieldSchedule).mockResolvedValue(
      board({
        unassignedAppointments: [
          { id: 'apt-9', appointmentNumber: 'APT-0009', customerName: 'Amir', type: 'WARRANTY', scheduledAt: '2026-09-09T11:00:00.000Z', estimatedDurationMinutes: 45 },
        ],
      }),
    );
    renderPage();

    expect(await screen.findByText('APT-0009', { exact: false })).toBeInTheDocument();
  });

  it('shows an empty state when no active field technicians exist', async () => {
    vi.mocked(getFieldSchedule).mockResolvedValue(board({ technicians: [] }));
    renderPage();

    expect(await screen.findByText(/no active field technicians found/i)).toBeInTheDocument();
  });
});

// 2026-09-14 (Group B): the whole board used to render for every logged-in user - now
// gated on FIELD_SCHEDULE_REORDER, mirroring GET /field-schedule's own
// @RequiresCapability('FIELD_SCHEDULE_REORDER').
describe('FieldSchedulePage - capability gate', () => {
  it('shows a restricted notice and never fetches the board for a caller with no FIELD_SCHEDULE_REORDER capability', async () => {
    mockCapabilities([]);
    renderPage();

    expect(await screen.findByText(/Field Technician Schedule is restricted to CCE/i)).toBeInTheDocument();
    expect(getFieldSchedule).not.toHaveBeenCalled();
  });

  it('fetches and renders the board for a role granted FIELD_SCHEDULE_REORDER via Designation access, not just a default role', async () => {
    mockCapabilities(['FIELD_SCHEDULE_REORDER']);
    vi.mocked(getFieldSchedule).mockResolvedValue(board());
    renderPage();

    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument();
  });
});
