import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../lib/toast';

vi.mock('../../lib/technicianScheduleApi', () => ({ getGanttBoard: vi.fn() }));
vi.mock('../../lib/workshopApi', () => ({ addCrewHelper: vi.fn() }));

import { getGanttBoard } from '../../lib/technicianScheduleApi';
import { addCrewHelper } from '../../lib/workshopApi';
import { TechnicianGanttPage } from './TechnicianGanttPage';
import type { GanttBoard } from '../../lib/technicianScheduleTypes';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ToastProvider>
          <TechnicianGanttPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function board(overrides: Partial<GanttBoard> = {}): GanttBoard {
  return {
    date: '2026-09-09',
    rows: [
      {
        technicianId: 'tech-1',
        technicianName: 'Ravi Kumar',
        role: 'TECHNICIAN_FIELD',
        hasConflict: false,
        blocks: [
          {
            id: 'apt-1',
            type: 'appointment',
            technicianId: 'tech-1',
            refId: 'apt-1',
            refNumber: 'APT-0001',
            detail: 'Jane Doe',
            status: 'SCHEDULED',
            startAt: '2026-09-09T09:00:00.000Z',
            endAt: '2026-09-09T10:00:00.000Z',
            ongoing: false,
            hasConflict: false,
          },
        ],
      },
      {
        technicianId: 'tech-2',
        technicianName: 'Ali Hassan',
        role: 'TECHNICIAN_WORKSHOP',
        hasConflict: false,
        blocks: [
          {
            id: 'jc-1',
            type: 'workshop_job',
            technicianId: 'tech-2',
            refId: 'jc-1',
            refNumber: 'JC-0100',
            detail: 'Primary assignment',
            status: 'IN_PROGRESS',
            startAt: '2026-09-09T08:00:00.000Z',
            endAt: '2026-09-09T12:00:00.000Z',
            ongoing: true,
            hasConflict: false,
          },
        ],
      },
      {
        technicianId: 'tech-3',
        technicianName: 'Sunil Perera',
        role: 'TECHNICIAN_WORKSHOP',
        hasConflict: false,
        blocks: [],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getGanttBoard).mockReset();
  vi.mocked(addCrewHelper).mockReset();
});

describe('TechnicianGanttPage', () => {
  it('loads the board for today by default and renders each technician row', async () => {
    vi.mocked(getGanttBoard).mockResolvedValue(board());

    renderPage();

    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('Ali Hassan')).toBeInTheDocument();
    expect(screen.getByText('APT-0001')).toBeInTheDocument();
    expect(screen.getByText('JC-0100')).toBeInTheDocument();
  });

  it('shows a "no assignments" note for a technician with an empty block list', async () => {
    vi.mocked(getGanttBoard).mockResolvedValue(board());

    renderPage();

    expect(await screen.findByText('Sunil Perera')).toBeInTheDocument();
    expect(screen.getByText('No assignments today')).toBeInTheDocument();
  });

  it('surfaces a conflict summary and flags the double-booked technician row', async () => {
    const conflicted = board();
    conflicted.rows[0].hasConflict = true;
    conflicted.rows[0].blocks[0].hasConflict = true;
    vi.mocked(getGanttBoard).mockResolvedValue(conflicted);

    renderPage();

    expect(await screen.findByText('1 technician double-booked today')).toBeInTheDocument();
    expect(screen.getByText('Double-booked')).toBeInTheDocument();
  });

  it('re-fetches the board when the date changes', async () => {
    vi.mocked(getGanttBoard).mockResolvedValue(board());
    renderPage();
    await screen.findByText('Ravi Kumar');

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-10' } });

    await waitFor(() => expect(getGanttBoard).toHaveBeenCalledWith('2026-09-10'));
  });

  it('offers "+ Helper" only on an actively-assigned workshop_job block, not an appointment block', async () => {
    vi.mocked(getGanttBoard).mockResolvedValue(board());
    renderPage();
    await screen.findByText('JC-0100');

    // One "+ Helper" button total (the workshop_job block) - the appointment block gets none.
    expect(screen.getAllByRole('button', { name: '+ Helper' })).toHaveLength(1);
  });

  it('does not offer "+ Helper" on a workshop_job block that is no longer actively assigned (e.g. READY_FOR_QC)', async () => {
    const b = board();
    b.rows[1].blocks[0].status = 'READY_FOR_QC';
    vi.mocked(getGanttBoard).mockResolvedValue(b);
    renderPage();
    await screen.findByText('JC-0100');

    expect(screen.queryByRole('button', { name: '+ Helper' })).not.toBeInTheDocument();
  });

  it('opens the Add Crew Helper modal, excludes the primary assignee, and adds a helper', async () => {
    const user = userEvent.setup();
    vi.mocked(getGanttBoard).mockResolvedValue(board());
    vi.mocked(addCrewHelper).mockResolvedValue({
      id: 'helper-1',
      jobCardId: 'jc-1',
      technicianId: 'tech-3',
      addedByUserId: 'lead-1',
      addedAt: '2026-09-09T10:00:00Z',
      removedByUserId: null,
      removedAt: null,
    } as any);

    renderPage();
    await screen.findByText('JC-0100');

    await user.click(screen.getByRole('button', { name: '+ Helper' }));
    expect(await screen.findByText('Add crew helper — JC-0100')).toBeInTheDocument();

    // tech-2 (the primary assignee on jc-1) must not be offered as a helper candidate;
    // tech-3 (the other workshop technician, currently idle) should be.
    const select = screen.getByRole('combobox');
    const optionLabels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(optionLabels).not.toContain('Ali Hassan');
    expect(optionLabels).toContain('Sunil Perera');

    await user.selectOptions(select, 'tech-3');
    await user.click(screen.getByRole('button', { name: 'Add helper' }));

    await waitFor(() => expect(addCrewHelper).toHaveBeenCalledWith('jc-1', { technicianId: 'tech-3' }));
    await waitFor(() => expect(screen.queryByText('Add crew helper — JC-0100')).not.toBeInTheDocument());
  });

  it('shows a fallback message when no other workshop technicians are available to help', async () => {
    const user = userEvent.setup();
    const b = board({
      rows: [
        {
          technicianId: 'tech-2',
          technicianName: 'Ali Hassan',
          role: 'TECHNICIAN_WORKSHOP',
          hasConflict: false,
          blocks: [
            {
              id: 'jc-1',
              type: 'workshop_job',
              technicianId: 'tech-2',
              refId: 'jc-1',
              refNumber: 'JC-0100',
              detail: 'Primary assignment',
              status: 'IN_PROGRESS',
              startAt: '2026-09-09T08:00:00.000Z',
              endAt: '2026-09-09T12:00:00.000Z',
              ongoing: true,
              hasConflict: false,
            },
          ],
        },
      ],
    });
    vi.mocked(getGanttBoard).mockResolvedValue(b);

    renderPage();
    await screen.findByText('JC-0100');
    await user.click(screen.getByRole('button', { name: '+ Helper' }));

    expect(await screen.findByText(/No other workshop technicians are available/)).toBeInTheDocument();
  });
});
