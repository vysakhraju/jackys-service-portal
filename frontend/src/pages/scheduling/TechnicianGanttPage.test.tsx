import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, createEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../lib/toast';

vi.mock('../../lib/technicianScheduleApi', () => ({ getGanttBoard: vi.fn() }));
vi.mock('../../lib/workshopApi', () => ({
  addCrewHelper: vi.fn(),
  assignWorkshopTechnician: vi.fn(),
  reassignWorkshopTechnician: vi.fn(),
}));
vi.mock('../../lib/appointmentsApi', () => ({
  assignTechnician: vi.fn(),
  updateAppointment: vi.fn(),
}));

import { getGanttBoard } from '../../lib/technicianScheduleApi';
import { addCrewHelper, assignWorkshopTechnician, reassignWorkshopTechnician } from '../../lib/workshopApi';
import { assignTechnician, updateAppointment } from '../../lib/appointmentsApi';
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
      {
        technicianId: 'tech-4',
        technicianName: 'Fahad Noor',
        role: 'TECHNICIAN_FIELD',
        hasConflict: false,
        blocks: [],
      },
    ],
    unassignedAppointments: [],
    unassignedJobCards: [],
    ...overrides,
  };
}

// jsdom implements DataTransfer.setData/getData poorly (and DragEvent's dataTransfer isn't
// wired up at all in some versions) - a small backing Map stands in for the real thing, same
// as the pattern testing-library's own docs use for HTML5 drag-and-drop.
function fakeDataTransfer() {
  const store = new Map<string, string>();
  return {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    get types() {
      // Real browsers expose .types (which MIME types are present) during dragover, but
      // lock getData() down to the 'drop' event only - the component relies on that split
      // to know what's being dragged (appointment vs job card) before the actual payload is
      // readable, so this fake needs to model it too.
      return Array.from(store.keys());
    },
    effectAllowed: 'none' as string,
    dropEffect: 'none' as string,
  };
}

// jsdom has no real DragEvent constructor (confirmed: window.DragEvent is undefined), so
// testing-library's fireEvent.drop({..., clientX}) silently falls back to a plain Event and
// drops any MouseEvent-only init keys like clientX - only createEvent()'s special-cased
// dataTransfer/clipboardData survive that fallback. Building the event via createEvent and
// setting clientX directly on it before dispatch works around that.
function fireDrag(type: 'dragStart' | 'dragEnter' | 'dragOver' | 'drop', target: Element, dataTransfer: unknown, clientX?: number) {
  const event = createEvent[type](target, { dataTransfer });
  if (clientX !== undefined) {
    Object.defineProperty(event, 'clientX', { value: clientX, configurable: true });
  }
  fireEvent(target, event);
}

function dragAndDrop(source: Element, target: Element, clientX = 500) {
  const dataTransfer = fakeDataTransfer();
  fireDrag('dragStart', source, dataTransfer);
  fireDrag('dragEnter', target, dataTransfer);
  fireDrag('dragOver', target, dataTransfer, clientX);
  fireDrag('drop', target, dataTransfer, clientX);
}

// Stops after dragOver, deliberately never firing 'drop' - lets a test assert on the live
// preview UI (data-testid="drop-preview") that only exists between dragenter/dragover and the
// eventual drop, without also triggering the drop mutation.
function dragOverOnly(source: Element, target: Element, clientX = 500) {
  const dataTransfer = fakeDataTransfer();
  fireDrag('dragStart', source, dataTransfer);
  fireDrag('dragEnter', target, dataTransfer);
  fireDrag('dragOver', target, dataTransfer, clientX);
  return dataTransfer;
}

beforeEach(() => {
  vi.mocked(getGanttBoard).mockReset();
  vi.mocked(addCrewHelper).mockReset();
  vi.mocked(assignWorkshopTechnician).mockReset();
  vi.mocked(reassignWorkshopTechnician).mockReset();
  vi.mocked(assignTechnician).mockReset();
  vi.mocked(updateAppointment).mockReset();

  // The board's timeline spans 07:00-21:00 UTC across the drop zone's full width - mocked
  // here to a clean 1000px so a given clientX maps to an exact, easy-to-assert time.
  // clientX 500 (the default dragAndDrop() uses) lands exactly on the midpoint, 14:00 UTC.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    right: 1000,
    width: 1000,
    top: 0,
    bottom: 40,
    height: 40,
    x: 0,
    y: 0,
    toJSON: () => {},
  } as DOMRect);
});

