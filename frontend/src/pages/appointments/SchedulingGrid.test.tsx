import { useState } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/appointmentsApi', () => ({ getSchedulingGrid: vi.fn() }));

import { getSchedulingGrid } from '../../lib/appointmentsApi';
import { SchedulingGridPicker } from './SchedulingGrid';
import type { SchedulingGrid } from '../../lib/appointmentsTypes';

function grid(overrides: Partial<SchedulingGrid> = {}): SchedulingGrid {
  return {
    date: '2026-09-14',
    isOpen: true,
    startTime: '08:00',
    endTime: '09:00',
    breakStart: null,
    breakEnd: null,
    rosterLabel: 'Mon-Sat 08:00-09:00',
    technicians: [
      {
        id: 'tech-1',
        name: 'Ravi Kumar',
        appointmentCount: 0,
        atDailyCap: false,
        slots: [
          { time: '08:00', iso: '2026-09-14T08:00:00.000Z', available: true },
          { time: '08:15', iso: '2026-09-14T08:15:00.000Z', available: true },
          { time: '08:30', iso: '2026-09-14T08:30:00.000Z', available: false },
          { time: '08:45', iso: '2026-09-14T08:45:00.000Z', available: true },
        ],
      },
      {
        id: 'tech-2',
        name: 'Fahad Noor',
        appointmentCount: 0,
        atDailyCap: false,
        slots: [
          { time: '08:00', iso: '2026-09-14T08:00:00.000Z', available: true },
          { time: '08:15', iso: '2026-09-14T08:15:00.000Z', available: true },
          { time: '08:30', iso: '2026-09-14T08:30:00.000Z', available: true },
          { time: '08:45', iso: '2026-09-14T08:45:00.000Z', available: true },
        ],
      },
    ],
    ...overrides,
  };
}

function renderPicker(props: Partial<{ serviceCentreId: string; date: string }> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onDateChange = vi.fn();
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <SchedulingGridPicker
        serviceCentreId={props.serviceCentreId ?? 'sc-1'}
        date={props.date ?? '2026-09-14'}
        onDateChange={onDateChange}
        onChange={onChange}
      />
    </QueryClientProvider>,
  );
  return { onDateChange, onChange };
}

beforeEach(() => {
  vi.mocked(getSchedulingGrid).mockReset();
});

describe('SchedulingGridPicker - loading states', () => {
  it('shows a hint and never queries when no service centre id is set yet', () => {
    renderPicker({ serviceCentreId: '' });

    expect(screen.getByText(/Paste a service centre id/)).toBeInTheDocument();
    expect(getSchedulingGrid).not.toHaveBeenCalled();
  });

  it('shows the roster label and every technician\'s chips once loaded', async () => {
    vi.mocked(getSchedulingGrid).mockResolvedValue(grid());
    renderPicker();

    expect(await screen.findByText('Mon-Sat 08:00-09:00')).toBeInTheDocument();
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('Fahad Noor')).toBeInTheDocument();
    expect(screen.getByTestId('chip-tech-1-08:00')).toBeEnabled();
    expect(screen.getByTestId('chip-tech-1-08:30')).toBeDisabled(); // marked unavailable in the fixture
  });

  it('shows a "closed today" notice and no chip grid when the centre is closed that day', async () => {
    vi.mocked(getSchedulingGrid).mockResolvedValue(grid({ isOpen: false, technicians: [] }));
    renderPicker();

    expect(await screen.findByText(/closed on this date/)).toBeInTheDocument();
    expect(screen.queryByTestId('chip-tech-1-08:00')).not.toBeInTheDocument();
  });

  it('shows an empty-state message when the centre has no field technicians assigned', async () => {
    vi.mocked(getSchedulingGrid).mockResolvedValue(grid({ technicians: [] }));
    renderPicker();

    expect(await screen.findByText(/No field technicians are assigned/)).toBeInTheDocument();
  });

  it('flags a technician at their daily cap', async () => {
    const b = grid();
    b.technicians[0].atDailyCap = true;
    b.technicians[0].appointmentCount = 6;
    vi.mocked(getSchedulingGrid).mockResolvedValue(b);
    renderPicker();

    expect(await screen.findByText('At daily cap (6 today)')).toBeInTheDocument();
  });
});

describe('SchedulingGridPicker - chip selection', () => {
  it('selects a single chip and reports a 15-minute slot', async () => {
    vi.mocked(getSchedulingGrid).mockResolvedValue(grid());
    const { onChange } = renderPicker();
    const chip = await screen.findByTestId('chip-tech-1-08:00');

    fireEvent.click(chip);

    expect(onChange).toHaveBeenLastCalledWith({
      technicianId: 'tech-1',
      technicianName: 'Ravi Kumar',
      scheduledAt: '2026-09-14T08:00:00.000Z',
      estimatedDurationMinutes: 15,
    });
    expect(chip).toHaveClass('bg-sky-500');
  });

  it('extends the selection to a later chip on the same technician when the whole run between is free', async () => {
    vi.mocked(getSchedulingGrid).mockResolvedValue(grid());
    const { onChange } = renderPicker();
    // tech-2's row is entirely free (unlike tech-1, which has a busy 08:30) - a clean run
    // to extend across.
    fireEvent.click(await screen.findByTestId('chip-tech-2-08:00'));
    fireEvent.click(screen.getByTestId('chip-tech-2-08:30'));

    expect(onChange).toHaveBeenLastCalledWith({
      technicianId: 'tech-2',
      technicianName: 'Fahad Noor',
      scheduledAt: '2026-09-14T08:00:00.000Z',
      estimatedDurationMinutes: 45, // 08:00-08:45, three 15-minute chips
    });
    expect(screen.getByTestId('chip-tech-2-08:15')).toHaveClass('bg-sky-500'); // the in-between chip is highlighted too
  });

  it('restarts the selection at a fresh single chip when the run to it is broken by a busy chip', async () => {
    vi.mocked(getSchedulingGrid).mockResolvedValue(grid());
    const { onChange } = renderPicker();
    // tech-1: 08:00 is free, 08:30 is busy, 08:45 is free - so 08:00 -> 08:45 is NOT a
    // contiguous free run and must restart at 08:45 alone, not silently span the gap.
    fireEvent.click(await screen.findByTestId('chip-tech-1-08:00'));
    fireEvent.click(screen.getByTestId('chip-tech-1-08:45'));

    expect(onChange).toHaveBeenLastCalledWith({
      technicianId: 'tech-1',
      technicianName: 'Ravi Kumar',
      scheduledAt: '2026-09-14T08:45:00.000Z',
      estimatedDurationMinutes: 15,
    });
    expect(screen.getByTestId('chip-tech-1-08:00')).not.toHaveClass('bg-sky-500'); // no longer part of the (now different) selection
  });

  it('starts a fresh selection on a different technician, abandoning the previous one', async () => {
    vi.mocked(getSchedulingGrid).mockResolvedValue(grid());
    const { onChange } = renderPicker();
    fireEvent.click(await screen.findByTestId('chip-tech-1-08:00'));
    fireEvent.click(screen.getByTestId('chip-tech-2-08:15'));

    expect(onChange).toHaveBeenLastCalledWith({
      technicianId: 'tech-2',
      technicianName: 'Fahad Noor',
      scheduledAt: '2026-09-14T08:15:00.000Z',
      estimatedDurationMinutes: 15,
    });
    expect(screen.getByTestId('chip-tech-1-08:00')).not.toHaveClass('bg-sky-500');
  });

  it('does nothing when a disabled (busy) chip is clicked', async () => {
    vi.mocked(getSchedulingGrid).mockResolvedValue(grid());
    const { onChange } = renderPicker();
    const chip = await screen.findByTestId('chip-tech-1-08:30'); // marked unavailable
    onChange.mockClear(); // the mount-time reset effect already called onChange(null) once

    fireEvent.click(chip);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears the selection via "Clear selection"', async () => {
    vi.mocked(getSchedulingGrid).mockResolvedValue(grid());
    const { onChange } = renderPicker();
    fireEvent.click(await screen.findByTestId('chip-tech-1-08:00'));
    expect(await screen.findByText('Clear selection')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Clear selection'));

    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText('Clear selection')).not.toBeInTheDocument();
  });
});

describe('SchedulingGridPicker - date changes', () => {
  // `date` is a controlled prop, not state the picker owns itself - this small harness
  // actually feeds onDateChange back into the prop (the way SchedulePage really does),
  // so the reset-on-date-change effect has a real prop change to react to.
  function DateChangeHarness({ onChange }: { onChange: (v: unknown) => void }) {
    const [date, setDate] = useState('2026-09-14');
    return <SchedulingGridPicker serviceCentreId="sc-1" date={date} onDateChange={setDate} onChange={onChange} />;
  }

  it('clears any existing selection once the date actually changes', async () => {
    vi.mocked(getSchedulingGrid).mockResolvedValue(grid());
    const onChange = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <DateChangeHarness onChange={onChange} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByTestId('chip-tech-1-08:00'));
    onChange.mockClear();

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-15' } });

    // A stale technician/time pairing from the OLD date must never silently carry over to
    // the new one - the reset fires as soon as the date prop actually changes.
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