describe('TechnicianGanttPage', () => {
  it('loads the board for today by default and renders each technician row', async () => {
    vi.mocked(getGanttBoard).mockResolvedValue(board());

    renderPage();

    // { selector: 'p' } disambiguates from the technician filter dropdown's own <option>
    // text, which now also reads e.g. "Ravi Kumar" for every technician on the board.
    expect(await screen.findByText('Ravi Kumar', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Ali Hassan', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('APT-0001')).toBeInTheDocument();
    expect(screen.getByText('JC-0100')).toBeInTheDocument();
  });

  it('shows a "no assignments" note for a technician with an empty block list', async () => {
    vi.mocked(getGanttBoard).mockResolvedValue(board());

    renderPage();

    expect(await screen.findByText('Sunil Perera', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getAllByText('No assignments today').length).toBeGreaterThan(0);
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
    await screen.findByText('Ravi Kumar', { selector: 'p' });

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-10' } });

    await waitFor(() => expect(getGanttBoard).toHaveBeenCalledWith('2026-09-10'));
  });

  it('narrows the visible technician rows via the technician filter dropdown', async () => {
    const user = userEvent.setup();
    vi.mocked(getGanttBoard).mockResolvedValue(board());

    renderPage();
    await screen.findByText('Ravi Kumar', { selector: 'p' });
    expect(screen.getByText('Ali Hassan', { selector: 'p' })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Technician'), 'tech-1');

    expect(screen.getByText('Ravi Kumar', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText('Ali Hassan', { selector: 'p' })).not.toBeInTheDocument();
    expect(screen.queryByText('Sunil Perera', { selector: 'p' })).not.toBeInTheDocument();
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
    const heading = await screen.findByText('Add crew helper — JC-0100');
    // Scope to the modal itself - the page's own technician filter dropdown is also a
    // combobox, and would otherwise make getByRole('combobox') ambiguous.
    const modal = heading.closest('.w-full')!;

    // tech-2 (the primary assignee on jc-1) must not be offered as a helper candidate;
    // tech-3 (the other workshop technician, currently idle) should be.
    const select = within(modal).getByRole('combobox');
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

  it('shows empty-state messages for both unassigned panels when nothing is waiting', async () => {
    vi.mocked(getGanttBoard).mockResolvedValue(board());

    renderPage();

    expect(await screen.findByText('Every scheduled appointment today has a technician.')).toBeInTheDocument();
    expect(screen.getByText('No workshop job cards are waiting on a technician.')).toBeInTheDocument();
  });

  it('drags an unassigned appointment card onto a field technician\'s row, assigning it at the dropped time', async () => {
    vi.mocked(getGanttBoard).mockResolvedValue(
      board({
        unassignedAppointments: [
          {
            id: 'apt-9',
            appointmentNumber: 'APT-0009',
            customerName: 'Amir',
            type: 'WARRANTY',
            scheduledAt: '2026-09-09T11:00:00.000Z',
            estimatedDurationMinutes: 45,
          },
        ],
      }),
    );
    vi.mocked(assignTechnician).mockResolvedValue({ id: 'apt-9', technicianId: 'tech-1' } as any);

    renderPage();
    const card = (await screen.findByText('APT-0009')).closest('li')!;
    const dropZone = screen.getByTestId('drop-zone-tech-1'); // Ravi Kumar, field

    dragAndDrop(card, dropZone, 500); // midpoint of the 07:00-21:00 axis -> 14:00 UTC

    // One atomic call - technician + the drop-computed time together (see the-fool
    // pre-mortem note in the source: this used to be two sequential calls).
    await waitFor(() => expect(assignTechnician).toHaveBeenCalledWith('apt-9', 'tech-1', '2026-09-09T14:00:00.000Z'));
    expect(await screen.findByText('Technician assigned')).toBeInTheDocument();
  });

  it('rejects dropping an appointment card onto a workshop technician\'s row, without calling the API', async () => {
    vi.mocked(getGanttBoard).mockResolvedValue(
      board({
        unassignedAppointments: [
          {
            id: 'apt-9',
            appointmentNumber: 'APT-0009',
            customerName: 'Amir',
            type: 'WARRANTY',
            scheduledAt: '2026-09-09T11:00:00.000Z',
            estimatedDurationMinutes: 45,
          },
        ],
      }),
    );

    renderPage();
    const card = (await screen.findByText('APT-0009')).closest('li')!;
    const dropZone = screen.getByTestId('drop-zone-tech-2'); // Ali Hassan, workshop

    dragAndDrop(card, dropZone);

    expect(await screen.findByText('Wrong technician type')).toBeInTheDocument();
    expect(assignTechnician).not.toHaveBeenCalled();
  });

  it('drags an unassigned job card onto a workshop technician\'s row, assigning it', async () => {
    vi.mocked(getGanttBoard).mockResolvedValue(
      board({
        unassignedJobCards: [
          {
            id: 'jc-9',
            jobCardNumber: 'JC-0200',
            faultCode: 'F002',
            symptomCode: 'S002',
            warrantyStatus: 'OUT_OF_WARRANTY',
            createdAt: '2026-09-08T12:00:00.000Z',
          },
        ],
      }),
    );
    vi.mocked(assignWorkshopTechnician).mockResolvedValue({ id: 'jc-9', assignedWorkshopTechnicianId: 'tech-3' } as any);

    renderPage();
    const card = (await screen.findByText('JC-0200')).closest('li')!;
    const dropZone = screen.getByTestId('drop-zone-tech-3'); // Sunil Perera, workshop, idle

    dragAndDrop(card, dropZone);

    await waitFor(() => expect(assignWorkshopTechnician).toHaveBeenCalledWith('jc-9', { technicianId: 'tech-3' }));
    expect(await screen.findByText('Technician assigned')).toBeInTheDocument();
  });

  it('rejects dropping a job card onto a field technician\'s row, without calling the API', async () => {
    vi.mocked(getGanttBoard).mockResolvedValue(
      board({
        unassignedJobCards: [
          {
            id: 'jc-9',
            jobCardNumber: 'JC-0200',
            faultCode: 'F002',
            symptomCode: 'S002',
            warrantyStatus: 'OUT_OF_WARRANTY',
            createdAt: '2026-09-08T12:00:00.000Z',
          },
        ],
      }),
    );

    renderPage();
    const card = (await screen.findByText('JC-0200')).closest('li')!;
    const dropZone = screen.getByTestId('drop-zone-tech-1'); // Ravi Kumar, field

    dragAndDrop(card, dropZone);

    expect(await screen.findByText('Wrong technician type')).toBeInTheDocument();
    expect(assignWorkshopTechnician).not.toHaveBeenCalled();
  });

  it('drags an existing appointment block onto a different field technician\'s row, reassigning it at the dropped time', async () => {
    vi.mocked(getGanttBoard).mockResolvedValue(board());
    vi.mocked(updateAppointment).mockResolvedValue({ id: 'apt-1', technicianId: 'tech-4' } as any);

    renderPage();
    const bar = await screen.findByTitle(/APT-0001/);
    const dropZone = screen.getByTestId('drop-zone-tech-4'); // Fahad Noor, field, idle

    dragAndDrop(bar, dropZone, 500);

    await waitFor(() =>
      expect(updateAppointment).toHaveBeenCalledWith('apt-1', { technicianId: 'tech-4', scheduledAt: '2026-09-09T14:00:00.000Z' }),
    );
  });

  it('drags an eligible workshop_job block onto a different workshop technician\'s row, reassigning it', async () => {
    vi.mocked(getGanttBoard).mockResolvedValue(board());
    vi.mocked(reassignWorkshopTechnician).mockResolvedValue({ id: 'jc-1', assignedWorkshopTechnicianId: 'tech-3' } as any);

    renderPage();
    const bar = await screen.findByTitle(/JC-0100/);
    const dropZone = screen.getByTestId('drop-zone-tech-3'); // Sunil Perera, workshop, idle

    dragAndDrop(bar, dropZone);

    await waitFor(() => expect(reassignWorkshopTechnician).toHaveBeenCalledWith('jc-1', { technicianId: 'tech-3' }));
  });

  it('treats dropping a workshop_job block back onto its own current technician as a no-op', async () => {
    vi.mocked(getGanttBoard).mockResolvedValue(board());

    renderPage();
    const bar = await screen.findByTitle(/JC-0100/);
    const dropZone = screen.getByTestId('drop-zone-tech-2'); // its own current technician

    dragAndDrop(bar, dropZone);

    expect(await screen.findByText('Already assigned')).toBeInTheDocument();
    expect(reassignWorkshopTechnician).not.toHaveBeenCalled();
    expect(assignWorkshopTechnician).not.toHaveBeenCalled();
  });

  it('a workshop_job block outside the reassignable statuses (e.g. DELIVERED) is not draggable', async () => {
    const b = board();
    b.rows[1].blocks[0].status = 'DELIVERED';
    vi.mocked(getGanttBoard).mockResolvedValue(b);

    renderPage();
    const bar = await screen.findByTitle(/JC-0100/);

    expect(bar).toHaveAttribute('draggable', 'false');
  });

  it.each(['SCHEDULED', 'CONFIRMED', 'TECHNICIAN_ASSIGNED'])(
    'an appointment block is draggable while status is %s',
    async (status) => {
      const b = board();
      b.rows[0].blocks[0].status = status;
      vi.mocked(getGanttBoard).mockResolvedValue(b);

      renderPage();
      const bar = await screen.findByTitle(/APT-0001/);

      expect(bar).toHaveAttribute('draggable', 'true');
    },
  );

  it('an appointment block is not draggable once the technician has started the visit (ON_SITE) - reassign-until-visit-start rule', async () => {
    const b = board();
    b.rows[0].blocks[0].status = 'ON_SITE';
    vi.mocked(getGanttBoard).mockResolvedValue(b);

    renderPage();
    const bar = await screen.findByTitle(/APT-0001/);

    expect(bar).toHaveAttribute('draggable', 'false');
  });

  it('shows a live drop-time preview while dragging an appointment over a field technician\'s row, snapped to 15 minutes', async () => {
    vi.mocked(getGanttBoard).mockResolvedValue(
      board({
        unassignedAppointments: [
          {
            id: 'apt-9',
            appointmentNumber: 'APT-0009',
            customerName: 'Amir',
            type: 'WARRANTY',
            scheduledAt: '2026-09-09T11:00:00.000Z',
            estimatedDurationMinutes: 45,
          },
        ],
      }),
    );

    renderPage();
    const card = (await screen.findByText('APT-0009')).closest('li')!;
    const dropZone = screen.getByTestId('drop-zone-tech-1'); // Ravi Kumar, field

    dragOverOnly(card, dropZone, 500); // midpoint of the 07:00-21:00 axis -> 14:00 UTC

    // Matches exactly what the equivalent full drop (see the "drags an unassigned appointment
    // card..." test above) actually saves - '2026-09-09T14:00:00.000Z' - since the preview is
    // derived from the same snapped time, not a separate unsnapped approximation of it.
    expect(await screen.findByTestId('drop-preview')).toHaveTextContent('2:00 PM');
    expect(assignTechnician).not.toHaveBeenCalled();
  });

  it('shows no live preview while dragging an appointment over a workshop technician\'s row (role mismatch)', async () => {
    vi.mocked(getGanttBoard).mockResolvedValue(
      board({
        unassignedAppointments: [
          {
            id: 'apt-9',
            appointmentNumber: 'APT-0009',
            customerName: 'Amir',
            type: 'WARRANTY',
            scheduledAt: '2026-09-09T11:00:00.000Z',
            estimatedDurationMinutes: 45,
          },
        ],
      }),
    );

    renderPage();
    const card = (await screen.findByText('APT-0009')).closest('li')!;
    const dropZone = screen.getByTestId('drop-zone-tech-2'); // Ali Hassan, workshop - wrong type for an appointment

    dragOverOnly(card, dropZone, 500);

    await waitFor(() => expect(screen.queryByTestId('drop-preview')).not.toBeInTheDocument());
  });

  it('shows no live preview while dragging a job card over a technician row (job cards have no time dimension)', async () => {
    vi.mocked(getGanttBoard).mockResolvedValue(
      board({
        unassignedJobCards: [
          {
            id: 'jc-9',
            jobCardNumber: 'JC-0200',
            faultCode: 'F002',
            symptomCode: 'S002',
            warrantyStatus: 'OUT_OF_WARRANTY',
            createdAt: '2026-09-08T12:00:00.000Z',
          },
        ],
      }),
    );

    renderPage();
    const card = (await screen.findByText('JC-0200')).closest('li')!;
    const dropZone = screen.getByTestId('drop-zone-tech-3'); // Sunil Perera, workshop, idle - valid target

    dragOverOnly(card, dropZone, 500);

    // Row still highlights valid (bg-sky-50), but there's no meaningful "time" for a workshop
    // job assignment, so no preview guideline/label is rendered - only appointments get one.
    await waitFor(() => expect(screen.queryByTestId('drop-preview')).not.toBeInTheDocument());
  });

  it('surfaces an error toast when a drop is rejected by the backend', async () => {
    vi.mocked(getGanttBoard).mockResolvedValue(board());
    vi.mocked(reassignWorkshopTechnician).mockRejectedValue({
      response: { data: { message: 'Current technician still holds an open spare-parts reservation.' } },
    });

    renderPage();
    const bar = await screen.findByTitle(/JC-0100/);
    const dropZone = screen.getByTestId('drop-zone-tech-3');

    dragAndDrop(bar, dropZone);

    expect(await screen.findByText('Current technician still holds an open spare-parts reservation.')).toBeInTheDocument();
  });
});
